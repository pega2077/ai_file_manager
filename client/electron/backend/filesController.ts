import type { Request, Response, Express } from "express";
import { Op, WhereOptions } from "sequelize";
import FileModel from "./models/file";
import { logger } from "../logger";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { MAX_TEXT_PREVIEW_BYTES, getMimeByExt, isImageExt, decodeTextBuffer, CATEGORY_EXTENSIONS, toNumber, isNonEmptyString, parseTags } from "./utils/fileHelpers";

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
    const rows = await FileModel.findAll({
      where,
      order: [["added_at", "DESC"]],
      limit,
      offset,
      raw: true,
    });

    type RawFileRow = {
      file_id: string;
      name: string;
      path: string;
      type: string;
      category: string;
      summary: string | null;
      tags: string | null;
      size: number;
      added_at: string;
      updated_at: string | null;
    };
    const files = rows.map((row: RawFileRow) => {
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
        added_at: row.added_at,
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

export function registerFilesRoutes(app: Express) {
  // POST /api/files/list
  app.post("/api/files/list", listFilesHandler);
  // POST /api/files/preview
  app.post("/api/files/preview", previewFileHandler);
  // POST /api/files/save-file
  app.post("/api/files/save-file", saveFileHandler);
}

// -------- Handlers --------
export async function previewFileHandler(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as { file_path?: unknown } | undefined;
    const filePath = typeof body?.file_path === "string" ? body.file_path : undefined;
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
      const data = await fsp.readFile(filePath);
      const base64 = data.toString("base64");
      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          file_path: filePath,
          file_type: "image",
          mime_type: mime,
          content: `data:${mime};base64,${base64}`,
          size,
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
      return;
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

    res.status(200).json({
      success: true,
      message: "ok",
      data: {
        source_file_path: source,
        saved_path: destPath,
        filename: path.basename(destPath),
        overwritten,
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
