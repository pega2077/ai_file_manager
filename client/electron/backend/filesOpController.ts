import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { logger } from "../logger";

// Dynamic import for Electron to support both standalone and Electron modes
let app: any = null;

/**
 * Lazy-load Electron app if available
 */
function getElectronApp(): any {
  if (app === null) {
    try {
      // Only import electron if available (Electron environment)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      app = electron.app;
    } catch {
      // Standalone mode - electron not available
      app = false; // Set to false to indicate we've tried and failed
    }
  }
  return app === false ? null : app;
}

type CreateFoldersBody = {
  target_folder?: unknown;
  structure?: unknown;
};

type ListDirectoryBody = {
  directory_path?: unknown;
};

type MkdirBody = {
  directory_path?: unknown;
};

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

/**
 * Resolve a possibly relative directory path to an absolute existing directory.
 * If input is absolute, normalize and return as-is when exists. For relative inputs,
 * try a few common bases (cwd, appRoot, appRoot/.., appRoot/../..) to locate an existing dir.
 * Returns null when cannot resolve to an existing directory.
 */
function resolveDirectoryBase(inputPath: string): string | null {
  if (path.isAbsolute(inputPath)) {
    try {
      const st = fs.statSync(inputPath);
      return st.isDirectory() ? path.normalize(inputPath) : null;
    } catch {
      return null;
    }
  }
  const candidates: string[] = [];
  try {
    const electronApp = getElectronApp();
    if (electronApp) {
      const appRoot = electronApp.getAppPath();
      candidates.push(path.resolve(process.cwd(), inputPath));
      candidates.push(path.resolve(appRoot, inputPath));
      candidates.push(path.resolve(appRoot, "..", inputPath));
      candidates.push(path.resolve(appRoot, "..", "..", inputPath));
    } else {
      candidates.push(path.resolve(process.cwd(), inputPath));
    }
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

export function registerFilesOpRoutes(appExp: Express): void {
  // POST /api/files/create-folders
  appExp.post("/api/files/create-folders", async (req: Request, res: Response) => {
    try {
      const body = req.body as CreateFoldersBody | undefined;
      const target = typeof body?.target_folder === "string" ? body!.target_folder.trim() : "";
      const structure = Array.isArray(body?.structure) ? (body!.structure as Array<unknown>) : [];

      if (!target) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "target_folder is required", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      // If target exists as dir, use it. If absolute but missing, create it. If relative, try resolve to existing.
      let baseAbs: string | null = null;
      if (path.isAbsolute(target)) {
        try {
          const st = await fsp.stat(target).catch(() => null);
          if (st?.isDirectory()) {
            baseAbs = path.normalize(target);
          } else {
            // Create base directory when absolute path does not exist
            await fsp.mkdir(target, { recursive: true });
            baseAbs = path.normalize(target);
          }
        } catch (e) {
          logger.error("Failed to prepare base target folder", e as unknown);
          res.status(500).json({
            success: false,
            message: "internal_error",
            data: null,
            error: { code: "INTERNAL_ERROR", message: "Failed to prepare target folder", details: null },
            timestamp: new Date().toISOString(),
            request_id: "",
          });
          return;
        }
      } else {
        baseAbs = resolveDirectoryBase(target);
        if (!baseAbs) {
          res.status(404).json({
            success: false,
            message: "not_found",
            data: null,
            error: { code: "RESOURCE_NOT_FOUND", message: "target_folder not found", details: null },
            timestamp: new Date().toISOString(),
            request_id: "",
          });
          return;
        }
      }

      // Validate structure entries
      type Entry = { name?: unknown; type?: unknown };
      const entries: Array<{ name: string; type: string }> = [];
      for (const raw of structure) {
        const e = raw as Entry;
        if (typeof e?.name === "string" && typeof e?.type === "string" && e.type.toLowerCase() === "folder") {
          const trimmed = e.name.trim();
          if (trimmed) entries.push({ name: trimmed, type: "folder" });
        }
      }

      if (entries.length === 0) {
        res.status(400).json({
          success: false,
          message: "invalid_request",
          data: null,
          error: { code: "INVALID_REQUEST", message: "structure must contain at least one folder entry", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      // Create folders
      let created = 0;
      for (const ent of entries) {
        // Support nested relative folder like "Dir/Sub"
        const relative = ent.name.replace(/[\\]+/g, "/");
        const abs = path.join(baseAbs, relative);
        try {
          await fsp.mkdir(abs, { recursive: true });
          created += 1;
        } catch (e) {
          logger.warn("Failed to create folder entry", { abs, err: String(e) });
        }
      }

      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          target_folder: baseAbs,
          folders_created: created,
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/create-folders failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Create folders failed", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });

  // POST /api/files/create-directory
  appExp.post("/api/files/create-directory", async (req: Request, res: Response) => {
    try {
      const body = req.body as MkdirBody | undefined;
      const dirInput = typeof body?.directory_path === "string" ? body!.directory_path.trim() : "";
      if (!dirInput) {
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

      let absPath: string | null = null;
      if (path.isAbsolute(dirInput)) {
        absPath = path.normalize(dirInput);
      } else {
        // Resolve relative base; if cannot resolve, create under cwd
        const resolved = resolveDirectoryBase(path.dirname(dirInput));
        if (resolved) {
          absPath = path.join(resolved, path.basename(dirInput));
        } else {
          absPath = path.resolve(process.cwd(), dirInput);
        }
      }

      try {
        await fsp.mkdir(absPath, { recursive: true });
      } catch (e) {
        logger.error("mkdir failed", e as unknown);
        res.status(500).json({
          success: false,
          message: "internal_error",
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Failed to create directory", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: "ok",
        data: { directory_path: absPath, created: true },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/create-directory failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Create directory failed", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });

  // POST /api/files/list-directory
  appExp.post("/api/files/list-directory", async (req: Request, res: Response) => {
    try {
      const body = req.body as ListDirectoryBody | undefined;
      const dirInput = typeof body?.directory_path === "string" ? body!.directory_path.trim() : "";
      if (!dirInput) {
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

      // Resolve directory: allow absolute or try known bases for relative
      let baseAbs: string | null = null;
      if (path.isAbsolute(dirInput)) {
        try {
          const st = await fsp.stat(dirInput);
          if (!st.isDirectory()) throw new Error("not a directory");
          baseAbs = path.normalize(dirInput);
        } catch {
          baseAbs = null;
        }
      } else {
        baseAbs = resolveDirectoryBase(dirInput);
      }

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

      // Read immediate children only
      let dirents: fs.Dirent[] = [];
      try {
        dirents = await fsp.readdir(baseAbs, { withFileTypes: true });
      } catch (e) {
        logger.error("readdir failed", e as unknown);
        res.status(500).json({
          success: false,
          message: "internal_error",
          data: null,
          error: { code: "INTERNAL_ERROR", message: "Failed to read directory", details: null },
          timestamp: new Date().toISOString(),
          request_id: "",
        });
        return;
      }

      type Item = {
        name: string;
        type: "file" | "folder";
        size: number | null;
        created_at: string | null;
        modified_at: string | null;
        item_count: number | null;
      };

      const items: Item[] = [];
      for (const de of dirents) {
        const full = path.join(baseAbs!, de.name);
        let st: fs.Stats | null = null;
        try {
          st = await fsp.lstat(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue; // skip symlinks to avoid cycles
        if (de.isDirectory()) {
          const count = await countImmediateChildren(full).catch(() => 0);
          items.push({
            name: de.name,
            type: "folder",
            size: null,
            created_at: iso(st.birthtime),
            modified_at: iso(st.mtime),
            item_count: count,
          });
        } else if (de.isFile()) {
          items.push({
            name: de.name,
            type: "file",
            size: st.size,
            created_at: iso(st.birthtime),
            modified_at: iso(st.mtime),
            item_count: null,
          });
        } else {
          // ignore others
          continue;
        }
      }

      res.status(200).json({
        success: true,
        message: "ok",
        data: {
          directory_path: baseAbs,
          items,
          total_count: items.length,
        },
        error: null,
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    } catch (err) {
      logger.error("/api/files/list-directory failed", err as unknown);
      res.status(500).json({
        success: false,
        message: "internal_error",
        data: null,
        error: { code: "INTERNAL_ERROR", message: "List directory failed", details: null },
        timestamp: new Date().toISOString(),
        request_id: "",
      });
    }
  });
}
