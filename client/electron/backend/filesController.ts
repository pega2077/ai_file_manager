import type { Request, Response, Express } from "express";
import { Op, WhereOptions } from "sequelize";
import FileModel from "./models/file";
import { logger } from "../logger";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { MAX_TEXT_PREVIEW_BYTES, getMimeByExt, isImageExt, decodeTextBuffer, CATEGORY_EXTENSIONS, toNumber, isNonEmptyString, parseTags } from "./utils/fileHelpers";
import { ensureTxtFile, chunkText } from "./utils/fileConversion";
import { ensureTempDir } from "./utils/pathHelper";
import { embedText, generateStructuredJson, describeImage, getActiveModelName } from "./utils/llm";
import type { LlmMessage } from "./utils/llm";
import type { StructuredResponseFormat } from "./utils/ollama";
import { buildVisionDescribePrompt, normalizeLanguage } from "./utils/promptHelper";
import { buildExtractTagsMessages } from "./utils/promptHelper";
import type { ProviderName } from "./utils/llm";
import { app } from "electron";
import { randomUUID } from "crypto";
import ChunkModel from "./models/chunk";
import { updateGlobalFaissIndex } from "./utils/vectorStore";
import { configManager } from "../configManager";

interface ListFilesRequestBody {
  page?: unknown;
  limit?: unknown;
  category?: unknown;
  type?: unknown;
  search?: unknown;
  tags?: unknown;
}

// moved helpers to utils/fileHelpers

