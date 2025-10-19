/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>
      openFile: (filePath: string) => Promise<boolean>
      openFolder: (filePath: string) => Promise<boolean>
  selectFile: () => Promise<string[] | null>
      copyToClipboard: (text: string) => Promise<boolean>
  readClipboardText: () => Promise<string>
      importFile: () => Promise<{ success: boolean; message: string }>
  toFileUrl: (filePath: string) => string
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
      sendFileImportNotification: (payload: import('./shared/events/fileImportEvents').FileImportNotification) => void
      onFileImportNotification: (
        callback: (payload: import('./shared/events/fileImportEvents').FileImportNotification) => void,
      ) => () => void
    }
    webUtils: typeof import('electron').webUtils
  }
}

export {}
