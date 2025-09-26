/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
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
    selectFile: () => Promise<string | null>
    copyToClipboard: (text: string) => Promise<boolean>
    importFile: () => Promise<{ success: boolean; message: string }>
    getApiBaseUrl: () => Promise<string>
    setApiBaseUrl: (url: string) => Promise<boolean>
    getAppConfig: () => Promise<unknown>
    updateAppConfig: (updates: unknown) => Promise<unknown>
    showMainWindow: () => Promise<boolean>
    hideBotWindow: () => Promise<boolean>
    moveBotWindow: (deltaX: number, deltaY: number) => void
    getPreferredLocale: () => Promise<string>
    setPreferredLocale: (locale: string) => Promise<string>
    getSystemLocale: () => Promise<string>
    logError: (message: string, meta?: unknown) => Promise<boolean>
    quitApp: () => Promise<boolean>
  }
}

