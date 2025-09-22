import { promises as fsp } from "fs";
import path from "path";
import { app } from "electron";
import { configManager } from "../../configManager";
import { httpPostForm } from "./httpClient";
import { logger } from "../../logger";

interface ConvertResponse { output_file: string }

/**
 * Call third-party conversion service via HTTP multipart form.
 * Returns absolute path of downloaded converted file inside app temp folder.
 */
export async function convertFileViaService(filePath: string, sourceFormat: string, outputFormat: string): Promise<string> {
  const cfg = configManager.getConfig();
  const endpoint = (cfg.fileConvertEndpoint || "").trim();
  if (!endpoint) {
    throw new Error("fileConvertEndpoint not configured");
  }
  const form = new FormData();
  // Node18 global FormData supports file from Blob, we must read and append as file
  const fileBuf = await fsp.readFile(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([new Uint8Array(fileBuf)]);
  form.append("file", blob, fileName);
  form.append("source_format", sourceFormat);
  form.append("output_format", outputFormat);

  const resp = await httpPostForm<ConvertResponse>(endpoint, form);
  if (!resp.ok || !resp.data?.output_file) {
    throw new Error(resp.error?.message || `Conversion failed HTTP ${resp.status}`);
  }

  const fileUrl = resp.data.output_file;
  // Download the file
  const tempDir = path.join(app.getAppPath(), "temp");
  await fsp.mkdir(tempDir, { recursive: true });
  const dest = path.join(tempDir, `${Date.now()}_${path.basename(fileUrl)}`);

  const dl = await fetch(fileUrl);
  if (!dl.ok) {
    throw new Error(`Download failed HTTP ${dl.status}`);
  }
  const ab = await dl.arrayBuffer();
  await fsp.writeFile(dest, Buffer.from(ab));
  logger.info("Downloaded converted file", dest);
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
  const tempDir = path.join(app.getAppPath(), "temp");
  await fsp.mkdir(tempDir, { recursive: true });

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
    logger.error("ensureTxtFile: conversion fallback failed", err as unknown);
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
