import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Menu,
  screen,
  Tray,
  nativeImage,
} from "electron";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ImportService } from "./importService";
import { logger } from "./logger";
import { configManager, AppConfig } from "./configManager";
import { startServer as startLocalExpressServer, stopServer as stopLocalExpressServer } from "./server";
import { ensureTempDir, getBaseDir, resolveProjectRoot } from "./backend/utils/pathHelper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Config is managed via ConfigManager (JSON file), electron-store removed

const SUPPORTED_LOCALES = new Set<string>(["en", "zh"]);

const normalizeLocaleValue = (value: string | null | undefined): string => {
  if (!value) {
    return "zh";
  }

  const lowerCase = value.toLowerCase();
  if (SUPPORTED_LOCALES.has(lowerCase)) {
    return lowerCase;
  }

  const base = lowerCase.split("-")[0];
  return SUPPORTED_LOCALES.has(base) ? base : "en";
};

// Removed deprecated syncWorkDirectoryConfig function

// When config updates, caller should re-invoke syncWorkDirectoryConfig

// The built directory structure
process.env.APP_ROOT = app.getAppPath();

// 🛠️ Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;
let botWin: BrowserWindow | null;
let importService: ImportService;
let tray: Tray | null;

/**
 * Clear all app data (database file, vectors directory, temp directory) and relaunch the app.
 * - Does NOT remove config.json or logs by design.
 */
async function handleClearAllData(): Promise<void> {
  try {
    logger.info("Starting clear-all-data operation");

    // Resolve primary DB path from config
  const dbPathFromConfig = configManager.getDatabaseAbsolutePath();
  const baseDir = getBaseDir();
  const projectRoot = resolveProjectRoot();

    // Candidate DB paths to maximize compatibility in dev/prod
    const candidateDbPaths = Array.from(
      new Set([
        dbPathFromConfig,
        // Common development layout candidates
        path.join(projectRoot, "database", "files.db"),
        path.join(baseDir, "client", "database", "files.db"),
        path.join(baseDir, "database", "files.db"),
      ])
    );

    // Collect directories to remove: vectors alongside any detected DB and temp dir
    const candidateVectorDirs = new Set<string>();
    const candidateDbDirs = new Set<string>();
    for (const p of candidateDbPaths) {
      const dbDir = path.dirname(p);
      candidateDbDirs.add(dbDir);
      candidateVectorDirs.add(path.join(dbDir, "vectors"));
    }

    // Remove DB files if exist
    for (const dbPath of candidateDbPaths) {
      try {
        await fs.rm(dbPath, { force: true });
        logger.info(`Removed database file if existed: ${dbPath}`);
      } catch (err) {
        logger.warn(`Failed to remove database file: ${dbPath}`, err);
      }
    }

    // Remove vectors directories and entire database directories (to clean WAL/SHM/extras)
    for (const dir of candidateVectorDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
        logger.info(`Removed vectors directory if existed: ${dir}`);
      } catch (err) {
        logger.warn(`Failed to remove vectors directory: ${dir}`, err);
      }
    }

    for (const dbDir of candidateDbDirs) {
      try {
        await fs.rm(dbDir, { recursive: true, force: true });
        logger.info(`Removed database directory if existed: ${dbDir}`);
      } catch (err) {
        logger.warn(`Failed to remove database directory: ${dbDir}`, err);
      }
    }

    // Remove temp directory and recreate it
    try {
      const ensuredTemp = await ensureTempDir();
      const tempCandidates = Array.from(
        new Set([
          ensuredTemp,
          path.join(baseDir, "temp"),
          path.join(projectRoot, "temp"),
          path.join(path.join(baseDir, ".."), "temp"),
          path.join(path.join(baseDir, "..", ".."), "temp"),
          path.join(process.cwd(), "temp"),
        ])
      );
      for (const t of tempCandidates) {
        try {
          await fs.rm(t, { recursive: true, force: true });
          logger.info(`Cleared temp directory if existed: ${t}`);
        } catch (e) {
          logger.warn(`Failed to clear temp directory: ${t}`);
        }
      }
    } catch (err) {
      logger.warn("Failed to enumerate temp directories", err);
    }

    // Inform the user and relaunch
    try {
      const options = {
        type: "info" as const,
        buttons: ["OK"],
        defaultId: 0,
        title: "Data Cleared",
        message: "All application data has been cleared. The app will now restart.",
        noLink: true,
      };
      if (win && !win.isDestroyed()) {
        await dialog.showMessageBox(win, options);
      } else {
        await dialog.showMessageBox(options);
      }
    } catch {
      // Ignore dialog failures
    }

    logger.info("Relaunching application after data clear");
    app.relaunch();
    // Use exit to allow before-quit handlers to run; a small delay helps pending I/O
    setTimeout(() => {
      app.exit(0);
    }, 150);
  } catch (error) {
    logger.error("Unexpected error during clear-all-data:", error);
    const options = {
      type: "error" as const,
      buttons: ["OK"],
      defaultId: 0,
      title: "Clear Data Failed",
      message: "Failed to clear all data. Please check logs for details.",
      noLink: true,
    };
    if (win && !win.isDestroyed()) {
      await dialog.showMessageBox(win, options);
    } else {
      await dialog.showMessageBox(options);
    }
  }
}

