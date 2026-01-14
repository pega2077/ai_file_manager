/**
 * ElectronAPI wrapper with fallbacks for standalone web mode
 * Provides a consistent API interface regardless of running environment
 */

// Check if we're in Electron environment
const isElectron = typeof window !== 'undefined' && window.electronAPI;
const nativeElectronAPI = typeof window !== 'undefined' ? window.electronAPI : null;

/**
 * Safe electronAPI wrapper with web fallbacks
 */
export const electronAPI = {
  // Folder/File selection
  selectFolder: async (): Promise<string | null> => {
    if (isElectron && nativeElectronAPI?.selectFolder) {
      return nativeElectronAPI.selectFolder();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFolder not available in web mode');
    return null;
  },

  selectFile: async (): Promise<string[] | null> => {
    if (isElectron && nativeElectronAPI?.selectFile) {
      return nativeElectronAPI.selectFile();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFile not available in web mode');
    return null;
  },

  // File operations
  openFile: async (filePath: string): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.openFile) {
      return nativeElectronAPI.openFile(filePath);
    }
    // Web fallback: Open in new tab
    console.warn('openFile not fully supported in web mode, attempting to open URL');
    try {
      window.open(filePath, '_blank');
      return true;
    } catch {
      return false;
    }
  },

  openFolder: async (filePath: string): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.openFolder) {
      return nativeElectronAPI.openFolder(filePath);
    }
    // Web fallback: Not supported
    console.warn('openFolder not available in web mode');
    return false;
  },

  // Clipboard
  copyToClipboard: async (text: string): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.copyToClipboard) {
      return nativeElectronAPI.copyToClipboard(text);
    }
    // Web fallback: Use navigator.clipboard API
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },

  readClipboardText: async (): Promise<string> => {
    if (isElectron && nativeElectronAPI?.readClipboardText) {
      return nativeElectronAPI.readClipboardText();
    }
    // Web fallback: Use navigator.clipboard API
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },

  // File import
  importFile: async (): Promise<{ success: boolean; message: string }> => {
    if (isElectron && nativeElectronAPI?.importFile) {
      return nativeElectronAPI.importFile();
    }
    // Web fallback: Not supported
    console.warn('importFile not available in web mode');
    return { success: false, message: 'File import not available in web mode' };
  },

  // File URL conversion
  toFileUrl: (filePath: string): string => {
    if (isElectron && nativeElectronAPI?.toFileUrl) {
      return nativeElectronAPI.toFileUrl(filePath);
    }
    // Web fallback: Return as is
    return filePath;
  },

  // API Base URL
  getApiBaseUrl: async (): Promise<string> => {
    if (isElectron && nativeElectronAPI?.getApiBaseUrl) {
      return nativeElectronAPI.getApiBaseUrl();
    }
    // Web fallback: Use current origin with port 8000
    return window.location.origin || 'http://localhost:8000';
  },

  setApiBaseUrl: async (url: string): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.setApiBaseUrl) {
      return nativeElectronAPI.setApiBaseUrl(url);
    }
    // Web fallback: Store in localStorage
    try {
      localStorage.setItem('apiBaseUrl', url);
      return true;
    } catch {
      return false;
    }
  },

  // App config
  getAppConfig: async (): Promise<unknown> => {
    if (isElectron && nativeElectronAPI?.getAppConfig) {
      return nativeElectronAPI.getAppConfig();
    }
    // Web fallback: Return empty config
    return {};
  },

  updateAppConfig: async (updates: unknown): Promise<unknown> => {
    if (isElectron && nativeElectronAPI?.updateAppConfig) {
      return nativeElectronAPI.updateAppConfig(updates);
    }
    // Web fallback: No-op
    return updates;
  },

  // Window management
  showMainWindow: async (options?: { route?: string; refreshFiles?: boolean }): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.showMainWindow) {
      return nativeElectronAPI.showMainWindow(options);
    }
    // Web fallback: Navigate to route if specified
    if (options?.route) {
      window.location.href = options.route;
    }
    return true;
  },

  showBotWindow: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.showBotWindow) {
      return nativeElectronAPI.showBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  hideBotWindow: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.hideBotWindow) {
      return nativeElectronAPI.hideBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  moveBotWindow: (deltaX: number, deltaY: number): void => {
    if (isElectron && nativeElectronAPI?.moveBotWindow) {
      nativeElectronAPI.moveBotWindow(deltaX, deltaY);
    }
    // Web fallback: No-op
  },

  // Locale
  getPreferredLocale: async (): Promise<string> => {
    if (isElectron && nativeElectronAPI?.getPreferredLocale) {
      return nativeElectronAPI.getPreferredLocale();
    }
    // Web fallback: Use browser language or localStorage
    return localStorage.getItem('preferredLocale') || navigator.language || 'en';
  },

  setPreferredLocale: async (locale: string): Promise<string> => {
    if (isElectron && nativeElectronAPI?.setPreferredLocale) {
      return nativeElectronAPI.setPreferredLocale(locale);
    }
    // Web fallback: Store in localStorage
    localStorage.setItem('preferredLocale', locale);
    return locale;
  },

  getSystemLocale: async (): Promise<string> => {
    if (isElectron && nativeElectronAPI?.getSystemLocale) {
      return nativeElectronAPI.getSystemLocale();
    }
    // Web fallback: Use browser language
    return navigator.language || 'en';
  },

  // Logging
  logError: async (message: string, meta?: unknown): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.logError) {
      return nativeElectronAPI.logError(message, meta);
    }
    // Web fallback: Console error
    console.error(message, meta);
    return true;
  },

  // App control
  quitApp: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.quitApp) {
      return nativeElectronAPI.quitApp();
    }
    // Web fallback: Not supported
    console.warn('quitApp not available in web mode');
    return false;
  },

  clearAllData: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.clearAllData) {
      return nativeElectronAPI.clearAllData();
    }
    // Web fallback: Clear localStorage
    try {
      localStorage.clear();
      return true;
    } catch {
      return false;
    }
  },

  // File import notifications
  sendFileImportNotification: (payload: any): void => {
    if (isElectron && nativeElectronAPI?.sendFileImportNotification) {
      nativeElectronAPI.sendFileImportNotification(payload);
    }
    // Web fallback: No-op
  },

  onFileImportNotification: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && nativeElectronAPI?.onFileImportNotification) {
      return nativeElectronAPI.onFileImportNotification(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Directory watcher
  registerDirectoryWatcherImporter: (): void => {
    if (isElectron && nativeElectronAPI?.registerDirectoryWatcherImporter) {
      nativeElectronAPI.registerDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  unregisterDirectoryWatcherImporter: (): void => {
    if (isElectron && nativeElectronAPI?.unregisterDirectoryWatcherImporter) {
      nativeElectronAPI.unregisterDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  pauseDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.pauseDirectoryWatcher) {
      return nativeElectronAPI.pauseDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  resumeDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && nativeElectronAPI?.resumeDirectoryWatcher) {
      return nativeElectronAPI.resumeDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  notifyDirectoryWatcherStatus: (payload: any): void => {
    if (isElectron && nativeElectronAPI?.notifyDirectoryWatcherStatus) {
      nativeElectronAPI.notifyDirectoryWatcherStatus(payload);
    }
    // Web fallback: No-op
  },

  onDirectoryWatcherImportRequest: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && nativeElectronAPI?.onDirectoryWatcherImportRequest) {
      return nativeElectronAPI.onDirectoryWatcherImportRequest(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Log archive
  getLogArchive: async (): Promise<{ filename: string; data: string; contentType?: string } | null> => {
    if (isElectron && nativeElectronAPI?.getLogArchive) {
      return nativeElectronAPI.getLogArchive();
    }
    // Web fallback: Not supported
    return null;
  },
};

/**
 * Check if running in Electron environment
 */
export const isElectronEnvironment = (): boolean => {
  return !!isElectron;
};

/**
 * Check if running in standalone web environment
 */
export const isWebEnvironment = (): boolean => {
  return !isElectron;
};
