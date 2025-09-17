/// <reference types="vite/client" />

declare global {
  interface Window {
    electronAPI: {
      selectFolder: () => Promise<string | null>
      openFile: (filePath: string) => Promise<boolean>
      openFolder: (filePath: string) => Promise<boolean>
      selectFile: () => Promise<string | null>
      copyToClipboard: (text: string) => Promise<boolean>
      importFile: () => Promise<unknown>
      getApiBaseUrl: () => Promise<string>
      setApiBaseUrl: (url: string) => Promise<boolean>
      showMainWindow: () => Promise<boolean>
      hideBotWindow: () => Promise<boolean>
      moveBotWindow: (deltaX: number, deltaY: number) => void
    }
    electronStore: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
      delete: (key: string) => Promise<void>
      has: (key: string) => Promise<boolean>
    }
    webUtils: typeof import('electron').webUtils
  }
}

export {}
