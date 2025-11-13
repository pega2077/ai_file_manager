import path from "node:path";
import { promises as fsp } from "node:fs";
import { randomUUID } from "node:crypto";
import chokidar, { type FSWatcher } from "chokidar";
import { Op } from "sequelize";
import FileModel from "./backend/models/file";
import { logger } from "./logger";
import type {
  DirectoryWatchImportRequest,
  DirectoryWatchStatusMessage,
} from "../shared/directoryWatcher";

interface DirectoryWatcherCallbacks {
  emitImportRequest: (payload: DirectoryWatchImportRequest) => void;
  emitStatus: (payload: DirectoryWatchStatusMessage) => void;
}

interface QueueTask {
  id: string;
  filePath: string;
  normalizedPath: string;
  attempts: number;
  origin: "scan" | "watch";
  lastError?: string;
}

const MAX_ATTEMPTS = 3;
const IDLE_CHECK_INTERVAL_MS = 30_000;

const isSamePath = (a: string, b: string): boolean => {
  const normalizedA = path.normalize(a);
  const normalizedB = path.normalize(b);
  return process.platform === "win32"
    ? normalizedA.toLowerCase() === normalizedB.toLowerCase()
    : normalizedA === normalizedB;
};

export class DirectoryWatcher {
  private watcher: FSWatcher | null = null;
  private enabled = false;
  private workDirectory: string | null = null;
  private readonly queue: QueueTask[] = [];
  private readonly tasksByPath = new Map<string, QueueTask>();
  private activeTask: QueueTask | null = null;
  private busy = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private suspended = false;

  constructor(private readonly callbacks: DirectoryWatcherCallbacks) {}

  updateConfig(opts: { enabled: boolean; workDirectory: string | undefined }): void {
    const nextWorkDir = this.normalizeDirectory(opts.workDirectory);
    const shouldEnable = Boolean(opts.enabled && nextWorkDir);

    if (shouldEnable) {
      void this.start(nextWorkDir!);
    } else {
      void this.stop();
    }
  }

  async start(nextWorkDir: string): Promise<void> {
    const normalizedDir = this.normalizeDirectory(nextWorkDir);
    if (!normalizedDir) {
      logger.warn("DirectoryWatcher.start: work directory missing, skip start");
      await this.stop();
      return;
    }

    const hasChangedDir = !this.workDirectory || !isSamePath(this.workDirectory, normalizedDir);

    if (this.enabled && !hasChangedDir) {
      // Already started with same directory
      return;
    }

    if (this.enabled && hasChangedDir) {
      await this.stop();
    }

    try {
      const stats = await fsp.stat(normalizedDir);
      if (!stats.isDirectory()) {
        throw new Error("not_a_directory");
      }
    } catch (error) {
      logger.error("DirectoryWatcher.start: unable to access directory", {
        directory: normalizedDir,
        error: String(error),
      });
      return;
    }

    this.workDirectory = normalizedDir;
    this.enabled = true;
    this.suspended = false;

    await this.seedExistingRecords();
    await this.createWatcher();
    this.startIdleTimer();
    this.callbacks.emitStatus({
      status: "progress",
      taskId: randomUUID(),
      step: "directory-watcher",
      state: "start",
      message: `Watching ${normalizedDir}`,
    });
    this.maybeProcessNext();
  }

