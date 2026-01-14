import path from "path";
import { pathToFileURL } from "url";
import { promises as fsp } from "fs";
import { ensureTempDir } from "./pathHelper";
import { logger } from "../../logger";

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

let captureWindow: any | null = null;
let captureLockActive = false;
const captureWaiters: Array<() => void> = [];

function scheduleNextCapture(): void {
  const next = captureWaiters.shift();
  if (next) {
    next();
  }
}

async function acquireCaptureLock(): Promise<() => void> {
  if (!captureLockActive) {
    captureLockActive = true;
    return () => {
      captureLockActive = false;
      scheduleNextCapture();
    };
  }

  await new Promise<void>((resolve) => captureWaiters.push(resolve));
  captureLockActive = true;
  return () => {
    captureLockActive = false;
    scheduleNextCapture();
  };
}

function ensureCaptureWindow(): any {
  const { BrowserWindow: BrowserWindowClass } = getElectronModules();
  
  if (!BrowserWindowClass) {
    throw new Error("video_capture_not_supported_in_standalone_mode");
  }
  
  if (captureWindow && !captureWindow.isDestroyed()) {
    return captureWindow;
  }

  captureWindow = new BrowserWindowClass({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  captureWindow.on("closed", () => {
    captureWindow = null;
  });

  return captureWindow;
}

export interface ExtractVideoScreenshotsOptions {
  intervalSeconds?: number; // default 10
  maxShots?: number; // default 5
  /**
   * Target width/height for screenshots. If only one is provided, the other is scaled to maintain aspect ratio.
   * If both omitted or <= 0, use source video resolution.
   */
  targetWidth?: number;
  targetHeight?: number;
  timeoutMs?: number; // overall timeout, default 60000
}

export interface ExtractedScreenshot {
  filePath: string;
  timeSec: number;
}

/**
 * Extract screenshots from a local video file by spinning up a hidden BrowserWindow and using
 * <video> + OffscreenCanvas (fallback to Canvas) to capture frames at intervals.
 * Returns absolute file paths for the saved PNG images in the app temp directory.
 */
export async function extractVideoScreenshots(
  videoAbsPath: string,
  opts: ExtractVideoScreenshotsOptions = {}
): Promise<ExtractedScreenshot[]> {
  const startTs = Date.now();
  const intervalSeconds = Math.max(1, Math.floor(opts.intervalSeconds ?? 10));
  const maxShots = Math.max(1, Math.floor(opts.maxShots ?? 5));
  const targetWidth = typeof opts.targetWidth === "number" && opts.targetWidth > 0 ? Math.floor(opts.targetWidth) : undefined;
  const targetHeight = typeof opts.targetHeight === "number" && opts.targetHeight > 0 ? Math.floor(opts.targetHeight) : undefined;
  const timeoutMs = Math.max(5000, Math.floor(opts.timeoutMs ?? 60000));

  if (!path.isAbsolute(videoAbsPath)) {
    throw new Error("Video path must be absolute");
  }

  // Ensure app is ready (in case this is used early in lifecycle)
  if (!app || !app.isReady()) {
    await new Promise<void>((resolve) => app.once("ready", () => resolve()));
  }

  const fileUrl = pathToFileURL(videoAbsPath).toString();

  const releaseLock = await acquireCaptureLock();

  try {
    const win = ensureCaptureWindow();
    await win.loadURL("about:blank");

    const script = `(() => {
      return new Promise(async (resolve, reject) => {
        try {
          const intervalSeconds = ${intervalSeconds};
          const maxShots = ${maxShots};
          const targetWidth = ${typeof targetWidth === "number" ? targetWidth : "undefined"};
          const targetHeight = ${typeof targetHeight === "number" ? targetHeight : "undefined"};
          const src = ${JSON.stringify(fileUrl)};

          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.preload = 'metadata';
          video.muted = true;
          video.playsInline = true;
          video.src = src;

          const onError = (e) => {
            reject(new Error('Video failed to load'));
          };
          video.addEventListener('error', onError, { once: true });

          // Wait for metadata to know duration and dimensions
          await new Promise((res, rej) => {
            const onLoaded = () => { res(); };
            const onErr = () => { rej(new Error('metadata load error')); };
            video.addEventListener('loadedmetadata', onLoaded, { once: true });
            video.addEventListener('error', onErr, { once: true });
          });

          const duration = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
          let w = video.videoWidth || 0;
          let h = video.videoHeight || 0;
          if (!w || !h) {
            // default fallback to avoid 0x0 canvas
            w = 640; h = 360;
          }
          // Compute target size while preserving aspect ratio if one side provided
          let outW = targetWidth || 0;
          let outH = targetHeight || 0;
          if (outW > 0 && outH > 0) {
            // keep as-is
          } else if (outW > 0) {
            outH = Math.max(1, Math.round((outW / w) * h));
          } else if (outH > 0) {
            outW = Math.max(1, Math.round((outH / h) * w));
          } else {
            outW = w; outH = h;
          }

          // Build capture timestamps
          const times = [];
          if (duration > 0) {
            for (let t = intervalSeconds; t < duration && times.length < maxShots; t += intervalSeconds) {
              times.push(Math.min(duration - 0.05, t));
            }
            if (times.length === 0) {
              times.push(Math.max(0, duration / 2));
            }
          } else {
            times.push(0);
          }

          async function captureCurrent() {
            try {
              if (typeof OffscreenCanvas !== 'undefined') {
                const canvas = new OffscreenCanvas(outW, outH);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('OffscreenCanvas 2D context not available');
                ctx.drawImage(video, 0, 0, outW, outH);
                const blob = await canvas.convertToBlob({ type: 'image/png' });
                const arrBuf = await blob.arrayBuffer();
                // Convert to base64 manually to avoid FileReader in worker
                const bytes = new Uint8Array(arrBuf);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                return btoa(binary);
              } else {
                const c = document.createElement('canvas');
                c.width = outW; c.height = outH;
                const ctx = c.getContext('2d');
                if (!ctx) throw new Error('Canvas 2D context not available');
                ctx.drawImage(video, 0, 0, outW, outH);
                const dataUrl = c.toDataURL('image/png');
                return dataUrl.split(',')[1] || '';
              }
            } catch (err) {
              throw err;
            }
          }

          async function seekTo(time) {
            return new Promise((res, rej) => {
              const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(null); };
              const onErr = () => { video.removeEventListener('error', onErr); rej(new Error('seek error')); };
              video.addEventListener('seeked', onSeeked, { once: true });
              video.addEventListener('error', onErr, { once: true });
              try {
                video.currentTime = Math.max(0, Math.min(time, Math.max(0, duration - 0.01)));
              } catch (e) {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onErr);
                rej(e);
              }
            });
          }

          const outputs = [];
          for (let i = 0; i < times.length; i++) {
            const t = times[i];
            await seekTo(t);
            const b64 = await captureCurrent();
            outputs.push({ b64, time: t });
            if (outputs.length >= maxShots) break;
          }

          resolve({
            width: outW,
            height: outH,
            duration,
            frames: outputs,
          });
        } catch (err) {
          reject(err);
        }
      });
    })();`;

    const resultPromise = win.webContents.executeJavaScript(script, true) as Promise<{
      width: number;
      height: number;
      duration: number;
      frames: Array<{ b64: string; time: number }>;
    }>;

    const result = (await Promise.race([
      resultPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("video capture timeout")), timeoutMs)),
    ])) as {
      width: number;
      height: number;
      duration: number;
      frames: Array<{ b64: string; time: number }>;
    };

  const tempDir = await ensureTempDir();
    const base = path.basename(videoAbsPath, path.extname(videoAbsPath));
    const prefix = `${Date.now()}_${base}`;

    const outputs: ExtractedScreenshot[] = [];
    let idx = 0;
    for (const f of result.frames) {
      if (!f.b64) continue;
      const fileName = `${prefix}_frame_${idx}.png`;
      const outPath = path.join(tempDir, fileName);
      try {
        const buf = Buffer.from(f.b64, "base64");
        await fsp.writeFile(outPath, buf);
        outputs.push({ filePath: outPath, timeSec: f.time });
        idx += 1;
      } catch (e) {
        logger.warn("Failed to save video screenshot", { outPath, err: String(e) });
      }
    }

    return outputs;
  } catch (err) {
    logger.error("extractVideoScreenshots failed", err as unknown);
    throw err;
  } finally {
    releaseLock();
    logger.info(`extractVideoScreenshots finished in ${Date.now() - startTs}ms`);
  }
}
