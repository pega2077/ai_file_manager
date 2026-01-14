import path from "path";
import { promises as fsp } from "fs";
import fs from "fs";

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

/**
 * Resolve a writable temp directory based on environment.
 * - Electron Development: use app.getAppPath()/temp (works in dev folders)
 * - Electron Production: use path.dirname(app.getPath('exe'))/temp (writeable next to exe)
 * - Standalone: use process.cwd()/temp
 * Ensures the directory exists and returns its absolute path.
 */
export async function ensureTempDir(): Promise<string> {
  let baseDir: string;
  
  const electronApp = getElectronApp();
  if (electronApp) {
    // Electron mode
    if (electronApp.isPackaged === false) {
      // Development mode: prefer app root; fallback to cwd if undefined
      const appRoot = electronApp.getAppPath();
      baseDir = appRoot || process.cwd();
    } else {
      // Production mode: place temp next to the executable (Program Files can be read-only)
      baseDir = path.dirname(electronApp.getPath("exe"));
    }
  } else {
    // Standalone mode: use current working directory
    baseDir = process.cwd();
  }

  const tempDir = path.join(baseDir, "temp");
  await fsp.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Resolve the base directory for app data according to env.
 * - Electron Dev: app.getAppPath() or CWD
 * - Electron Prod: directory of the executable
 * - Standalone: process.cwd()
 */
export function getBaseDir(): string {
  try {
    const electronApp = getElectronApp();
    if (electronApp) {
      // Electron mode
      if (electronApp.isPackaged === false) {
        const appRoot = electronApp.getAppPath();
        return appRoot || process.cwd();
      }
      return path.dirname(electronApp.getPath("exe"));
    } else {
      // Standalone mode
      return process.cwd();
    }
  } catch {
    return process.cwd();
  }
}

/**
 * Resolve the repository/project root used for resources like database when a relative path is configured.
 * - Electron Dev: usually two levels above app root (client/dist-electron -> repo root)
 * - Electron Prod: one level above the executable directory (bundle root)
 * - Standalone: process.cwd()
 */
export function resolveProjectRoot(): string {
  const base = getBaseDir();
  //console.log('Base dir for project root resolution:', base);
  const electronApp = getElectronApp();
  if (electronApp && electronApp.isPackaged) {
    return path.join(base, "..");
  }
  return base;
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