  async stop(): Promise<void> {
    if (!this.enabled && !this.watcher) {
      return;
    }

    this.enabled = false;
    this.busy = false;
    this.activeTask = null;
    this.workDirectory = null;
    this.queue.length = 0;
    this.tasksByPath.clear();
    this.lastActivityAt = 0;
    this.suspended = false;

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (error) {
        logger.warn("DirectoryWatcher.stop: failed to close watcher", {
          error: String(error),
        });
      }
      this.watcher = null;
    }
  }

  handleRendererStatus(payload: DirectoryWatchStatusMessage): void {
    this.lastActivityAt = Date.now();

    switch (payload.status) {
      case "accepted": {
        if (this.activeTask && payload.taskId === this.activeTask.id) {
          this.busy = true;
        }
        break;
      }
      case "busy": {
        if (this.activeTask && payload.taskId === this.activeTask.id) {
          this.requeueActiveTask("renderer-busy");
        }
        this.busy = true;
        break;
      }
      case "progress": {
        this.busy = true;
        break;
      }
      case "error": {
        if (this.activeTask && payload.taskId === this.activeTask.id) {
          this.failActiveTask(payload.error);
        }
        this.busy = false;
        break;
      }
      case "idle": {
        if (this.activeTask && payload.taskId === this.activeTask.id) {
          if (payload.result === "success") {
            this.completeActiveTask();
          } else {
            const errMsg = payload.error || payload.message || "unknown";
            this.failActiveTask(errMsg);
          }
        } else {
          this.busy = false;
        }
        break;
      }
      default: {
        this.busy = false;
      }
    }

    this.maybeProcessNext();
  }

  notifyRendererAvailable(): void {
    if (!this.enabled) {
      return;
    }
    if (this.activeTask) {
      this.busy = true;
      return;
    }
    this.busy = false;
    this.maybeProcessNext();
  }

  notifyRendererUnavailable(): void {
    this.busy = true;
    if (this.activeTask) {
      const task = this.activeTask;
      this.activeTask = null;
      task.lastError = "renderer-unavailable";
      this.queue.unshift(task);
      this.callbacks.emitStatus({
        status: "progress",
        taskId: task.id,
        filePath: task.filePath,
        step: "await-renderer",
        state: "start",
        message: "Renderer unavailable, task re-queued",
      });
    }
  }

  private normalizeDirectory(input?: string | null): string | null {
    if (!input) {
      return null;
    }
    try {
      const resolved = path.resolve(input);
      return resolved;
    } catch (error) {
      logger.error("DirectoryWatcher.normalizeDirectory failed", {
        input,
        error: String(error),
      });
      return null;
    }
  }

  async suspendMonitoring(): Promise<void> {
    if (this.suspended) {
      return;
    }
    this.suspended = true;
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch (error) {
        logger.warn("DirectoryWatcher.suspendMonitoring: failed to close watcher", {
          error: String(error),
        });
      }
      this.watcher = null;
    }
  }

  async resumeMonitoring(): Promise<void> {
    if (!this.suspended) {
      return;
    }
    this.suspended = false;
    if (!this.enabled || !this.workDirectory) {
      return;
    }
    await this.createWatcher();
    this.startIdleTimer();
    this.maybeProcessNext();
  }

  private normalizeFilePath(input: string): string | null {
    if (!input) {
      return null;
    }
    try {
      const resolved = path.resolve(input);
      return resolved;
    } catch (error) {
      logger.warn("DirectoryWatcher.normalizeFilePath failed", {
        input,
        error: String(error),
      });
      return null;
    }
  }

  private async createWatcher(): Promise<void> {
    if (!this.workDirectory) {
      return;
    }

    const watcher = chokidar.watch(this.workDirectory, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 250,
      },
      depth: 5,
    });

    watcher.on("add", (filePath: string) => {
      void this.onFileDetected(filePath, "watch");
    });

    watcher.on("change", (filePath: string) => {
      void this.onFileDetected(filePath, "watch");
    });

    watcher.on("unlink", (filePath: string) => {
      const normalized = this.normalizeFilePath(filePath);
      if (!normalized) return;
      if (this.tasksByPath.delete(normalized)) {
        const idx = this.queue.findIndex((task) => task.normalizedPath === normalized);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
        }
        if (this.activeTask && this.activeTask.normalizedPath === normalized) {
          this.activeTask = null;
          this.busy = false;
        }
        logger.info("DirectoryWatcher: removed task because file deleted", {
          filePath: normalized,
        });
      }
    });

    watcher.on("error", (error: unknown) => {
      logger.error("DirectoryWatcher watcher error", { error: String(error) });
    });

    this.watcher = watcher;
  }

  private async onFileDetected(filePath: string, origin: "scan" | "watch"): Promise<void> {
    if (!this.enabled || !this.workDirectory) {
      return;
    }

    const normalized = this.normalizeFilePath(filePath);
    if (!normalized) {
      return;
    }
    if (!this.isInsideWorkdir(normalized, this.workDirectory)) {
      return;
    }

    try {
      const stats = await fsp.stat(normalized);
      if (!stats.isFile()) {
        return;
      }
    } catch (error) {
      logger.warn("DirectoryWatcher.onFileDetected: stat failed", {
        filePath: normalized,
        error: String(error),
      });
      return;
    }

    await this.enqueueFile(normalized, origin);
  }

  private async seedExistingRecords(): Promise<void> {
    const workDir = this.workDirectory;
    if (!workDir) {
      return;
    }

    try {
      const pendingRows = await FileModel.findAll({
        where: {
          [Op.or]: [
            { imported: { [Op.eq]: false } },
            { imported: { [Op.is]: null } },
          ],
        },
        attributes: ["path"],
        raw: true,
      });

      for (const row of pendingRows) {
        const recordPath = typeof row.path === "string" ? row.path : "";
        const normalized = this.normalizeFilePath(recordPath);
        if (!normalized) continue;
        if (!this.isInsideWorkdir(normalized, workDir)) continue;
        try {
          const stats = await fsp.stat(normalized);
          if (!stats.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        await this.enqueueFile(normalized, "scan");
      }
    } catch (error) {
      logger.warn("DirectoryWatcher.seedExistingRecords failed", {
        error: String(error),
      });
    }
  }

  private async enqueueFile(filePath: string, origin: "scan" | "watch"): Promise<void> {
    const normalized = this.normalizeFilePath(filePath);
    if (!normalized) {
      return;
    }
    if (this.tasksByPath.has(normalized)) {
      return;
    }

    try {
      const existing = await FileModel.findOne({
        where: { path: normalized },
        attributes: ["imported"],
        raw: true,
      });
      if (existing && existing.imported) {
        return;
      }
    } catch (error) {
      logger.warn("DirectoryWatcher.enqueueFile: failed to query DB", {
        filePath: normalized,
        error: String(error),
      });
    }

    const task: QueueTask = {
      id: randomUUID(),
      filePath: normalized,
      normalizedPath: normalized,
      attempts: 0,
      origin,
    };

    this.queue.push(task);
    this.tasksByPath.set(normalized, task);
    logger.info("DirectoryWatcher: queued file for import", {
      filePath: normalized,
      origin,
    });

    this.callbacks.emitStatus({
      status: "progress",
      taskId: task.id,
      step: "queue",
      state: "start",
      filePath: normalized,
      message: origin === "scan" ? "Queued unimported record" : "Detected new file",
    });

    this.maybeProcessNext();
  }

  private maybeProcessNext(): void {
    if (!this.enabled) {
      return;
    }
    if (this.busy || this.activeTask) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.activeTask = next;
    this.busy = true;
    this.lastActivityAt = Date.now();

    this.callbacks.emitImportRequest({
      taskId: next.id,
      filePath: next.filePath,
    });
  }

  private requeueActiveTask(reason: string): void {
    if (!this.activeTask) {
      return;
    }
    const task = this.activeTask;
    task.lastError = reason;
    task.attempts += 1;
    this.activeTask = null;
    this.busy = false;

    if (task.attempts >= MAX_ATTEMPTS) {
      logger.warn("DirectoryWatcher: dropping task after repeated busy state", {
        filePath: task.filePath,
        attempts: task.attempts,
        reason,
      });
      this.tasksByPath.delete(task.normalizedPath);
      return;
    }

    this.queue.push(task);
  }

  private failActiveTask(error: string | undefined): void {
    if (!this.activeTask) {
      this.busy = false;
      return;
    }
    const task = this.activeTask;
    task.attempts += 1;
    task.lastError = error;
    this.activeTask = null;
    this.busy = false;

    if (task.attempts >= MAX_ATTEMPTS) {
      logger.error("DirectoryWatcher: giving up on file after failures", {
        filePath: task.filePath,
        attempts: task.attempts,
        error,
      });
      this.callbacks.emitStatus({
        status: "error",
        taskId: task.id,
        filePath: task.filePath,
        error: error || "unknown error",
      });
      this.tasksByPath.delete(task.normalizedPath);
      return;
    }

    logger.warn("DirectoryWatcher: requeue after failure", {
      filePath: task.filePath,
      attempts: task.attempts,
      error,
    });
    this.queue.push(task);
  }

  private completeActiveTask(): void {
    if (!this.activeTask) {
      this.busy = false;
      return;
    }
    const task = this.activeTask;
    this.activeTask = null;
    this.busy = false;
    this.tasksByPath.delete(task.normalizedPath);
    this.callbacks.emitStatus({
      status: "progress",
      taskId: task.id,
      filePath: task.filePath,
      step: "queue",
      state: "success",
      message: "Import completed",
    });
  }

  private startIdleTimer(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.idleTimer = setInterval(() => {
      if (!this.enabled) {
        return;
      }
      if (!this.busy) {
        this.maybeProcessNext();
        return;
      }
      if (this.lastActivityAt === 0) {
        return;
      }
      const elapsed = Date.now() - this.lastActivityAt;
      if (elapsed > IDLE_CHECK_INTERVAL_MS * 4) {
        logger.warn("DirectoryWatcher: renderer idle for extended period", {
          elapsed,
          activeTask: this.activeTask?.filePath,
        });
        this.busy = false;
        if (this.activeTask) {
          this.queue.unshift(this.activeTask);
          this.activeTask = null;
        }
        this.maybeProcessNext();
      }
    }, IDLE_CHECK_INTERVAL_MS);
  }

  private isInsideWorkdir(target: string, workDir: string): boolean {
    const normalizedWork = this.normalizeFilePath(workDir);
    const normalizedTarget = this.normalizeFilePath(target);
    if (!normalizedWork || !normalizedTarget) {
      return false;
    }
    if (isSamePath(normalizedWork, normalizedTarget)) {
      return true;
    }
    const workWithSep = normalizedWork.endsWith(path.sep)
      ? normalizedWork
      : `${normalizedWork}${path.sep}`;
    if (process.platform === "win32") {
      return normalizedTarget.toLowerCase().startsWith(workWithSep.toLowerCase());
    }
    return normalizedTarget.startsWith(workWithSep);
  }
}
