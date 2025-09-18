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
import Store from "electron-store";
import { ImportService } from "./importService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Initialize electron-store

const store = new Store();

const syncWorkDirectoryConfig = async (): Promise<void> => {
  const workDirectory = store.get("workDirectory") as string | undefined;

  if (typeof workDirectory !== "string" || workDirectory.trim() === "") {
    return;
  }

  const apiBaseUrl = (
    store.get("apiBaseUrl", "http://localhost:8000") as string
  ).replace(/\/$/, "");

  const endpoint = `${apiBaseUrl}/api/system/config/update`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({ workdir_path: workDirectory }),
    });

    if (!response.ok) {
      console.error(
        `Failed to sync work directory config: ${response.status} ${response.statusText}`
      );
    }
  } catch (error) {
    console.error("Failed to sync work directory config", error);
  }
};

store.onDidChange("workDirectory", (newValue) => {
  if (typeof newValue === "string" && newValue.trim() !== "") {
    void syncWorkDirectoryConfig();
  }
});

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, "..");

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

function setupIpcHandlers() {
  // IPC handlers for electron-store
  ipcMain.handle("store:get", (_event, key) => {
    return store.get(key);
  });

  ipcMain.handle("store:set", (_event, key, value) => {
    store.set(key, value);
  });

  ipcMain.handle("store:delete", (_event, key) => {
    store.delete(key);
  });

  ipcMain.handle("store:has", (_event, key) => {
    return store.has(key);
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

  // IPC handler for opening folder containing a file
  ipcMain.handle("open-folder", async (_event, filePath: string) => {
    try {
      const folderPath = path.dirname(filePath);
      await shell.openPath(folderPath);
      return true;
    } catch (error) {
      console.error("Failed to open folder:", error);
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

  // IPC handler for getting API base URL
  ipcMain.handle("get-api-base-url", () => {
    return store.get("apiBaseUrl", "http://localhost:8000");
  });

  // IPC handler for setting API base URL
  ipcMain.handle("set-api-base-url", (_event, url: string) => {
    store.set("apiBaseUrl", url);

    // Reinitialize import service with new URL
    const apiBaseUrl = store.get(
      "apiBaseUrl",
      "http://localhost:8000"
    ) as string;

    importService = new ImportService(store, win, apiBaseUrl);
    void syncWorkDirectoryConfig();
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
  const isInitialized = store.get("isInitialized", false) as boolean;
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
  const apiBaseUrl = store.get("apiBaseUrl", "http://localhost:8000") as string;
  importService = new ImportService(store, win, apiBaseUrl);
  void syncWorkDirectoryConfig();
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
  tray = new Tray(
    nativeImage.createFromPath(
      path.join(__dirname, "../renderer/assets/mona-loading-default-static.png")
    )
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
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  setupIpcHandlers();
  setupBotWindowHandlers();
  createWindow();
  createBotWindow();
  createTray();
});
