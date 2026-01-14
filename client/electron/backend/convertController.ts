import type { Express, Request, Response } from "express";
import path from "path";
import { logger } from "../logger";
import { promises as fsp } from "fs";
import { ensureTempDir } from "./utils/pathHelper";
import { convertFileViaService } from "./utils/fileConversion";
import { configManager } from "../configManager";
import { httpGetJson } from "./utils/httpClient";

// Dynamic import for Electron to support both standalone and Electron modes
let app: any = null;
let BrowserWindow: any = null;

/**
 * Lazy-load Electron modules if available
 */
function getElectronModules(): { app: any; BrowserWindow: any } {
  if (app === null) {
    try {
      // Only import electron if available (Electron environment)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      app = electron.app;
      BrowserWindow = electron.BrowserWindow;
    } catch {
      // Standalone mode - electron not available
      app = false;
      BrowserWindow = false;
    }
  }
  return { 
    app: app === false ? null : app,
    BrowserWindow: BrowserWindow === false ? null : BrowserWindow
  };
}

type FormatsData = {
  inputs: string[];
  outputs: string[];
  input_formats: string[];
  output_formats: string[];
  combined: string[];
  service_endpoint: string | null;
  default_output_directory: string;
  pandoc_available: boolean;
  markitdown_available: boolean;
};

type ServiceFormatsResponse = {
  formats?: {
    source?: unknown;
    target?: unknown;
  };
};

type ServiceError = Error & {
  code?: string;
  status?: number;
  details?: unknown;
};

let cachedFormats: { data: FormatsData; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ARTICLE_FETCH_TIMEOUT_MS = 20000;
const MAX_FILENAME_LENGTH = 120;

const RESERVED_FILENAME_CHARS = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);

type HttpStatusError = Error & { statusCode?: number; statusMessage?: string; finalUrl?: string };

function sanitizeFileBaseName(raw: string, fallback: string): string {
  const base = raw || fallback;
  let normalized = base;
  try {
    normalized = base.normalize("NFKD");
  } catch {
    normalized = base;
  }
  const filtered = Array.from(normalized)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < 32 || RESERVED_FILENAME_CHARS.has(ch)) {
        return " ";
      }
      return ch;
    })
    .join("");
  const compact = filtered.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "article";
  }
  const truncated = compact.slice(0, MAX_FILENAME_LENGTH).replace(/[. ]+$/u, "");
  const withoutExt = truncated.replace(/\.(md|markdown)$/iu, "");
  return withoutExt || "article";
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  const raw = match[1].replace(/\s+/g, " ").trim();
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  return raw.replace(/&[#a-zA-Z0-9]+;/g, (ent) => entities[ent] ?? ent);
}

async function fetchWebpage(targetUrl: string): Promise<{ html: string; finalUrl: string; contentType: string; title: string }>
{
  const { app: electronApp, BrowserWindow: BrowserWindowClass } = getElectronModules();
  
  // In standalone mode, we can't use BrowserWindow, so throw an error
  if (!electronApp || !BrowserWindowClass) {
    throw new Error("webpage_fetch_not_supported_in_standalone_mode");
  }
  
  if (!electronApp.isReady()) {
    await electronApp.whenReady().catch(() => void 0);
  }

  //const userAgent = process.env.WEB_FETCH_USER_AGENT?.trim() || "AiFileManagerBot/1.0 (+https://pegamob.com)";

  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindowClass({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });

    const session = win.webContents.session;
    const statusInfo: {
      statusCode?: number;
      statusMessage?: string;
      finalUrl?: string;
      contentType?: string;
    } = {};
    const filter = { urls: ["*://*/*"] };

    const onCompleted = (details: any) => {
      if (details.webContentsId !== win.webContents.id || details.resourceType !== "mainFrame") {
        return;
      }
      statusInfo.statusCode = details.statusCode;
      statusInfo.statusMessage = details.statusLine || "";
      statusInfo.finalUrl = details.url;
      const headerKey = Object.keys(details.responseHeaders || {}).find((key) => key.toLowerCase() === "content-type");
      if (headerKey && details.responseHeaders) {
        const value = details.responseHeaders[headerKey];
        statusInfo.contentType = Array.isArray(value) ? value[0] : value;
      }
      if (details.statusCode >= 400 && !settled) {
        settled = true;
        cleanup();
        const error: HttpStatusError = new Error(`http_error_${details.statusCode}`);
        error.statusCode = details.statusCode;
        error.statusMessage = details.statusLine || "";
        error.finalUrl = details.url;
        reject(error);
      }
    };

    const onErrorOccurred = (details: any) => {
      if (details.webContentsId !== win.webContents.id || details.resourceType !== "mainFrame" || settled) {
        return;
      }
      settled = true;
      cleanup();
      const error: HttpStatusError = new Error(`network_error: ${details.error || "unknown"}`);
      error.statusMessage = details.error || "network error";
      error.finalUrl = details.url;
      reject(error);
    };

    session.webRequest.onCompleted(filter, onCompleted);
    session.webRequest.onErrorOccurred(filter, onErrorOccurred);

    const cleanup = () => {
      if (!win.isDestroyed()) {
        win.destroy();
      }
      clearTimeout(timeoutHandle);
      session.webRequest.onCompleted(filter, null);
      session.webRequest.onErrorOccurred(filter, null);
    };

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("webpage_fetch_timeout"));
    }, ARTICLE_FETCH_TIMEOUT_MS);

    //win.webContents.setUserAgent(userAgent);

    win.webContents.once("did-fail-load", (_event, errorCode, errorDesc) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`failed_to_load_page: ${errorCode} ${errorDesc}`));
    });

    win.webContents.once("did-finish-load", async () => {
      if (settled) return;
      try {
        if (typeof statusInfo.statusCode === "number" && statusInfo.statusCode >= 400) {
          settled = true;
          cleanup();
          const error: HttpStatusError = new Error(`http_error_${statusInfo.statusCode}`);
          error.statusCode = statusInfo.statusCode;
          error.statusMessage = statusInfo.statusMessage || "";
          error.finalUrl = statusInfo.finalUrl || win.webContents.getURL() || targetUrl;
          reject(error);
          return;
        }

        const data = await win.webContents.executeJavaScript(
          `(() => ({
            html: document.documentElement ? document.documentElement.outerHTML : document.body?.outerHTML || "",
            title: document.title || "",
            contentType: document.contentType || ""
          }))();`
        );
        const finalUrl = statusInfo.finalUrl || win.webContents.getURL() || targetUrl;
        const html = typeof data?.html === "string" ? data.html : "";
        const title = typeof data?.title === "string" ? data.title : extractTitle(html);
        const contentType =
          typeof statusInfo.contentType === "string" && statusInfo.contentType
            ? statusInfo.contentType
            : typeof data?.contentType === "string"
              ? data.contentType
              : "";
        settled = true;
        cleanup();
        resolve({ html, title, contentType, finalUrl });
      } catch (err) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    });

    win.loadURL(targetUrl).catch((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
  });
}

