/**
 * ElectronAPI wrapper with fallbacks for standalone web mode
 * Provides a consistent API interface regardless of running environment
 */

// Check if we're in Electron environment
const isElectron = typeof window !== 'undefined' && electronAPI;

/**
 * Safe electronAPI wrapper with web fallbacks
 */
export const electronAPI = {
  // Folder/File selection
  selectFolder: async (): Promise<string | null> => {
    if (isElectron && electronAPI.selectFolder) {
      return electronAPI.selectFolder();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFolder not available in web mode');
    return null;
  },

  selectFile: async (): Promise<string[] | null> => {
    if (isElectron && electronAPI.selectFile) {
      return electronAPI.selectFile();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFile not available in web mode');
    return null;
  },

  // File operations
  openFile: async (filePath: string): Promise<boolean> => {
    if (isElectron && electronAPI.openFile) {
      return electronAPI.openFile(filePath);
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
    if (isElectron && electronAPI.openFolder) {
      return electronAPI.openFolder(filePath);
    }
    // Web fallback: Not supported
    console.warn('openFolder not available in web mode');
    return false;
  },

  // Clipboard
  copyToClipboard: async (text: string): Promise<boolean> => {
    if (isElectron && electronAPI.copyToClipboard) {
      return electronAPI.copyToClipboard(text);
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
    if (isElectron && electronAPI.readClipboardText) {
      return electronAPI.readClipboardText();
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
    if (isElectron && electronAPI.importFile) {
      return electronAPI.importFile();
    }
    // Web fallback: Not supported
    console.warn('importFile not available in web mode');
    return { success: false, message: 'File import not available in web mode' };
  },

  // File URL conversion
  toFileUrl: (filePath: string): string => {
    if (isElectron && electronAPI.toFileUrl) {
      return electronAPI.toFileUrl(filePath);
    }
    // Web fallback: Return as is
    return filePath;
  },

  // API Base URL
  getApiBaseUrl: async (): Promise<string> => {
    if (isElectron && electronAPI.getApiBaseUrl) {
      return electronAPI.getApiBaseUrl();
    }
    // Web fallback: Use current origin with port 8000
    return window.location.origin || 'http://localhost:8000';
  },

  setApiBaseUrl: async (url: string): Promise<boolean> => {
    if (isElectron && electronAPI.setApiBaseUrl) {
      return electronAPI.setApiBaseUrl(url);
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
    if (isElectron && electronAPI.getAppConfig) {
      return electronAPI.getAppConfig();
    }
    // Web fallback: Return empty config
    return {};
  },

  updateAppConfig: async (updates: unknown): Promise<unknown> => {
    if (isElectron && electronAPI.updateAppConfig) {
      return electronAPI.updateAppConfig(updates);
    }
    // Web fallback: No-op
    return updates;
  },

  // Window management
  showMainWindow: async (options?: { route?: string; refreshFiles?: boolean }): Promise<boolean> => {
    if (isElectron && electronAPI.showMainWindow) {
      return electronAPI.showMainWindow(options);
    }
    // Web fallback: Navigate to route if specified
    if (options?.route) {
      window.location.href = options.route;
    }
    return true;
  },

  showBotWindow: async (): Promise<boolean> => {
    if (isElectron && electronAPI.showBotWindow) {
      return electronAPI.showBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  hideBotWindow: async (): Promise<boolean> => {
    if (isElectron && electronAPI.hideBotWindow) {
      return electronAPI.hideBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  moveBotWindow: (deltaX: number, deltaY: number): void => {
    if (isElectron && electronAPI.moveBotWindow) {
      electronAPI.moveBotWindow(deltaX, deltaY);
    }
    // Web fallback: No-op
  },

  // Locale
  getPreferredLocale: async (): Promise<string> => {
    if (isElectron && electronAPI.getPreferredLocale) {
      return electronAPI.getPreferredLocale();
    }
    // Web fallback: Use browser language or localStorage
    return localStorage.getItem('preferredLocale') || navigator.language || 'en';
  },

  setPreferredLocale: async (locale: string): Promise<string> => {
    if (isElectron && electronAPI.setPreferredLocale) {
      return electronAPI.setPreferredLocale(locale);
    }
    // Web fallback: Store in localStorage
    localStorage.setItem('preferredLocale', locale);
    return locale;
  },

  getSystemLocale: async (): Promise<string> => {
    if (isElectron && electronAPI.getSystemLocale) {
      return electronAPI.getSystemLocale();
    }
    // Web fallback: Use browser language
    return navigator.language || 'en';
  },

  // Logging
  logError: async (message: string, meta?: unknown): Promise<boolean> => {
    if (isElectron && electronAPI.logError) {
      return electronAPI.logError(message, meta);
    }
    // Web fallback: Console error
    console.error(message, meta);
    return true;
  },

  // App control
  quitApp: async (): Promise<boolean> => {
    if (isElectron && electronAPI.quitApp) {
      return electronAPI.quitApp();
    }
    // Web fallback: Not supported
    console.warn('quitApp not available in web mode');
    return false;
  },

  clearAllData: async (): Promise<boolean> => {
    if (isElectron && electronAPI.clearAllData) {
      return electronAPI.clearAllData();
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
    if (isElectron && electronAPI.sendFileImportNotification) {
      electronAPI.sendFileImportNotification(payload);
    }
    // Web fallback: No-op
  },

  onFileImportNotification: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && electronAPI.onFileImportNotification) {
      return electronAPI.onFileImportNotification(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Directory watcher
  registerDirectoryWatcherImporter: (): void => {
    if (isElectron && electronAPI.registerDirectoryWatcherImporter) {
      electronAPI.registerDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  unregisterDirectoryWatcherImporter: (): void => {
    if (isElectron && electronAPI.unregisterDirectoryWatcherImporter) {
      electronAPI.unregisterDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  pauseDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && electronAPI.pauseDirectoryWatcher) {
      return electronAPI.pauseDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  resumeDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && electronAPI.resumeDirectoryWatcher) {
      return electronAPI.resumeDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  notifyDirectoryWatcherStatus: (payload: any): void => {
    if (isElectron && electronAPI.notifyDirectoryWatcherStatus) {
      electronAPI.notifyDirectoryWatcherStatus(payload);
    }
    // Web fallback: No-op
  },

  onDirectoryWatcherImportRequest: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && electronAPI.onDirectoryWatcherImportRequest) {
      return electronAPI.onDirectoryWatcherImportRequest(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Log archive
  getLogArchive: async (): Promise<{ filename: string; data: string; contentType?: string } | null> => {
    if (isElectron && electronAPI.getLogArchive) {
      return electronAPI.getLogArchive();
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
