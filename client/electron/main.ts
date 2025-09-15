import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Store from 'electron-store'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Initialize electron-store
const store = new Store()

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// IPC handlers for electron-store
ipcMain.handle('store:get', (_event, key) => {
  return store.get(key)
})

ipcMain.handle('store:set', (_event, key, value) => {
  store.set(key, value)
})

ipcMain.handle('store:delete', (_event, key) => {
  store.delete(key)
})

ipcMain.handle('store:has', (_event, key) => {
  return store.has(key)
})

// IPC handler for folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// IPC handler for opening files
ipcMain.handle('open-file', async (_event, filePath: string) => {
  try {
    await shell.openPath(filePath)
    return true
  } catch (error) {
    console.error('Failed to open file:', error)
    return false
  }
})

// IPC handler for opening folder containing a file
ipcMain.handle('open-folder', async (_event, filePath: string) => {
  try {
    const folderPath = path.dirname(filePath)
    await shell.openPath(folderPath)
    return true
  } catch (error) {
    console.error('Failed to open folder:', error)
    return false
  }
})

// IPC handler for selecting file to import
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['txt', 'md', 'doc', 'docx', 'pdf', 'rtf', 'odt'] },
      { name: 'Spreadsheets', extensions: ['xlsx', 'xls', 'csv', 'ods'] },
      { name: 'Presentations', extensions: ['pptx', 'ppt', 'odp'] },
      { name: 'Web Files', extensions: ['html', 'htm', 'xhtml'] },
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

// IPC handler for copying text to clipboard
ipcMain.handle('copy-to-clipboard', async (_event, text: string) => {
  try {
    clipboard.writeText(text)
    return true
  } catch (error) {
    console.error('Failed to copy to clipboard:', error)
    return false
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