function setupIpcHandlers() {
  ipcMain.handle("locale:get-preferred", () => {
    const storedLocale = configManager.getConfig().language;
    if (storedLocale) {
      return normalizeLocaleValue(storedLocale);
    }

    return normalizeLocaleValue(app.getLocale());
  });

  ipcMain.handle("locale:set-preferred", (_event, locale: string) => {
    const normalized = normalizeLocaleValue(locale);
    configManager.updateConfig({ language: normalized });
    return normalized;
  });

  ipcMain.handle("locale:get-system", () => {
    return normalizeLocaleValue(app.getLocale());
  });

  // IPC handler for folder selection
  ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ["openDirectory"],
    });

    return result.canceled ? null : result.filePaths[0];
  });

  // IPC handler for opening files
  ipcMain.handle("open-file", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (error) {
      console.error("Failed to open file:", error);
      return false;
    }
  });

  // IPC handler for opening a folder. Accepts either a file path or a directory path.
  ipcMain.handle("open-folder", async (_event, fileOrFolderPath: string) => {
    try {
      let targetPath = fileOrFolderPath;

      try {
        const stats = await fs.stat(fileOrFolderPath);
        if (stats.isFile()) {
          targetPath = path.dirname(fileOrFolderPath);
        } else if (!stats.isDirectory()) {
          // Not a regular directory or file; fallback to parent directory
          targetPath = path.dirname(fileOrFolderPath);
        }
      } catch {
        // If stat fails (path may not exist), fallback to parent directory
        targetPath = path.dirname(fileOrFolderPath);
      }

      logger.info(`Opening folder: ${targetPath}`);
      const result = await shell.openPath(targetPath);
      if (result) {
        // Non-empty string indicates an error message
        logger.error(`Failed to open folder: ${result}`);
        return false;
      }
      return true;
    } catch (error) {
      logger.error("Failed to open folder:", error);
      return false;
    }
  });

  // IPC handler for selecting file to import
  ipcMain.handle("select-file", async () => {
    const result = await dialog.showOpenDialog(win!, {
      properties: ["openFile"],
      filters: [
        { name: "All Files", extensions: ["*"] },
        {
          name: "Documents",
          extensions: ["txt", "md", "doc", "docx", "pdf", "rtf", "odt"],
        },
        {
          name: "Images",
          extensions: [
            "jpg",
            "jpeg",
            "png",
            "gif",
            "bmp",
            "webp",
            "svg",
            "ico",
          ],
        },
        { name: "Spreadsheets", extensions: ["xlsx", "xls", "csv", "ods"] },
        { name: "Presentations", extensions: ["pptx", "ppt", "odp"] },
        { name: "Web Files", extensions: ["html", "htm", "xhtml"] },
      ],
    });

    return result.canceled ? null : result.filePaths[0];
  });

  // IPC handler for copying text to clipboard
  ipcMain.handle("copy-to-clipboard", async (_event, text: string) => {
    try {
      clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      return false;
    }
  });

  // IPC handler for importing file
  ipcMain.handle("import-file", async () => {
    if (importService) {
      return await importService.addFileToQueue();
    }
    return { success: false, message: "Import service not initialized" };
  });

  // IPC handler for getting log file path
  ipcMain.handle("get-log-file-path", () => {
    return logger.getLogFilePath();
  });

  // IPC handler for opening log file
  ipcMain.handle("open-log-file", async () => {
    try {
      const logFilePath = logger.getLogFilePath();
      await shell.openPath(logFilePath);
      return true;
    } catch (error) {
      logger.error("Failed to open log file:", error);
      return false;
    }
  });

  // IPC handler for renderer error logging
  ipcMain.handle("log:error", (_event, message: string, meta?: unknown) => {
    try {
      if (meta !== undefined) {
        logger.error(message, meta);
      } else {
        logger.error(message);
      }
      return true;
    } catch (error) {
      console.error("Failed to log error from renderer:", error);
      return false;
    }
  });

  // IPC handler for getting app config
  ipcMain.handle("get-app-config", () => {
    return configManager.getConfig();
  });

  // IPC handler for updating app config
  ipcMain.handle("update-app-config", (_event, updates: Partial<AppConfig>) => {
    configManager.updateConfig(updates);
    // Reinitialize import service with potentially new base URL
    const apiBaseUrl = configManager.getEffectiveApiBaseUrl();
  importService = new ImportService(win ?? null, apiBaseUrl);
    return configManager.getConfig();
  });

  // IPC handler for setting API base URL
  ipcMain.handle("set-api-base-url", (_event, url: string) => {
    const normalized = typeof url === 'string' ? url.replace(/\/$/, '') : 'http://localhost:8000';
    configManager.updateConfig({ apiBaseUrl: normalized, useLocalService: false });
    const apiBaseUrl = configManager.getEffectiveApiBaseUrl();
  importService = new ImportService(win ?? null, apiBaseUrl);
    return true;
  });

  // IPC handler for getting API base URL
  ipcMain.handle("get-api-base-url", () => {
    return configManager.getEffectiveApiBaseUrl();
  });

  // IPC handler for clearing all data and relaunching the app
  ipcMain.handle("clear-all-data", async () => {
    await handleClearAllData();
    return true;
  });

  // Backward/alias handler name as requested
  ipcMain.handle("handleClearAllData", async () => {
    await handleClearAllData();
    return true;
  });

  // IPC handler for showing main window
  ipcMain.handle("show-main-window", () => {
    if (!win || win.isDestroyed()) {
      createWindow();
    }

    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }

    return true;
  });

  // IPC handler for hiding bot window
  ipcMain.handle("hide-bot-window", () => {
    if (botWin && !botWin.isDestroyed()) {
      botWin.hide();
    }

    return true;
  });

  // IPC handler to quit the application
  ipcMain.handle("quit-app", () => {
    logger.info('Quit requested via IPC');
    app.quit();
    return true;
  });

  // Removed deprecated sync-language-config IPC handler
}

