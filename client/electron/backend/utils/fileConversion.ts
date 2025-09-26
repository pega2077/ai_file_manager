import { promises as fsp } from "fs";
import path from "path";
import { configManager } from "../../configManager";
import { httpGetJson, httpPostForm, httpPostJson } from "./httpClient";
import { logger } from "../../logger";
import { ensureTempDir } from "./pathHelper";

// ---- Types aligned with File Converter Service API ----
interface UploadResponse {
  message: string;
  file: {
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    path: string; // relative path under storage, e.g., uploads/<file>
  };
}

type TaskStatus = "pending" | "processing" | "completed" | "failed";

interface TaskMeta {
  id: string;
  status: TaskStatus;
  sourcePath: string;
  sourceFormat: string;
  targetFormat: string;
  sourceFilename?: string;
  outputPath?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  downloadUrl?: string;
}

interface ConvertAcceptedResponse {
  message: string;
  task: TaskMeta;
}

interface TaskStatusResponse {
  task: TaskMeta;
}

// ---- Helpers ----
function resolveServiceBase(): string {
  const cfg = configManager.getConfig();
  const base = (cfg.fileConvertEndpoint ||"").trim();
  if (!base) {
    throw new Error("File converter service base URL not configured. Set fileConvertEndpoint in config.json or FILE_CONVERT_BASE_URL env.");
  }
  return base.replace(/\/$/, "");
}

function mapToPandocFormat(fmt: string): string {
  const f = (fmt || "").toLowerCase();
  const map: Record<string, string> = {
    md: "markdown",
    markdown: "markdown",
    txt: "markdown", // treat plain text as markdown for uniformity
    htm: "html",
    html: "html",
    xhtml: "html",
    doc: "doc",
    docx: "docx",
    odt: "odt",
    rtf: "rtf",
    pdf: "pdf",
    epub: "epub",
    csv: "markdown", // will render as code blocks or simple tables after conversion
    json: "markdown",
  };
  return map[f] || f;
}

async function downloadToFile(url: string, dest: string, timeoutMs = 300000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    await fsp.writeFile(dest, Buffer.from(ab));
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Call file converter service following the documented workflow:
 * 1) POST /upload (multipart) -> returns relative source path
 * 2) POST /convert (json) -> returns task id
 * 3) Poll GET /tasks/{id} until completed/failed
 * 4) GET /download/{id} -> save to temp and return absolute path
 */
export async function convertFileViaService(filePath: string, sourceFormat: string, outputFormat: string): Promise<string> {
  const base = resolveServiceBase();
  const srcFmt = mapToPandocFormat(sourceFormat);
  const outFmt = mapToPandocFormat(outputFormat);

  // 1) Upload
  const form = new FormData();
  const fileBuf = await fsp.readFile(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([new Uint8Array(fileBuf)]);
  form.append("file", blob, fileName);

  logger.info("Converter: uploading file", { fileName, size: fileBuf.byteLength });
  const up = await httpPostForm<UploadResponse>(`${base}/upload`, form);
  if (!up.ok || !up.data?.file?.path) {
    const msg = up.error?.message || `Upload failed HTTP ${up.status}`;
    logger.error("Converter: upload failed", { status: up.status, msg });
    throw new Error(msg);
  }
  const sourcePath = up.data.file.path;

  // 2) Create convert task
  const convertBody = {
    sourcePath,
    sourceFormat: srcFmt,
    targetFormat: outFmt,
    sourceFilename: fileName,
  };
  logger.info("Converter: creating task", { sourcePath, srcFmt, outFmt });
  const created = await httpPostJson<ConvertAcceptedResponse>(`${base}/convert`, convertBody);
  if (!created.ok || !created.data?.task?.id) {
    const msg = created.error?.message || `Create task failed HTTP ${created.status}`;
    logger.error("Converter: create task failed", { status: created.status, msg });
    throw new Error(msg);
  }
  const taskId = created.data.task.id;

  // 3) Poll until completed
  const pollIntervalMs = 1500;
  const maxWaitMs = 8 * 60 * 1000; // 8 minutes max
  const started = Date.now();
  let final: TaskMeta | undefined;
  while (Date.now() - started < maxWaitMs) {
    const stat = await httpGetJson<TaskStatusResponse>(`${base}/tasks/${encodeURIComponent(taskId)}`);
    if (!stat.ok || !stat.data?.task) {
      logger.warn("Converter: polling failed, retrying", { status: stat.status });
      await delay(pollIntervalMs);
      continue;
    }
    const t = stat.data.task;
    if (t.status === "completed") { final = t; break; }
    if (t.status === "failed") {
      const errMsg = t.error || "Conversion failed";
      logger.error("Converter: task failed", { taskId, err: errMsg });
      throw new Error(errMsg);
    }
    await delay(pollIntervalMs);
  }
  if (!final) {
    logger.error("Converter: task timeout", { taskId });
    throw new Error("Conversion timeout");
  }

  // 4) Download
  const downloadUrl = final.downloadUrl || `${base}/download/${encodeURIComponent(final.id)}`;
  const tempDir = await ensureTempDir();
  const destName = `${Date.now()}_${path.basename(fileName, path.extname(fileName))}.${outFmt === "markdown" ? "md" : outFmt}`;
  const dest = path.join(tempDir, destName);
  logger.info("Converter: downloading result", { taskId: final.id, downloadUrl, dest });
  await downloadToFile(downloadUrl, dest);
  return dest;
}

/**
 * Ensure a local file is in .txt format by converting or extracting plain text.
 * For simple text-like formats, we read and write to .txt.
 * For others, try conversion service to md then strip markdown if needed.
 * Returns absolute path of the .txt file stored under temp.
 */
export async function ensureTxtFile(localFilePath: string): Promise<string> {
  const ext = path.extname(localFilePath).toLowerCase().replace(/^\./, "");
  const tempDir = await ensureTempDir();

  // quick pass-through extensions
  const pass = new Set(["txt", "md", "csv", "json", "html", "htm"]);
  if (pass.has(ext)) {
    const buf = await fsp.readFile(localFilePath);
    const text = buf.toString("utf8");
    const out = path.join(tempDir, `${Date.now()}_${path.basename(localFilePath, path.extname(localFilePath))}.txt`);
    await fsp.writeFile(out, text, "utf8");
    return out;
  }

  // Otherwise attempt conversion to markdown via service, then write .txt (keeping markdown text content)
  try {
    const mdPath = await convertFileViaService(localFilePath, ext, "md");
    const mdText = await fsp.readFile(mdPath, "utf8");
    const out = path.join(tempDir, `${Date.now()}_${path.basename(localFilePath, path.extname(localFilePath))}.txt`);
    await fsp.writeFile(out, mdText, "utf8");
    return out;
  } catch (err) {
    logger.error("ensureTxtFile: conversion fallback failed", { file: localFilePath, err: String(err) });
    throw err;
  }
}

/**
 * Simple text chunking by characters with overlap.
 */
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  const len = text.length;
  if (len === 0) return chunks;
  let start = 0;
  while (start < len) {
    const end = Math.min(len, start + chunkSize);
    chunks.push(text.slice(start, end));
    if (end === len) break;
    start = end - overlap;
    if (start < 0) start = 0;
    if (start >= len) break;
  }
  return chunks;
}
