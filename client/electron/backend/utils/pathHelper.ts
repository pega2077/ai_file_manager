import { app } from "electron";
import path from "path";
import { promises as fsp } from "fs";
import fs from "fs";

/**
 * Resolve a writable temp directory based on environment.
 * - Development: use app.getAppPath()/temp (works in dev folders)
 * - Production: use path.dirname(app.getPath('exe'))/temp (writeable next to exe)
 * Ensures the directory exists and returns its absolute path.
 */
export async function ensureTempDir(): Promise<string> {
  let baseDir: string;
  if (app.isPackaged === false) {
    // Development mode: prefer app root; fallback to cwd if undefined
    const appRoot = app.getAppPath();
    baseDir = appRoot || process.cwd();
  } else {
    // Production mode: place temp next to the executable (Program Files can be read-only)
    baseDir = path.dirname(app.getPath("exe"));
  }

  const tempDir = path.join(baseDir, "temp");
  await fsp.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Resolve the base directory for app data according to env.
 * - Dev: app.getAppPath() or CWD
 * - Prod: directory of the executable
 */
export function getBaseDir(): string {
  try {
    if (app.isPackaged === false) {
      const appRoot = app.getAppPath();
      return appRoot || process.cwd();
    }
    return path.dirname(app.getPath("exe"));
  } catch {
    return process.cwd();
  }
}

/**
 * Resolve the repository/project root used for resources like database when a relative path is configured.
 * - Dev: usually two levels above app root (client/dist-electron -> repo root)
 * - Prod: one level above the executable directory (bundle root)
 */
export function resolveProjectRoot(): string {
  const base = getBaseDir();
  return app.isPackaged ? path.join(base, "..") : path.join(base, "..", "..");
}

/**
 * Resolve logs directory path and ensure it exists.
 * Uses the same baseDir policy and places logs under `<base>/logs`.
 */
export async function ensureLogsDir(): Promise<string> {
  const base = getBaseDir();
  const logsDir = path.join(base, "logs");
  await fsp.mkdir(logsDir, { recursive: true });
  return logsDir;
}

/** Sync variant for logger initialization. */
export function ensureLogsDirSync(): string {
  const base = getBaseDir();
  const logsDir = path.join(base, "logs");
  try {
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  } catch {
    // ignore, logger can fallback to console only
  }
  return logsDir;
}

/**
 * Resolve the absolute SQLite database path given a configured path (relative or absolute).
 * Relative paths are resolved against project root derived from env.
 */
export function resolveDatabaseAbsolutePath(configuredPath: string): string {
  const projectRoot = resolveProjectRoot();
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(projectRoot, configuredPath);
}