function setupBotWindowHandlers() {
  ipcMain.on("move-bot-window", (_event, deltaX: number, deltaY: number) => {
    if (botWin && !botWin.isDestroyed()) {
      const [currentX, currentY] = botWin.getPosition();
      botWin.setPosition(currentX + deltaX, currentY + deltaY);
    }
  });
}

function createWindow() {
  const isInitialized = Boolean(configManager.getConfig().isInitialized);
  win = new BrowserWindow({
    icon: path.join(__dirname, "../app-icon.png"),
    width: 1920,
    height: 1080,
    show: !isInitialized,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Handle window close to hide instead of close
  win.on("close", (e) => {
    e.preventDefault();
    win?.hide();
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  // Create application menu
  createMenu();
  // Initialize import service
  const apiBaseUrl = configManager.getEffectiveApiBaseUrl();
  importService = new ImportService(win ?? null, apiBaseUrl);
  // void syncWorkDirectoryConfig();
  // void syncLanguageConfig();
}

function createBotWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 400;
  const windowHeight = 400;
  const x = screenWidth - windowWidth;
  const y = screenHeight / 2 - windowHeight / 2;
  botWin = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  botWin.on("closed", () => {
    botWin = null;
  });

  if (VITE_DEV_SERVER_URL) {
    botWin.loadURL(VITE_DEV_SERVER_URL + "#/bot");
  } else {
    botWin.loadFile(path.join(RENDERER_DIST, "index.html"));
    botWin.webContents.on("did-finish-load", () => {
      botWin?.webContents.executeJavaScript('window.location.hash = "#/bot"');
    });
  }
}

// Create application menu
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Import File",
          accelerator: "CmdOrCtrl+I",
          click: async () => {
            // Select file and add to queue

            const result = await dialog.showOpenDialog(win!, {
              properties: ["openFile"],

              filters: [
                { name: "All Files", extensions: ["*"] },
                {
                  name: "Documents",
                  extensions: ["txt", "md", "doc", "docx", "pdf", "rtf", "odt"],
                },
                {
                  name: "Images",
                  extensions: [
                    "jpg",
                    "jpeg",
                    "png",
                    "gif",
                    "bmp",
                    "webp",
                    "svg",
                    "ico",
                  ],
                },
                {
                  name: "Spreadsheets",
                  extensions: ["xlsx", "xls", "csv", "ods"],
                },
                { name: "Presentations", extensions: ["pptx", "ppt", "odp"] },
                { name: "Web Files", extensions: ["html", "htm", "xhtml"] },
              ],
            });

            if (!result.canceled && result.filePaths[0]) {
              if (importService) {
                importService.addFileToQueue();
              }
            }
          },
        },

        {
          label: "Clear All Data...",
          click: async () => {
            try {
              const options = {
                type: "warning" as const,
                buttons: ["Cancel", "Delete and Restart"],
                defaultId: 1,
                cancelId: 0,
                title: "Confirm Clear All Data",
                message:
                  "This will permanently delete the database, vectors, and temp files. The app will then restart.",
                noLink: true,
              };
              const { response } = win && !win.isDestroyed()
                ? await dialog.showMessageBox(win, options)
                : await dialog.showMessageBox(options);
              if (response === 1) {
                await handleClearAllData();
              }
            } catch (err) {
              logger.error("Clear All Data menu action failed:", err);
            }
          },
        },

        { type: "separator" },
        {
          label: "Quit",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Ctrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },

    {
      label: "Window",
      submenu: [
        {
          label: "Minimize",
          accelerator: "CmdOrCtrl+M",
          role: "minimize",
        },
        {
          label: "Close",
          accelerator: "CmdOrCtrl+W",
          role: "close",
        },
        { type: "separator" },
        {
          label: "Open Bot Window",
          click: () => {
            createBotWindow();
          },
        },
      ],
    },

    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            if (win) {
              win.webContents.reload();
            }
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            if (win) {
              win.webContents.reloadIgnoringCache();
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          click: () => {
            if (win) {
              win.webContents.toggleDevTools();
            }
          },
        },

        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          click: () => {
            if (win) {
              win.webContents.setZoomLevel(0);
            }
          },
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+Plus",
          click: () => {
            if (win) {
              win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 1);
            }
          },
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => {
            if (win) {
              win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 1);
            }
          },
        },
      ],
    },

    {
      label: "Help",
      submenu: [
        {
          label: "View Logs",
          click: () => {
            const logFilePath = logger.getLogFilePath();
            shell.openPath(logFilePath);
          },
        },
        {
          label: "About",
          click: () => {
            // Show about dialog
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create system tray
function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.ico')
    : path.join(__dirname, '../app-icon.ico');
  tray = new Tray(
    nativeImage.createFromPath(iconPath)
  );

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Main Window",
      click: () => {
        if (!win || win.isDestroyed()) {
          createWindow();
        }
        if (win && !win.isDestroyed()) {
          win.show();

          win.focus();
        }
      },
    },

    {
      label: "Show Bot Window",
      click: () => {
        if (!botWin || botWin.isDestroyed()) {
          createBotWindow();
        }
        if (botWin && !botWin.isDestroyed()) {
          botWin.show();
          botWin.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "View Logs",
      click: () => {
        const logFilePath = logger.getLogFilePath();
        shell.openPath(logFilePath);
      },
    },
    // Removed Python backend control from tray menu
    { type: "separator" },
    {
      label: "Close App",
      click: () => {
        win?.destroy();
        botWin?.destroy();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip("AI File Manager");
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  logger.info('All windows closed');
  if (process.platform !== "darwin") {
    logger.info('Application quitting (non-macOS platform)');
    app.quit();
    win = null;
  }
});

app.on("before-quit", () => {
  logger.info('Application before-quit event triggered');
  void stopLocalExpressServer();
});

app.on("activate", () => {
  logger.info('Application activated');
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    logger.info('No windows open, creating new window');
    createWindow();
  }
});

app.whenReady().then(async () => {
  logger.info('Application starting...');

  // 读取配置文件
  const appConfig = configManager.loadConfig();
  logger.info('Loaded configuration:', appConfig);

  setupIpcHandlers();
  setupBotWindowHandlers();

  // Removed Python backend startup/status checks

  logger.info('Creating application windows and tray');
  createWindow();
  createBotWindow();
  createTray();
  // Start internal lightweight Express server
  await startLocalExpressServer();
  logger.info('Application startup complete');
});

// Config changes handled via update-app-config IPC handler

// Removed deprecated syncLanguageConfig function

