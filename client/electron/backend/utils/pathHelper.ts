import { app } from "electron";
import path from "path";
import { promises as fsp } from "fs";

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
