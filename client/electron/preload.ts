import { ipcRenderer, contextBridge } from 'electron'
import { webUtils } from 'electron'
import { pathToFileURL } from 'url'
import type { FileImportNotification } from '../renderer/shared/events/fileImportEvents'
import type {
  DirectoryWatchImportRequest,
  DirectoryWatchStatusMessage,
} from '../shared/directoryWatcher'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...listenerArgs) => listener(event, ...listenerArgs))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  openFolder: (filePath: string) => ipcRenderer.invoke('open-folder', filePath),
  selectFile: () => ipcRenderer.invoke('select-file'),
  copyToClipboard: (text: string) => ipcRenderer.invoke('copy-to-clipboard', text),
  readClipboardText: () => ipcRenderer.invoke('read-clipboard-text'),
  importFile: () => ipcRenderer.invoke('import-file'),
  toFileUrl: (filePath: string) => {
    try {
      return pathToFileURL(filePath).toString()
    } catch {
      return ''
    }
  },
  getApiBaseUrl: () => ipcRenderer.invoke('get-api-base-url'),
  setApiBaseUrl: (url: string) => ipcRenderer.invoke('set-api-base-url', url),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  updateAppConfig: (updates: unknown) => ipcRenderer.invoke('update-app-config', updates),
  showMainWindow: (options?: { route?: string; refreshFiles?: boolean }) =>
    ipcRenderer.invoke('show-main-window', options),
  showBotWindow: () => ipcRenderer.invoke('show-bot-window'),
  hideBotWindow: () => ipcRenderer.invoke('hide-bot-window'),
  moveBotWindow: (deltaX: number, deltaY: number) => ipcRenderer.send('move-bot-window', deltaX, deltaY),
  getPreferredLocale: () => ipcRenderer.invoke('locale:get-preferred'),
  setPreferredLocale: (locale: string) => ipcRenderer.invoke('locale:set-preferred', locale),
  getSystemLocale: () => ipcRenderer.invoke('locale:get-system'),
  logError: (message: string, meta?: unknown) => ipcRenderer.invoke('log:error', message, meta),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  clearAllData: () => ipcRenderer.invoke('clear-all-data'),
  sendFileImportNotification: (payload: FileImportNotification) =>
    ipcRenderer.send('file-import:notify', payload),
  onFileImportNotification: (
    callback: (payload: FileImportNotification) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: FileImportNotification,
    ) => {
      callback(data);
    };
    ipcRenderer.on('file-import:notification', listener);
    return () => {
      ipcRenderer.removeListener('file-import:notification', listener);
    };
  },
  registerDirectoryWatcherImporter: () => {
    ipcRenderer.send('directory-watcher:register-importer')
  },
  unregisterDirectoryWatcherImporter: () => {
    ipcRenderer.send('directory-watcher:unregister-importer')
  },
  getLogArchive: () => ipcRenderer.invoke('app:get-log-archive'),
  pauseDirectoryWatcher: () => ipcRenderer.invoke('directory-watcher:pause'),
  resumeDirectoryWatcher: () => ipcRenderer.invoke('directory-watcher:resume'),
  notifyDirectoryWatcherStatus: (payload: DirectoryWatchStatusMessage) => {
    ipcRenderer.send('directory-watcher:status', payload)
  },
  onDirectoryWatcherImportRequest: (
    callback: (payload: DirectoryWatchImportRequest) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      detail: DirectoryWatchImportRequest,
    ) => {
      callback(detail)
    }
    ipcRenderer.on('directory-watcher:import-request', listener)
    return () => {
      ipcRenderer.removeListener('directory-watcher:import-request', listener)
    }
  },
})

// Legacy electronStore bridge removed in favor of ConfigManager via IPC

contextBridge.exposeInMainWorld('webUtils', webUtils)
