import type { Express, Request, Response } from "express";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { logger } from "../logger";
import { promises as fsp } from "fs";
import { convertFileViaService } from "./utils/fileConversion";

type FormatsData = {
  inputs: string[];
  outputs: string[];
  combined: string[];
  pandocPath: string | null;
};

let cachedFormats: { data: FormatsData; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getProjectRoot(): string {
  try {
    const appRoot = app.getAppPath();
    // In development appRoot points to client/dist-electron; in production it's the app dir.
    return app.isPackaged ? path.join(appRoot, "..") : path.join(appRoot, "..", "..");
  } catch {
    return process.cwd();
  }
}

function resolvePandocCandidates(): string[] {
  const candidates: string[] = [];
  const envPath = (process.env.PANDOC_PATH || "").trim();
  if (envPath) candidates.push(envPath);

  const projectRoot = getProjectRoot();
  if (process.platform === "win32") {
    candidates.push(path.join(projectRoot, "bin", "pandoc.exe"));
    candidates.push(path.join(projectRoot, "client", "bin", "pandoc.exe"));
    candidates.push("pandoc.exe"); // from PATH
  } else {
    candidates.push(path.join(projectRoot, "bin", "pandoc"));
    candidates.push(path.join(projectRoot, "client", "bin", "pandoc"));
    candidates.push("pandoc"); // from PATH
  }
  return candidates;
}

function findExistingPandoc(): string | null {
  const cands = resolvePandocCandidates();
  for (const p of cands) {
    try {
      if (p.includes(path.sep)) {
        if (fs.existsSync(p)) return p;
      } else {
        // command in PATH; we can't check existence easily, just return to try execution
        return p;
      }
    } catch {
      // continue
    }
  }
  return null;
}

function execList(pandocPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(pandocPath, args, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${String(err.message || err)} | ${stderr || ""}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function loadPandocFormats(): Promise<FormatsData> {
  // serve from cache when fresh
  if (cachedFormats && Date.now() - cachedFormats.ts < CACHE_TTL_MS) {
    return cachedFormats.data;
  }

  const pandocPath = findExistingPandoc();
  if (!pandocPath) {
    const data: FormatsData = { inputs: [], outputs: [], combined: [], pandocPath: null };
    cachedFormats = { data, ts: Date.now() };
    return data;
  }

  let inRaw = "";
  let outRaw = "";
  try {
    [inRaw, outRaw] = await Promise.all([
      execList(pandocPath, ["--list-input-formats"]),
      execList(pandocPath, ["--list-output-formats"]),
    ]);
  } catch (e) {
    logger.error("Pandoc list formats failed", e as unknown);
    const data: FormatsData = { inputs: [], outputs: [], combined: [], pandocPath };
    cachedFormats = { data, ts: Date.now() };
    return data;
  }

  const toList = (s: string) =>
    s
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter((l) => !!l && !l.startsWith("#"))
      .sort();

  const inputs = toList(inRaw);
  const outputs = toList(outRaw);
  const combined = Array.from(new Set([...inputs, ...outputs])).sort();

  const data: FormatsData = { inputs, outputs, combined, pandocPath };
  cachedFormats = { data, ts: Date.now() };
  return data;
}

export function registerConversionRoutes(appExp: Express): void {
  // GET /api/files/convert/formats
  appExp.get("/api/files/convert/formats", async (_req: Request, res: Response) => {
    try {
      const data = await loadPandocFormats();
      if (!data.pandocPath) {
        res.status(503).json({
          success: false,
          message: "pandoc_not_available",
          data,
          error: { code: "PANDOC_NOT_FOUND", message: "Pandoc executable not found. Set PANDOC_PATH or place pandoc in bin/.", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
      res.status(200).json({
        success: true,
        message: "ok",
        data,
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/convert/formats failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Failed to list Pandoc formats", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });

  // POST /api/files/convert
  appExp.post("/api/files/convert", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        file_path?: unknown;
        target_format?: unknown;
        output_directory?: unknown;
        overwrite?: unknown;
      } | undefined;

      const filePath = typeof body?.file_path === "string" ? body.file_path : "";
      const targetFormatRaw = typeof body?.target_format === "string" ? body.target_format : "";
      const outputDirInput = typeof body?.output_directory === "string" ? body.output_directory : "";
      const overwrite = typeof body?.overwrite === "boolean" ? body.overwrite : false;

      if (!filePath) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "file_path is required", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
      if (!path.isAbsolute(filePath)) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "file_path must be absolute", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
      const st = await fsp.stat(filePath).catch(() => null);
      if (!st || !st.isFile()) {
        res.status(404).json({
          success: false,
          message: "not_found",
          data: null,
          error: { code: "RESOURCE_NOT_FOUND", message: "source file not found", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      const targetFormat = targetFormatRaw.trim().toLowerCase();
      if (!targetFormat) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "target_format is required", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      const srcDir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const outDir = outputDirInput && outputDirInput.trim() ? path.resolve(outputDirInput.trim()) : srcDir;
      await fsp.mkdir(outDir, { recursive: true }).catch(() => void 0);

      // Helper for deciding extension normalization
      const normExt = (fmt: string) => {
        const f = fmt.toLowerCase();
        if (f === "md" || f === "markdown") return "md";
        if (f === "htm") return "html";
        return f;
      };
      const outExt = normExt(targetFormat);
      const buildOutPath = (suffix?: string) => path.join(outDir, `${baseName}${suffix ? ` ${suffix}` : ""}.${outExt}`);

      // ensure unique path if not overwriting
      let outPath = buildOutPath();
      if (!overwrite) {
        for (let idx = 1; idx <= 2000; idx += 1) {
          const exists = await fsp
            .access(outPath)
            .then(() => true)
            .catch(() => false);
          if (!exists) break;
          outPath = buildOutPath(`(${idx})`);
        }
      }

      const pandocFmt = (fmt: string) => (fmt === "md" ? "markdown" : fmt);
      const doPandoc = async (src: string, out: string, fmt: string) => {
        const pandocPath = findExistingPandoc();
        if (!pandocPath) return false;
        const args = [src, "-t", pandocFmt(fmt), "-o", out];
        await new Promise<void>((resolve, reject) => {
          execFile(pandocPath, args, { windowsHide: true }, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        return true;
      };

      let finalOut = "";
      try {
        if (targetFormat === "md" || targetFormat === "markdown") {
          // Prefer pandoc when available; otherwise fallback to remote service
          const usedPandoc = await doPandoc(filePath, outPath, "markdown").catch(() => false);
          if (usedPandoc) {
            finalOut = outPath;
          } else {
            // remote conversion service to markdown
            const srcExt = path.extname(filePath).replace(/^\./, "");
            const tmp = await convertFileViaService(filePath, srcExt, "md");
            // Move or copy to desired outPath
            await fsp.copyFile(tmp, outPath);
            finalOut = outPath;
          }
        } else {
          // Non-markdown requires pandoc
          const ok = await doPandoc(filePath, outPath, targetFormat).catch(() => false);
          if (!ok) {
            res.status(503).json({
              success: false,
              message: "pandoc_not_available",
              data: null,
              error: { code: "PANDOC_NOT_FOUND", message: "Pandoc is required for this target format", details: null },
              timestamp: new Date().toISOString(),
              request_id: "",
            });
            return;
          }
          finalOut = outPath;
        }
      } catch (e) {
        logger.error("/api/files/convert failed in processing", e as unknown);
        res.status(500).json({
          success: false,
          message: "internal_error",
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Conversion failed", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      // Stat result
      const outStat = await fsp.stat(finalOut).catch(() => null);
      const size = outStat?.size ?? 0;

      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          source_file_path: filePath,
          output_file_path: finalOut,
          output_format: outExt,
          size,
          message: "converted",
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/convert failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Unhandled exception", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });
}
