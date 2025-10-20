import path from "path";

// General helpers
export function toNumber(val: unknown, def: number): number {
  const n = typeof val === "string" || typeof val === "number" ? Number(val) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseTags(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
  return undefined;
}

// Constants
export const MAX_TEXT_PREVIEW_BYTES = 10 * 1024; // 10KB

// Image extension set
const IMAGE_EXTENSIONS = new Set<string>(["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico"]);

// Mime type by extension
export function getMimeByExt(ext: string): string {
  const e = ext.toLowerCase();
  switch (e) {
    case "txt": return "text/plain";
    case "md": return "text/markdown";
    case "json": return "application/json";
    case "csv": return "text/csv";
    case "html":
    case "htm": return "text/html";
    case "css": return "text/css";
    case "xml": return "application/xml";
    case "js": return "application/javascript";
    case "ts": return "text/plain";
    case "rtf": return "application/rtf";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "bmp": return "image/bmp";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "ico": return "image/x-icon";
    case "pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

// BOM helpers
function hasUTF8BOM(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

function hasUTF16LEBOM(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
}

function hasUTF16BEBOM(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff;
}

export function decodeTextBuffer(buf: Buffer): { text: string; encoding: string } {
  // Try BOM first
  if (hasUTF8BOM(buf)) {
    return { text: buf.toString("utf8"), encoding: "utf-8" };
  }
  if (hasUTF16LEBOM(buf)) {
    // Strip BOM automatically by toString
    return { text: buf.toString("utf16le"), encoding: "utf-16le" };
  }
  if (hasUTF16BEBOM(buf)) {
    // Convert BE to LE by swapping pairs
    const swapped = Buffer.from(buf);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const a = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = a;
    }
    return { text: swapped.toString("utf16le"), encoding: "utf-16be" };
  }
  // Heuristic: try utf8, check replacement char count; fallback to latin1
  const utf8 = buf.toString("utf8");
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad / Math.max(1, utf8.length) < 0.01) {
    return { text: utf8, encoding: "utf-8" };
  }
  const latin1 = buf.toString("latin1");
  return { text: latin1, encoding: "latin-1" };
}

// Path helpers (reserved for future use)
export function getExtension(filePath: string): string {
  return path.extname(filePath).replace(/^\./, "");
}

// Category extensions mapping used by /api/files/list
export const CATEGORY_EXTENSIONS: Record<string, string[]> = {
  document: ["txt", "doc", "docx", "pdf", "ppt", "pptx", "rtf", "odt", "ods", "odp","md", "html", "htm", "epub"],
  sheet: ["xlsx", "xls", "csv", "ods"],
  image: ["jpg", "png", "gif", "jpeg", "bmp", "tiff", "tif", "webp", "svg"],
  video: ["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
  other: [],
};