export async function listFilesHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ListFilesRequestBody | undefined;

    const page = toNumber(body?.page, 1);
    const limit = Math.min(toNumber(body?.limit, 20), 100);
    const category = isNonEmptyString(body?.category) ? body!.category!.trim().toLowerCase() : undefined;
    const type = isNonEmptyString(body?.type) ? body!.type!.trim().toLowerCase() : undefined;
    const search = isNonEmptyString(body?.search) ? body!.search!.trim() : undefined;
    const tags = parseTags(body?.tags);

    // Build AND conditions array; we'll combine into where at the end
    const andConds: WhereOptions[] = [];

    if (category) {
      const extList = CATEGORY_EXTENSIONS[category] || [];
      if (extList.length > 0) {
        // (name LIKE '%.ext1' OR name LIKE '%.ext2' ...)
        const orConds: WhereOptions[] = extList.map((ext) => ({ name: { [Op.like]: `%.${ext}` } }));
        andConds.push({ [Op.or]: orConds });
      } else {
        // fallback to category column
        andConds.push({ category: { [Op.like]: `%${category}%` } });
      }
    }

    if (type) {
      if (type.includes("/")) {
        andConds.push({ type });
      } else {
        // match mime endswith /ext OR exact ext OR file name endswith .ext
        const mimeEnd = { type: { [Op.like]: `%/${type}` } };
        const exact = { type: type } as unknown as WhereOptions;
        const nameEnd = { name: { [Op.like]: `%.${type}` } };
        andConds.push({ [Op.or]: [mimeEnd, exact, nameEnd] });
      }
    }

    if (search) {
      const like = `%${search}%`;
      andConds.push({ [Op.or]: [{ name: { [Op.like]: like } }, { summary: { [Op.like]: like } }] });
    }

    if (tags && tags.length > 0) {
      // tags stored as JSON array string; use LIKE to approximate contains for each tag
      const tagConds = tags.map((t) => ({ tags: { [Op.like]: `%"${t}"%` } }));
      andConds.push({ [Op.and]: tagConds });
    }

    const where: WhereOptions = andConds.length > 0 ? { [Op.and]: andConds } : {};

    // Count total
    const totalCount = await FileModel.count({ where });

    const offset = (page - 1) * limit;
    const rows = (await FileModel.findAll({
      where,
      order: [["created_at", "DESC"]],
      limit,
      offset,
      raw: true,
    })) as unknown as RawFileRow[];

    type RawFileRow = {
      file_id: string;
      name: string;
      path: string;
      type: string;
      category: string;
      summary: string | null;
      tags: string | null;
      size: number;
      processed: boolean | number | null;
      created_at: string;
      updated_at: string | null;
    };
    const files = (rows as RawFileRow[]).map((row) => {
      const tagsArr = (() => {
        try {
          return row.tags ? (JSON.parse(row.tags) as unknown as string[]) : [];
        } catch {
          return [];
        }
      })();
      return {
        file_id: row.file_id,
        name: row.name,
        path: row.path,
        type: row.type,
        category: row.category,
        summary: row.summary ?? "",
        tags: tagsArr,
        size: row.size,
        processed: Boolean(row.processed ?? false),
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        files,
        pagination: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          limit,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/list failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "internal_error", message: "Unhandled exception", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Update File (metadata + optional rename on disk) --------
interface UpdateFileBody {
  file_id?: unknown;
  name?: unknown; // new file name (with or without extension)
  category?: unknown; // new category
  tags?: unknown; // string[]
}

export async function updateFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as UpdateFileBody | undefined;
    const fileId = typeof body?.file_id === "string" ? body.file_id.trim() : "";
    const newNameRaw = typeof body?.name === "string" ? body.name.trim() : "";
    const newCategoryRaw = typeof body?.category === "string" ? body.category.trim().toLowerCase() : "";
    const newTags = parseTags(body?.tags) ?? undefined;

    if (!fileId) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Load file row
    const row = (await FileModel.findOne({ where: { file_id: fileId }, raw: true }).catch(() => null)) as
      | {
          file_id: string;
          name: string;
          path: string;
          type: string;
          category: string;
          tags: string | null;
          size: number;
          created_at: string;
          updated_at: string | null;
        }
      | null;

    if (!row) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "file not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const currentDir = path.dirname(row.path);
    let targetName = row.name;
    if (newNameRaw) {
      // For safety, forbid path separators in name
      if (/[\\/]/.test(newNameRaw)) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "name must not contain path separators", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
      targetName = newNameRaw;
    }

    const oldPath = row.path;
    let newPath = oldPath;
    let renamedOnDisk = false;

    if (targetName !== row.name) {
      // Ensure extension preservation if user omitted it
      const oldExt = path.extname(row.name);
      const hasExt = path.extname(targetName).length > 0;
      const finalName = hasExt ? targetName : `${targetName}${oldExt}`;
      newPath = path.join(currentDir, finalName);

      // If destination exists and is different file, reject to avoid overwrite
      const exists = await fsp
        .access(newPath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
      if (exists && path.normalize(newPath) !== path.normalize(oldPath)) {
        res.status(409).json({
          success: false,
          message: "conflict",
          data: null,
          error: { code: "FILE_EXISTS", message: "Target filename already exists", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
      try {
        await fsp.rename(oldPath, newPath);
        renamedOnDisk = true;
      } catch (e) {
        logger.error("Rename file on disk failed", e as unknown);
        res.status(500).json({
          success: false,
          message: "internal_error",
          data: null,
          error: { code: "RENAME_FAILED", message: "Failed to rename file on disk", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }
    }

    // Compute updated fields
    const nowIso = new Date().toISOString();
    const nameToSave = path.basename(newPath);
    const ext = path.extname(nameToSave).replace(/^\./, "").toLowerCase();
    const type = getMimeByExt(ext);

    // Determine category to save: explicit request or infer from extension
    let category = row.category;
    if (newCategoryRaw) {
      category = newCategoryRaw;
    } else if (targetName !== row.name) {
      // Infer when name changed (might change extension)
      let inferred = "other";
      for (const [cat, exts] of Object.entries(CATEGORY_EXTENSIONS)) {
        if (cat === "other") continue;
        if (exts.includes(ext)) {
          inferred = cat;
          break;
        }
      }
      category = inferred;
    }

    // Build DB update
    const update: Record<string, unknown> = {
      updated_at: nowIso,
    };
    if (nameToSave !== row.name) update.name = nameToSave;
    if (newPath !== oldPath) update.path = newPath;
    if (type && type !== row.type) update.type = type;
    if (category && category !== row.category) update.category = category;
    if (newTags) update.tags = JSON.stringify(newTags);

    try {
      if (Object.keys(update).length > 1) {
        await FileModel.update(update, { where: { file_id: fileId } });
      }
    } catch (e) {
      // Try rollback rename if possible
      if (renamedOnDisk) {
        try { await fsp.rename(newPath, oldPath); } catch { /* ignore */ }
      }
      logger.error("DB update failed in updateFileHandler", e as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "DB_UPDATE_FAILED", message: "Failed to update file record", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        file_id: fileId,
        name: nameToSave,
        path: newPath,
        type,
        category,
        tags: newTags ?? (row.tags ? JSON.parse(row.tags) : []),
        renamed: renamedOnDisk,
        updated_at: nowIso,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/update failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Update file failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Handlers --------
export async function previewFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { file_path?: unknown; origin?: unknown; max_width?: unknown; max_height?: unknown } | undefined;
    const filePath = typeof body?.file_path === "string" ? body.file_path : undefined;
  const origin = typeof body?.origin === "boolean" ? body.origin : true;
  const mw = toNumber(body?.max_width, 0);
  const mh = toNumber(body?.max_height, 0);
  const maxWidth = mw > 0 ? Math.min(4096, mw) : 0;
  const maxHeight = mh > 0 ? Math.min(4096, mh) : 0;
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
        error: { code: "INVALID_REQUEST", message: "file_path must be an absolute path", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_path is not a file", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const ext = path.extname(filePath).replace(/^\./, "");
    const mime = getMimeByExt(ext);
    const size = stat.size;

    if (isImageExt(ext)) {
      try {
        let data: Buffer;
        if (!origin && (maxWidth > 0 || maxHeight > 0)) {
          // Lazy load sharp to avoid dependency if not needed elsewhere
          // Try requiring sharp normally; in packaged app also attempt to load from extraResources
          // Use unknown to avoid any, cast at call site
          let sharpMod: unknown;
          try {
            sharpMod = (await import('sharp')).default;
          } catch (e) {
            try {
              const appRoot = app.getAppPath();
              // When packaged with electron-builder, extra resources are placed alongside app.asar
              const candidate = path.resolve(appRoot, '..', 'resources', 'sharp');
              sharpMod = require(path.join(candidate, 'lib', 'sharp')); // attempt common path
            } catch {
              throw e;
            }
          }
          const image = (sharpMod as (fp: string, opts?: unknown) => { resize: (o: unknown) => { toBuffer: () => Promise<Buffer> } })(filePath, { failOn: 'none' });
          const resized = image.resize({
            width: maxWidth > 0 ? maxWidth : undefined,
            height: maxHeight > 0 ? maxHeight : undefined,
            fit: 'inside',
            withoutEnlargement: true,
          });
          data = await resized.toBuffer();
        } else {
          data = await fsp.readFile(filePath);
        }
        const base64 = data.toString('base64');
        res.status(200).json({
          success: true,
          message: 'ok',
          data: {
            file_path: filePath,
            file_type: 'image',
            mime_type: mime,
            content: `data:${mime};base64,${base64}`,
            size,
            origin,
            max_width: maxWidth > 0 ? maxWidth : null,
            max_height: maxHeight > 0 ? maxHeight : null,
          },
          error: null,
          timestamp: new Date().toISOString(),
          request_id: '',
        });
        return;
      } catch (e) {
        logger.warn('Image resize/encode failed, falling back to original', { err: String(e) });
        const data = await fsp.readFile(filePath);
        const base64 = data.toString('base64');
        res.status(200).json({
          success: true,
          message: 'ok',
          data: {
            file_path: filePath,
            file_type: 'image',
            mime_type: mime,
            content: `data:${mime};base64,${base64}`,
            size,
          },
          error: null,
          timestamp: new Date().toISOString(),
          request_id: '',
        });
        return;
      }
    }

    // Text-like preview (default)
    const fd = await fsp.open(filePath, "r");
    try {
      const bytesToRead = Math.min(MAX_TEXT_PREVIEW_BYTES, size);
      const buffer = Buffer.alloc(bytesToRead);
      await fd.read({ buffer, position: 0, length: bytesToRead });
      const { text, encoding } = decodeTextBuffer(buffer);
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          file_path: filePath,
          file_type: "text",
          mime_type: mime.startsWith("image/") ? "text/plain" : mime,
          content: text,
          size,
          truncated: size > MAX_TEXT_PREVIEW_BYTES,
          encoding,
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } finally {
      await fd.close();
    }
  } catch (err) {
    logger.error("/api/files/preview failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Preview failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- List Directory Recursive --------
interface ListDirRecursiveBody {
  directory_path?: unknown;
  max_depth?: unknown;
}

function iso(d: Date | null | undefined): string | null {
  try {
    return d ? new Date(d).toISOString() : null;
  } catch {
    return null;
  }
}

async function countImmediateChildren(absDir: string): Promise<number> {
  try {
    const list = await fsp.readdir(absDir);
    return list.length;
  } catch {
    return 0;
  }
}

function resolveDirectoryBase(inputPath: string): string | null {
  // absolute path
  if (path.isAbsolute(inputPath)) return path.normalize(inputPath);
  const candidates: string[] = [];
  try {
    const appRoot = app.getAppPath();
    // Try a few likely bases (dev/build)
    candidates.push(path.resolve(process.cwd(), inputPath));
    candidates.push(path.resolve(appRoot, inputPath));
    candidates.push(path.resolve(appRoot, "..", inputPath));
    candidates.push(path.resolve(appRoot, "..", "..", inputPath));
  } catch {
    candidates.push(path.resolve(process.cwd(), inputPath));
  }
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isDirectory()) return path.normalize(c);
    } catch {
      // continue
    }
  }
  return null;
}

export async function listDirectoryRecursiveHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ListDirRecursiveBody | undefined;
    const dirInput = typeof body?.directory_path === "string" ? body.directory_path : undefined;
    const depthInput = toNumber(body?.max_depth, 3);
    const maxDepth = Math.max(1, Math.min(10, depthInput));

    if (!dirInput || !dirInput.trim()) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "directory_path is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const baseAbs = resolveDirectoryBase(dirInput);
    if (!baseAbs) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "directory not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const rootStat = await fsp.stat(baseAbs);
    if (!rootStat.isDirectory()) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "directory_path is not a directory", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    type Item = {
      name: string;
      type: "file" | "folder";
      path: string;
      relative_path: string;
      depth: number;
      size?: number | null;
      created_at?: string | null;
      modified_at?: string | null;
      item_count?: number | null;
    };
    const items: Item[] = [];

    // Root folder entry
    items.push({
      name: path.basename(baseAbs),
      type: "folder",
      path: baseAbs,
      relative_path: ".",
      depth: 0,
      size: null,
      created_at: iso(rootStat.birthtime),
      modified_at: iso(rootStat.mtime),
      item_count: await countImmediateChildren(baseAbs),
    });

    // BFS traversal up to maxDepth
    const queue: Array<{ dir: string; depth: number }> = [{ dir: baseAbs, depth: 0 }];
    while (queue.length > 0) {
      const { dir, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      let dirents: fs.Dirent[] = [];
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        logger.warn("Failed to read directory", { dir, err: String(err) });
        continue;
      }

      for (const de of dirents) {
        const full = path.join(dir, de.name);
        let st: fs.Stats | null = null;
        try {
          st = await fsp.lstat(full);
        } catch {
          continue;
        }
        // Avoid cycles
        if (st.isSymbolicLink()) continue;
        const itemDepth = depth + 1;
        const rel = path.relative(baseAbs, full) || ".";

        if (de.isDirectory()) {
          let cnt: number | null = null;
          try { cnt = await countImmediateChildren(full); } catch { cnt = null; }
          items.push({
            name: de.name,
            type: "folder",
            path: full,
            relative_path: rel.replace(/\\/g, "/"),
            depth: itemDepth,
            size: null,
            created_at: iso(st.birthtime),
            modified_at: iso(st.mtime),
            item_count: cnt,
          });
          queue.push({ dir: full, depth: itemDepth });
        } else if (de.isFile()) {
          items.push({
            name: de.name,
            type: "file",
            path: full,
            relative_path: rel.replace(/\\/g, "/"),
            depth: itemDepth,
            size: st.size,
            created_at: iso(st.birthtime),
            modified_at: iso(st.mtime),
            item_count: null,
          });
        } else {
          // Skip special types
          continue;
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        directory_path: baseAbs,
        max_depth: maxDepth,
        items,
        total_count: items.length,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/list-directory-recursive failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "List directory failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// Import a file into RAG pipeline: convert to txt, chunk, embed via Ollama
export async function importToRagHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { file_id?: unknown; chunk_size?: unknown; overlap?: unknown; model?: unknown; content?: unknown } | undefined;
    const fileId = typeof body?.file_id === "string" ? body.file_id : undefined;
    const chunkSize = toNumber(body?.chunk_size, 1000);
    const overlap = toNumber(body?.overlap, 200);
    const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined;
    const overrideContent = typeof body?.content === "string" ? body.content : undefined;

    if (!fileId) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }
    // Load file record from DB
    const record = await FileModel.findOne({ where: { file_id: fileId }, raw: true }).catch(() => null);
    if (!record) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "file record not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const filePath = (record as { path: string }).path;
    const st = await fsp.stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "file path missing on disk", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Detect file type
    const ext = path.extname(filePath).replace(/^\./, "").toLowerCase();
    const isImage = isImageExt(ext);

    let txtPath: string | null = null;
    let content: string;
    if (overrideContent && overrideContent.trim()) {
      // Use provided content directly
      content = overrideContent;
    } else if (isImage) {
      // Read image and send to vision model
      const buf = await fsp.readFile(filePath);
      const base64 = buf.toString("base64");
      let description = "";
      const cfg = configManager.getConfig();
      const language = normalizeLanguage(cfg.language ?? "zh", "zh");
      const visionPrompt = buildVisionDescribePrompt(language);
      try {
        description = await describeImage(base64, { prompt: visionPrompt });
      } catch (e) {
        logger.warn("Image description via vision provider failed, continuing with empty description", e as unknown);
        description = "";
      }
      // Save a temp txt containing the description for chunking/embedding
      const tempDir = await ensureTempDir();
      txtPath = path.join(tempDir, `${Date.now()}_${path.basename(filePath, path.extname(filePath))}_vision.txt`);
      content = description || `Image file ${path.basename(filePath)}.`;
      await fsp.writeFile(txtPath, content, "utf8");
    } else {
      // ensure .txt for non-image
      txtPath = await ensureTxtFile(filePath);
      content = await fsp.readFile(txtPath, "utf8");
    }
    // 2) chunk
    const chunks = chunkText(content, chunkSize, overlap);
    // 3) embed via active provider
    const embeddings = await embedText(chunks, model);
    if (embeddings.length !== chunks.length) {
      throw new Error("Embeddings count does not match chunks count");
    }

    // 4) Persist chunks to DB (replace existing for file_id)
    const nowIso = new Date().toISOString();
    // Capture previous chunk row ids to remove stale vectors from FAISS
    const prevChunkRows = (await ChunkModel.findAll({ where: { file_id: fileId }, attributes: ["id"], raw: true }).catch(() => [])) as Array<{ id: number }>;
    const prevChunkIds = prevChunkRows.map((r) => r.id);
    // naive replace: delete then bulk create
    try {
      await ChunkModel.destroy({ where: { file_id: fileId } });
    } catch (e) {
      logger.warn("Failed to clear existing chunks", e as unknown);
    }
    const bulkRows = chunks.map((c, i) => ({
      chunk_id: `${fileId}_chunk_${i}`,
      file_id: fileId,
      chunk_index: i,
      content: c,
      content_type: "text",
      char_count: c.length,
      token_count: c.split(/\s+/).filter(Boolean).length,
      embedding_id: `${fileId}_chunk_${i}`,
      start_pos: null as number | null,
      end_pos: null as number | null,
      created_at: nowIso,
    }));
    await ChunkModel.bulkCreate(bulkRows);
    // Re-query to get actual chunk IDs in correct order
    const savedChunks = await ChunkModel.findAll({ where: { file_id: fileId }, order: [["chunk_index", "ASC"]], raw: true }) as Array<{ id: number; chunk_index: number }>;
    const chunkIds = savedChunks.map((r) => r.id);

    const fileUpdate: { processed: boolean; updated_at: string; summary?: string } = {
      processed: true,
      updated_at: nowIso,
    };
    if (isImage && content) {
      fileUpdate.summary = content;
    }
    try {
      await FileModel.update(fileUpdate, { where: { file_id: fileId } });
    } catch (e) {
      logger.warn("Failed to update file metadata after RAG import", e as unknown);
    }

    // 5) Update global FAISS index using chunk IDs as vector IDs
    try {
      // Remove stale vectors by previous chunk row ids, then add fresh ones
      await updateGlobalFaissIndex({ addIds: chunkIds, vectors: embeddings, removeIds: prevChunkIds });
    } catch (e) {
      logger.error("Failed to update global FAISS index", e as unknown);
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        file_id: fileId,
        file_path: filePath,
        txt_path: txtPath,
        chunk_count: chunks.length,
        embedding_count: embeddings.length,
        dims: embeddings[0]?.length ?? 0,
        used_content_source: overrideContent && overrideContent.trim() ? "request.content" : (isImage ? "vision" : "converted_file"),
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/import-to-rag failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "IMPORT_RAG_ERROR", message: (err as Error).message, details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Delete File (and RAG) --------
interface DeleteFileBody {
  file_id?: unknown;
  confirm_delete?: unknown; // whether to delete the actual file from disk; default false
}

export async function deleteFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as DeleteFileBody | undefined;
    const fileId = typeof body?.file_id === "string" ? body.file_id.trim() : "";
    const confirmDelete = typeof body?.confirm_delete === "boolean" ? body.confirm_delete : false;

    if (!fileId) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Load file record
    const fileRow = await FileModel.findOne({ where: { file_id: fileId }, raw: true }).catch(() => null) as
      | {
          file_id: string;
          path: string;
        }
      | null;
    if (!fileRow) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "file not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Find all chunks belonging to this file
    const chunks = (await ChunkModel.findAll({ where: { file_id: fileId }, raw: true }).catch(() => [])) as Array<{
      id: number;
    }>;

    // Remove from FAISS global index by external IDs (chunk row ids)
    if (chunks.length > 0) {
      const removeIds = chunks.map((c) => c.id);
      try {
        await updateGlobalFaissIndex({ addIds: [], vectors: [], removeIds });
      } catch (e) {
        logger.warn("Failed to remove chunk vectors from FAISS index during delete", e as unknown);
        // proceed even if vector removal fails
      }
    }

    // Delete chunk rows
    try {
      await ChunkModel.destroy({ where: { file_id: fileId } });
    } catch (e) {
      logger.warn("Failed to delete chunk rows", e as unknown);
    }

    // Optionally delete the actual file from disk
    if (confirmDelete) {
      const absPath = fileRow.path;
      try {
        if (absPath && typeof absPath === "string") {
          await fsp.unlink(absPath);
        }
      } catch (e) {
        // If file missing or cannot delete, log but continue
        logger.warn("Failed to delete file from disk", { path: absPath, err: String(e) });
      }
    }

    // Delete the file record itself
    try {
      await FileModel.destroy({ where: { file_id: fileId } });
    } catch (e) {
      logger.warn("Failed to delete file record", e as unknown);
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: { file_id: fileId, rag_removed_chunks: chunks.length, file_deleted: confirmDelete },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/delete failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Delete file failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function saveFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as {
      source_file_path?: unknown;
      target_directory?: unknown;
      overwrite?: unknown;
    } | undefined;

    const source = typeof body?.source_file_path === "string" ? body.source_file_path : undefined;
    const targetDirInput = typeof body?.target_directory === "string" ? body.target_directory : undefined;
    const overwrite = typeof body?.overwrite === "boolean" ? body.overwrite : false;

    if (!source || !targetDirInput) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "source_file_path and target_directory are required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const srcStat = await fsp.stat(source).catch(() => null);
    if (!srcStat || !srcStat.isFile()) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "source file does not exist", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    if (!path.isAbsolute(targetDirInput)) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "target_directory must be an absolute path", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const absTargetDir = path.normalize(targetDirInput);

    await fsp.mkdir(absTargetDir, { recursive: true });

    const baseName = path.basename(source);
    let destPath = path.join(absTargetDir, baseName);
    let overwritten = false;

    const exists = await fsp
      .access(destPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      if (overwrite) {
        overwritten = true;
      } else {
        const ext = path.extname(baseName);
        const nameOnly = path.basename(baseName, ext);
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        destPath = path.join(absTargetDir, `${nameOnly}_${ts}${ext}`);
      }
    }

    // Copy file
    await fsp.copyFile(source, destPath);

    // After successful copy, insert a record into database
    // Determine file metadata
    let destStat: fs.Stats | null = null;
    try {
      destStat = await fsp.stat(destPath);
    } catch (e) {
      // If we cannot stat, treat as error and attempt cleanup
      logger.error("Stat on saved file failed", e as unknown);
      try { await fsp.unlink(destPath); } catch { /* ignore */ }
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "SAVE_FILE_ERROR", message: "Saved file but failed to validate", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const ext = path.extname(baseName).replace(/^\./, "").toLowerCase();
    const mime = getMimeByExt(ext);
    // Infer category by extension
    let category = "other";
    for (const [cat, exts] of Object.entries(CATEGORY_EXTENSIONS)) {
      if (cat === "other") continue;
      if (exts.includes(ext)) { category = cat; break; }
    }

    const nowIso = new Date().toISOString();
    const newFileId = randomUUID();
    try {
      await FileModel.create({
        file_id: newFileId,
        path: destPath,
        name: path.basename(destPath),
        type: mime,
        category,
        summary: null,
        tags: JSON.stringify([]),
        size: destStat.size,
        created_at: nowIso,
        updated_at: null,
        processed: false,
      });
    } catch (e) {
      logger.error("DB insert failed after saving file", e as unknown);
      // Best effort rollback: remove the copied file to keep consistency
      try { await fsp.unlink(destPath); } catch { /* ignore */ }
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "DB_INSERT_ERROR", message: "Failed to insert file record", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Auto-tagging and summary (document/image) per configuration
    let autoTags: string[] = [];
    let autoSummary: string | null = null;
    try {
      const cfg = configManager.getConfig();
      const autoTagEnabled = Boolean(cfg.autoTagEnabled);
      if (autoTagEnabled) {
        const language = normalizeLanguage(cfg.language ?? "zh", "zh");
        const tagTopK = 10;
        const maxLen = Math.max(100, Math.min(5000, Number(cfg.tagSummaryMaxLength) || 1000));

        // Helper to extract tags from text using LLM structured output
        const extractTagsFromText = async (text: string): Promise<string[]> => {
          const snippet = text.length > 5000 ? text.slice(0, 5000) : text;
          const messages: LlmMessage[] = buildExtractTagsMessages({ language, text: snippet, topK: tagTopK, domainHint: "" });
          const responseFormat: StructuredResponseFormat = {
            json_schema: {
              name: "extract_tags_schema",
              schema: {
                type: "object",
                properties: {
                  tags: { type: "array", items: { type: "string" } },
                },
                required: ["tags"],
                additionalProperties: false,
              },
              strict: true,
            },
          } as const;
          let result: unknown = {};
          try {
            result = await generateStructuredJson(messages, responseFormat, 0.2, 800, "", language);
          } catch (e) {
            logger.warn("Auto-tag generateStructuredJson failed", e as unknown);
            return [];
          }
          const obj = (result || {}) as Record<string, unknown>;
          const tags = Array.isArray(obj.tags)
            ? (obj.tags as unknown[])
                .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
                .map((t) => t.trim())
            : [];
          return tags;
        };

        if (category === "image") {
          // Image: describe then extract tags
          try {
            const buf = await fsp.readFile(destPath);
            const base64 = buf.toString("base64");
            const visionPrompt = buildVisionDescribePrompt(language);
            const desc = await describeImage(base64, { prompt: visionPrompt });
            autoSummary = (desc || "").trim() || null;
            if (autoSummary) {
              autoTags = await extractTagsFromText(autoSummary);
            }
          } catch (e) {
            logger.warn("Auto-tag image processing failed", e as unknown);
          }
        } else if (category === "document") {
          // Document: convert to text, take snippet, then extract tags
          try {
            let textContent = "";
            try {
              const txtPath = await ensureTxtFile(destPath);
              textContent = await fsp.readFile(txtPath, "utf8");
            } catch (convErr) {
              // If conversion fails, try direct read for simple text-like files
              try {
                textContent = await fsp.readFile(destPath, "utf8");
              } catch {
                textContent = "";
              }
            }
            if (textContent && textContent.trim()) {
              autoSummary = textContent.slice(0, maxLen);
              autoTags = await extractTagsFromText(autoSummary);
            }
          } catch (e) {
            logger.warn("Auto-tag document processing failed", e as unknown);
          }
        }

        // Persist when we have any result
        if ((autoSummary && autoSummary.length > 0) || (autoTags && autoTags.length > 0)) {
          const update: { summary?: string | null; tags?: string | null; updated_at: string } = {
            updated_at: new Date().toISOString(),
          };
          if (autoSummary && autoSummary.length > 0) update.summary = autoSummary;
          if (autoTags && autoTags.length > 0) update.tags = JSON.stringify(autoTags);
          try {
            await FileModel.update(update, { where: { file_id: newFileId } });
          } catch (e) {
            logger.warn("Failed to update file with auto tags/summary", e as unknown);
          }
        }
      }
    } catch (e) {
      logger.warn("Auto-tag pipeline failed", e as unknown);
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        source_file_path: source,
        saved_path: destPath,
        filename: path.basename(destPath),
        overwritten,
        file_id: newFileId,
        // optional enrichment for caller convenience
        tags: autoTags,
        summary: autoSummary ?? undefined,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/save-file failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "SAVE_FILE_ERROR", message: "Failed to save file", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Recommend Directory --------
export async function recommendDirectoryHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { file_path?: unknown; available_directories?: unknown; content?: unknown; provider?: unknown } | undefined;
    const filePath = typeof body?.file_path === "string" ? body.file_path : undefined;
    const availableDirs = Array.isArray(body?.available_directories)
      ? (body!.available_directories as unknown[]).filter((v) => typeof v === "string").map((v) => String(v))
      : [];
    const overrideContent = typeof body?.content === "string" ? body.content : undefined;
    // Optional provider override
    const providerRaw = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : undefined;
    const provider: ProviderName | undefined = providerRaw === "openai"
      ? "openai"
      : providerRaw === "azure-openai" || providerRaw === "azure" || providerRaw === "azure_openai"
      ? "azure-openai"
      : providerRaw === "openrouter"
      ? "openrouter"
      : providerRaw === "bailian" || providerRaw === "aliyun" || providerRaw === "dashscope"
      ? "bailian"
      : providerRaw === "ollama"
      ? "ollama"
      : undefined;

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
        error: { code: "INVALID_REQUEST", message: "file_path must be an absolute path", details: null },
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
        error: { code: "SOURCE_FILE_MISSING", message: "source file does not exist", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const filename = path.basename(filePath);

    // Convert to text for analysis unless content is provided
    let txtPath: string | null = null;
    let content: string;
    if (overrideContent && overrideContent.trim()) {
      content = overrideContent;
      txtPath = null;
    } else {
      txtPath = await ensureTxtFile(filePath);
      content = await fsp.readFile(txtPath, "utf8");
    }
    const snippet = content.slice(0, 500);

    // Build messages and JSON schema per API.md
    const directoriesList = availableDirs.length > 0 ? availableDirs.join("\n") : "";
    const messages = [
      {
        role: "system" as const,
        content:
          "You are a file classification expert. Recommend the most appropriate directory to store the file. Output JSON only, no extra text.",
      },
      {
        role: "user" as const,
        content:
          `Available directories (one per line, may be empty):\n${directoriesList}\n\nFile name: ${filename}\nFile content (first 500 chars): ${snippet}\n\nReturn JSON with fields: recommended_directory (string), confidence (number 0-1), reasoning (string), alternatives (array of strings). Do not include any other fields.`,
      },
    ];

    const responseFormat = {
      json_schema: {
        name: "recommend_directory_schema",
        schema: {
          type: "object",
          properties: {
            recommended_directory: { type: "string" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
            alternatives: { type: "array", items: { type: "string" } },
          },
          required: ["recommended_directory", "confidence", "reasoning", "alternatives"],
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
  result = await generateStructuredJson(messages, responseFormat, 0.7, 1000, "", undefined, provider);
    } catch (err) {
      logger.error("LLM recommend-directory call failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (err as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Basic runtime validation
    const obj = result as Record<string, unknown>;
    const recommended_directory = typeof obj?.recommended_directory === "string" ? (obj.recommended_directory as string) : "未分类";
    const confidence = typeof obj?.confidence === "number" ? (obj.confidence as number) : 0.0;
    const reasoning = typeof obj?.reasoning === "string" ? (obj.reasoning as string) : "";
    const alternatives = Array.isArray(obj?.alternatives) ? (obj.alternatives as unknown[]).filter((v) => typeof v === "string").map((v) => String(v)) : [];

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        file_path: filePath,
        filename,
        recommended_directory,
        confidence: Math.max(0, Math.min(1, confidence)),
        reasoning,
        alternatives,
        used_content_source: overrideContent && overrideContent.trim() ? "request.content" : "converted_file",
        txt_path: txtPath,
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/recommend-directory failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "ANALYSIS_ERROR", message: "Recommend directory failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Chunks: List and Content --------
interface ChunkListBody {
  file_id?: unknown;
  page?: unknown;
  limit?: unknown;
}

export async function listChunksHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ChunkListBody | undefined;
    const fileId = typeof body?.file_id === "string" ? body.file_id : undefined;
    const page = Math.max(1, toNumber(body?.page, 1));
    const limit = Math.max(1, Math.min(100, toNumber(body?.limit, 50)));

    if (!fileId) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const totalCount = await ChunkModel.count({ where: { file_id: fileId } });
    const offset = (page - 1) * limit;
    const rows = await ChunkModel.findAll({
      where: { file_id: fileId },
      order: [["chunk_index", "ASC"]],
      limit,
      offset,
      raw: true,
    });

    type RawChunkRow = {
      chunk_id: string;
      file_id: string;
      chunk_index: number;
      content: string;
      content_type: string;
      char_count: number;
      token_count: number | null;
      embedding_id: string | null;
      created_at: string;
    };

    const chunks = (rows as RawChunkRow[]).map((r) => ({
      id: r.chunk_id,
      file_id: r.file_id,
      chunk_index: r.chunk_index,
      content: r.content.length > 200 ? r.content.slice(0, 200) + "..." : r.content,
      content_type: r.content_type,
      char_count: r.char_count,
      token_count: r.token_count,
      embedding_id: r.embedding_id,
      created_at: r.created_at,
    }));

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        chunks,
        pagination: {
          current_page: page,
          total_pages: Math.max(1, Math.ceil(totalCount / limit)),
          total_count: totalCount,
          limit,
        },
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/chunks/list failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to list chunks", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

export async function getChunkContentHandler(req: Request, res: Response): Promise<void> {
  try {
    const chunkId = req.params?.chunk_id;
    if (!isNonEmptyString(chunkId)) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "chunk_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    interface ChunkRow {
      chunk_id: string;
      file_id: string;
      chunk_index: number;
      content: string;
      content_type: string;
      char_count: number;
      token_count: number | null;
      embedding_id: string | null;
      created_at: string;
    }

    const chunk = (await ChunkModel.findOne({ where: { chunk_id: chunkId }, raw: true }).catch(() => null)) as
      | ChunkRow
      | null;
    if (!chunk) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "chunk not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    // Fetch file info for name and path
    const fileRow = (await FileModel.findOne({ where: { file_id: chunk.file_id }, raw: true }).catch(() => null)) as
      | { name: string; path: string }
      | null;

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
  id: chunk.chunk_id,
  file_id: chunk.file_id,
  chunk_index: chunk.chunk_index,
  content: chunk.content,
  content_type: chunk.content_type,
  char_count: chunk.char_count,
  token_count: chunk.token_count,
  embedding_id: chunk.embedding_id,
  created_at: chunk.created_at,
        file_name: fileRow?.name ?? "",
        file_path: fileRow?.path ?? "",
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/chunks/:chunk_id failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to get chunk content", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- File details --------
export async function getFileDetailsHandler(req: Request, res: Response): Promise<void> {
  try {
    const fileId = req.params?.file_id;
    if (!isNonEmptyString(fileId)) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "file_id is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const row = (await FileModel.findOne({ where: { file_id: fileId }, raw: true }).catch(() => null)) as
      | {
          file_id: string;
          name: string;
          path: string;
          type: string;
          category: string;
          summary: string | null;
          tags: string | null;
          size: number;
          created_at: string;
          updated_at: string | null;
          processed?: boolean | number | null;
        }
      | null;

    if (!row) {
      res.status(404).json({
        success: false,
        message: "not_found",
        data: null,
        error: { code: "RESOURCE_NOT_FOUND", message: "file not found", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const chunksCount = await ChunkModel.count({ where: { file_id: fileId } }).catch(() => 0);

    // Parse tags JSON
    let tags: string[] = [];
    try {
      tags = row.tags ? (JSON.parse(row.tags) as string[]) : [];
      if (!Array.isArray(tags)) tags = [];
    } catch {
      tags = [];
    }

    // Filesystem metadata
    let createdDate: string | null = null;
    let modifiedDate: string | null = null;
    try {
      const st = await fsp.stat(row.path);
      // On Windows, birthtime is creation time
      createdDate = st.birthtime ? new Date(st.birthtime).toISOString() : null;
      modifiedDate = st.mtime ? new Date(st.mtime).toISOString() : null;
    } catch {
      // leave nulls
    }

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        file_id: row.file_id,
        name: row.name,
        path: row.path,
        type: row.type,
        category: row.category,
        summary: row.summary ?? "",
        tags,
        size: row.size,
        chunks_count: chunksCount,
  created_at: row.created_at,
        updated_at: row.updated_at,
        metadata: {
          author: "",
          created_date: createdDate,
          modified_date: modifiedDate,
        },
        processed: Boolean(row.processed ?? false),
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("GET /api/files/:file_id failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Failed to get file details", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}

// -------- Extract Tags via LLM and optionally save to file record --------
interface ExtractTagsBody {
  text?: unknown; // required: direct text to analyze
  top_k?: unknown; // default 10
  language?: unknown; // 'zh' | 'en'
  domain_hint?: unknown; // optional domain hint to improve tags
  provider?: unknown; // optional override provider name
}

export async function extractTagsHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ExtractTagsBody | undefined;
    const rawText = typeof body?.text === "string" ? body.text : "";
    const topK = Math.max(1, Math.min(50, toNumber(body?.top_k, 10)));
    const language = normalizeLanguage(body?.language ?? (configManager.getConfig().language ?? "zh"), "zh");
    const domainHint = typeof body?.domain_hint === "string" ? body.domain_hint : "";
    const providerRaw = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : undefined;
    const provider: ProviderName | undefined = providerRaw === "openai"
      ? "openai"
      : providerRaw === "azure-openai" || providerRaw === "azure" || providerRaw === "azure_openai"
      ? "azure-openai"
      : providerRaw === "openrouter"
      ? "openrouter"
      : providerRaw === "bailian" || providerRaw === "aliyun" || providerRaw === "dashscope"
      ? "bailian"
      : providerRaw === "ollama"
      ? "ollama"
      : undefined;
    const text = rawText;
    if (!text || !text.trim()) {
      res.status(400).json({
        success: false,
        message: "invalid_request",
        data: null,
        error: { code: "INVALID_REQUEST", message: "text is required", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const snippet = text.length > 5000 ? text.slice(0, 5000) : text;
    const messages: LlmMessage[] = buildExtractTagsMessages({ language, text: snippet, topK, domainHint });
    const responseFormat: StructuredResponseFormat = {
      json_schema: {
        name: "extract_tags_schema",
        schema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["tags"],
          additionalProperties: false,
        },
        strict: true,
      },
    } as const;

    let result: unknown;
    try {
  result = await generateStructuredJson(messages, responseFormat, 0.2, 800, "", language, provider);
    } catch (e) {
      logger.error("/api/files/extract-tags LLM failed", e as unknown);
      res.status(500).json({
        success: false,
        message: "llm_error",
        data: null,
        error: { code: "LLM_ERROR", message: (e as Error).message, details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
    }

    const obj = (result || {}) as Record<string, unknown>;
    const tags = Array.isArray(obj.tags)
      ? (obj.tags as unknown[])
          .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim())
      : [];

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        tags,
        model_used: getActiveModelName("chat", provider),
      },
      error: null,
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  } catch (err) {
    logger.error("/api/files/extract-tags failed", err as unknown);
    res.status(500).json({
      success: false,
      message: "internal_error",
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Extract tags failed", details: null },
      timestamp: new Date().toISOString(),
      request_id: "",
    });
  }
}


export function registerFilesRoutes(app: Express) {
  // POST /api/files/list
  app.post("/api/files/list", listFilesHandler);
  // POST /api/files/preview
  app.post("/api/files/preview", previewFileHandler);
  // POST /api/files/save-file
  app.post("/api/files/save-file", saveFileHandler);
  // POST /api/files/update
  app.post("/api/files/update", updateFileHandler);
  // POST /api/files/import-to-rag
  app.post("/api/files/import-to-rag", importToRagHandler);
  // POST /api/files/list-directory-recursive
  app.post("/api/files/list-directory-recursive", listDirectoryRecursiveHandler);
  // POST /api/files/recommend-directory
  app.post("/api/files/recommend-directory", recommendDirectoryHandler);
  // POST /api/files/chunks/list
  app.post("/api/files/chunks/list", listChunksHandler);
  // GET /api/files/chunks/{chunk_id}
  app.get("/api/files/chunks/:chunk_id", getChunkContentHandler);
  // GET /api/files/{file_id}
  app.get("/api/files/:file_id", getFileDetailsHandler);
  // POST /api/files/delete
  app.post("/api/files/delete", deleteFileHandler);
  // POST /api/files/extract-tags
  app.post("/api/files/extract-tags", extractTagsHandler);
}
