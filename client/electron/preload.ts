import { ipcRenderer, contextBridge } from 'electron'
import { webUtils } from 'electron'
import type { FileImportNotification } from '../renderer/shared/events/fileImportEvents'

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
  getApiBaseUrl: () => ipcRenderer.invoke('get-api-base-url'),
  setApiBaseUrl: (url: string) => ipcRenderer.invoke('set-api-base-url', url),
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  updateAppConfig: (updates: unknown) => ipcRenderer.invoke('update-app-config', updates),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
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
})

// Legacy electronStore bridge removed in favor of ConfigManager via IPC

contextBridge.exposeInMainWorld('webUtils', webUtils)