function normalizeFormats(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    normalized.push(lower);
  }
  normalized.sort();
  return normalized;
}

async function loadServiceFormats(): Promise<FormatsData> {
  if (cachedFormats && Date.now() - cachedFormats.ts < CACHE_TTL_MS) {
    return cachedFormats.data;
  }

  const cfg = configManager.getConfig();
  const baseRaw = (cfg.fileConvertEndpoint || "").trim();
  if (!baseRaw) {
    const err: ServiceError = new Error("converter_service_not_configured");
    err.code = "SERVICE_NOT_CONFIGURED";
    throw err;
  }
  const base = baseRaw.replace(/\/+$/, "");
  if (!base) {
    const err: ServiceError = new Error("converter_service_not_configured");
    err.code = "SERVICE_NOT_CONFIGURED";
    throw err;
  }

  const resp = await httpGetJson<ServiceFormatsResponse>(`${base}/formats`, undefined, 20000);
  if (!resp.ok || !resp.data) {
    const err: ServiceError = new Error(resp.error?.message || `fetch_failed_${resp.status}`);
    err.code = "REMOTE_FETCH_FAILED";
    err.status = resp.status;
    throw err;
  }

  const inputs = normalizeFormats(resp.data.formats?.source);
  const outputs = normalizeFormats(resp.data.formats?.target);
  const combined = Array.from(new Set([...inputs, ...outputs])).sort();
  const defaultDir = await ensureTempDir();
  const data: FormatsData = {
    inputs,
    outputs,
    input_formats: inputs,
    output_formats: outputs,
    combined,
    service_endpoint: base,
    default_output_directory: defaultDir,
  pandoc_available: outputs.length > 0,
    markitdown_available: outputs.some((fmt) => fmt === "md" || fmt === "markdown"),
  };
  cachedFormats = { data, ts: Date.now() };
  return data;
}

