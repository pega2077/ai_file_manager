/// <reference types="vite/client" />

declare global {
  interface Window {
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
    }
    webUtils: typeof import('electron').webUtils
  }
}

export {}
