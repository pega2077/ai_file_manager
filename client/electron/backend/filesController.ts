import type { Request, Response, Express } from "express";
import { Op, WhereOptions } from "sequelize";
import FileModel from "./models/file";
import { logger } from "../logger";

interface ListFilesRequestBody {
  page?: unknown;
  limit?: unknown;
  category?: unknown;
  type?: unknown;
  search?: unknown;
  tags?: unknown;
}

const CATEGORY_EXTENSIONS: Record<string, string[]> = {
  document: ["txt", "doc", "docx", "pdf", "ppt", "pptx", "rtf", "odt", "ods", "odp"],
  sheet: ["xlsx", "xls", "csv", "ods"],
  image: ["jpg", "png", "gif", "jpeg", "bmp", "tiff", "tif", "webp", "svg"],
  video: ["mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v"],
  audio: ["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
  other: [],
};

function toNumber(val: unknown, def: number): number {
  const n = typeof val === "string" || typeof val === "number" ? Number(val) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseTags(v: unknown): string[] | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim());
  return undefined;
}

export function registerFilesRoutes(app: Express) {
  // POST /api/files/list
  app.post("/api/files/list", async (req: Request, res: Response) => {
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
  });
}