export function registerConversionRoutes(appExp: Express): void {
  // GET /api/files/convert/formats
  appExp.get("/api/files/convert/formats", async (_req: Request, res: Response) => {
    try {
      const data = await loadServiceFormats();
      res.status(200).json({
        success: true,
        message: "ok",
        data,
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      const serviceErr = err as ServiceError;
      const code = serviceErr.code || "REMOTE_FETCH_FAILED";
      const status = code === "SERVICE_NOT_CONFIGURED" ? 503 : 502;
      logger.error("/api/files/convert/formats failed", {
        code,
        status,
        error: String(serviceErr?.message || err),
      });
      res.status(status).json({
        success: false,
        message: code === "SERVICE_NOT_CONFIGURED" ? "service_not_configured" : "fetch_failed",
        data: null,
        error: {
          code,
          message:
            code === "SERVICE_NOT_CONFIGURED"
              ? "File converter service endpoint not configured."
              : "Failed to retrieve formats from converter service.",
          details: serviceErr?.status ?? null,
        },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });

  appExp.post("/api/files/convert/webpage", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        url?: unknown;
        output_directory?: unknown;
        file_name?: unknown;
        overwrite?: unknown;
      } | undefined;

      const urlRaw = typeof body?.url === "string" ? body.url.trim() : "";
      const outputDirInput = typeof body?.output_directory === "string" ? body.output_directory.trim() : "";
      const fileNameInput = typeof body?.file_name === "string" ? body.file_name.trim() : "";
      const overwrite = typeof body?.overwrite === "boolean" ? body.overwrite : false;

      if (!urlRaw) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "url is required", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      let normalizedUrl: URL;
      try {
        normalizedUrl = new URL(urlRaw);
        if (!normalizedUrl.protocol.startsWith("http")) {
          throw new Error("unsupported protocol");
        }
      } catch {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "url must be a valid http(s) URL", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      const destinationDir = outputDirInput ? path.resolve(outputDirInput) : await ensureTempDir();
      await fsp.mkdir(destinationDir, { recursive: true });

      let fetchResult;
      try {
        fetchResult = await fetchWebpage(normalizedUrl.toString());
      } catch (err) {
        const fetchError = err as HttpStatusError;
        const statusCode = typeof fetchError.statusCode === "number" ? fetchError.statusCode : undefined;
        const statusMessage = typeof fetchError.statusMessage === "string" ? fetchError.statusMessage : undefined;
        const finalUrlOnError = typeof fetchError.finalUrl === "string" && fetchError.finalUrl ? fetchError.finalUrl : normalizedUrl.toString();
        logger.error("/api/files/convert/webpage fetch failed", {
          url: normalizedUrl.toString(),
          finalUrl: finalUrlOnError,
          statusCode,
          statusMessage,
          error: String(fetchError?.message || err),
        });
        const errorDetails = statusCode
          ? {
              code: "HTTP_STATUS_ERROR",
              message: `Target URL responded with status ${statusCode}`,
              details: {
                status_code: statusCode,
                status_message: statusMessage ?? "",
                final_url: finalUrlOnError,
              },
            }
          : {
              code: "FETCH_FAILED",
              message: "Failed to fetch target URL",
              details: {
                status_message: statusMessage ?? "",
                final_url: finalUrlOnError,
              },
            };
        res.status(502).json({
          success: false,
          message: "fetch_failed",
          data: null,
          error: errorDetails,
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      const { html, finalUrl, contentType, title } = fetchResult;
      if (!html.trim()) {
        res.status(422).json({
          success: false,
          message: "no_content",
          data: null,
          error: { code: "NO_CONTENT", message: "Readable content not found", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      const baseName = sanitizeFileBaseName(fileNameInput || title, normalizedUrl.hostname || "article");
      const buildOutPath = (suffix?: string) => path.join(destinationDir, `${baseName}${suffix ? ` ${suffix}` : ""}.html`);
      let outPath = buildOutPath();
      if (!overwrite) {
        for (let idx = 1; idx <= 1000; idx += 1) {
          const exists = await fsp
            .access(outPath)
            .then(() => true)
            .catch(() => false);
          if (!exists) break;
          outPath = buildOutPath(`(${idx})`);
        }
      }

      await fsp.writeFile(outPath, html, "utf8");
      const size = Buffer.byteLength(html, "utf8");
      logger.info("Webpage saved as HTML", { sourceUrl: finalUrl, output: outPath, size });

      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          source_url: finalUrl,
          title,
          byline: "",
          excerpt: "",
          content_type: contentType,
          html_temp_file_path: outPath,
          output_file_path: outPath,
          output_format: "html",
          size,
          message: "saved_html",
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/convert/webpage failed", err as unknown);
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

      let finalOut = "";
      try {
        const srcExt = path.extname(filePath).replace(/^\./, "").toLowerCase() || "txt";
        const tempResultPath = await convertFileViaService(filePath, srcExt, targetFormat);
        await fsp.copyFile(tempResultPath, outPath);
        finalOut = outPath;
      } catch (e) {
        const messageText = e instanceof Error ? e.message : String(e);
        logger.error("/api/files/convert conversion service failed", {
          source: filePath,
          targetFormat,
          error: messageText,
        });
        if (messageText.toLowerCase().includes("not configured")) {
          res.status(503).json({
            success: false,
            message: "service_not_configured",
            data: null,
            error: { code: "SERVICE_NOT_CONFIGURED", message: "File converter service endpoint not configured.", details: null },
            timestamp: new Date().toISOString(),
            request_id: "",
          });
          return;
        }
        res.status(502).json({
          success: false,
          message: "conversion_failed",
          data: null,
          error: { code: "CONVERSION_FAILED", message: "Failed to convert file via remote service", details: messageText },
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
