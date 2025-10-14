/// <reference types="vite-plugin-electron/electron-env" />

import type { FileImportNotification } from '../renderer/shared/events/fileImportEvents'

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
  * ├─┬─┬ builds/renderer
     * │ │ └── index.html
     * │ │
  * │ ├─┬ builds/electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
  /** /builds/renderer/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  electronAPI: {
    selectFolder: () => Promise<string | null>
    openFile: (filePath: string) => Promise<boolean>
    openFolder: (filePath: string) => Promise<boolean>
  selectFile: () => Promise<string[] | null>
    copyToClipboard: (text: string) => Promise<boolean>
    importFile: () => Promise<{ success: boolean; message: string }>
    getApiBaseUrl: () => Promise<string>
    setApiBaseUrl: (url: string) => Promise<boolean>
    getAppConfig: () => Promise<unknown>
    updateAppConfig: (updates: unknown) => Promise<unknown>
    showMainWindow: (options?: { route?: string; refreshFiles?: boolean }) => Promise<boolean>
    showBotWindow: () => Promise<boolean>
    hideBotWindow: () => Promise<boolean>
    moveBotWindow: (deltaX: number, deltaY: number) => void
    getPreferredLocale: () => Promise<string>
    setPreferredLocale: (locale: string) => Promise<string>
    getSystemLocale: () => Promise<string>
    logError: (message: string, meta?: unknown) => Promise<boolean>
    quitApp: () => Promise<boolean>
    clearAllData: () => Promise<boolean>
    sendFileImportNotification: (payload: FileImportNotification) => void
    onFileImportNotification: (
      callback: (payload: FileImportNotification) => void,
    ) => () => void
  }
}

