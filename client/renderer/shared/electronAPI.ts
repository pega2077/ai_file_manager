/**
 * ElectronAPI wrapper with fallbacks for standalone web mode
 * Provides a consistent API interface regardless of running environment
 */

// Check if we're in Electron environment
const isElectron = typeof window !== 'undefined' && window.electronAPI;

/**
 * Safe electronAPI wrapper with web fallbacks
 */
export const electronAPI = {
  // Folder/File selection
  selectFolder: async (): Promise<string | null> => {
    if (isElectron && window.electronAPI?.selectFolder) {
      return window.electronAPI.selectFolder();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFolder not available in web mode');
    return null;
  },

  selectFile: async (): Promise<string[] | null> => {
    if (isElectron && window.electronAPI?.selectFile) {
      return window.electronAPI.selectFile();
    }
    // Web fallback: Not supported in web mode
    console.warn('selectFile not available in web mode');
    return null;
  },

  // File operations
  openFile: async (filePath: string): Promise<boolean> => {
    if (isElectron && window.electronAPI?.openFile) {
      return window.electronAPI.openFile(filePath);
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
    if (isElectron && window.electronAPI?.openFolder) {
      return window.electronAPI.openFolder(filePath);
    }
    // Web fallback: Not supported
    console.warn('openFolder not available in web mode');
    return false;
  },

  // Clipboard
  copyToClipboard: async (text: string): Promise<boolean> => {
    if (isElectron && window.electronAPI?.copyToClipboard) {
      return window.electronAPI.copyToClipboard(text);
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
    if (isElectron && window.electronAPI?.readClipboardText) {
      return window.electronAPI.readClipboardText();
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
    if (isElectron && window.electronAPI?.importFile) {
      return window.electronAPI.importFile();
    }
    // Web fallback: Not supported
    console.warn('importFile not available in web mode');
    return { success: false, message: 'File import not available in web mode' };
  },

  // File URL conversion
  toFileUrl: (filePath: string): string => {
    if (isElectron && window.electronAPI?.toFileUrl) {
      return window.electronAPI.toFileUrl(filePath);
    }
    // Web fallback: Return as is
    return filePath;
  },

  // API Base URL
  getApiBaseUrl: async (): Promise<string> => {
    if (isElectron && window.electronAPI?.getApiBaseUrl) {
      return window.electronAPI.getApiBaseUrl();
    }
    // Web fallback: Use current origin with port 8000
    return window.location.origin || 'http://localhost:8000';
  },

  setApiBaseUrl: async (url: string): Promise<boolean> => {
    if (isElectron && window.electronAPI?.setApiBaseUrl) {
      return window.electronAPI.setApiBaseUrl(url);
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
    if (isElectron && window.electronAPI?.getAppConfig) {
      return window.electronAPI.getAppConfig();
    }
    // Web fallback: Return empty config
    return {};
  },

  updateAppConfig: async (updates: unknown): Promise<unknown> => {
    if (isElectron && window.electronAPI?.updateAppConfig) {
      return window.electronAPI.updateAppConfig(updates);
    }
    // Web fallback: No-op
    return updates;
  },

  // Window management
  showMainWindow: async (options?: { route?: string; refreshFiles?: boolean }): Promise<boolean> => {
    if (isElectron && window.electronAPI?.showMainWindow) {
      return window.electronAPI.showMainWindow(options);
    }
    // Web fallback: Navigate to route if specified
    if (options?.route) {
      window.location.href = options.route;
    }
    return true;
  },

  showBotWindow: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.showBotWindow) {
      return window.electronAPI.showBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  hideBotWindow: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.hideBotWindow) {
      return window.electronAPI.hideBotWindow();
    }
    // Web fallback: Not supported
    return false;
  },

  moveBotWindow: (deltaX: number, deltaY: number): void => {
    if (isElectron && window.electronAPI?.moveBotWindow) {
      window.electronAPI.moveBotWindow(deltaX, deltaY);
    }
    // Web fallback: No-op
  },

  // Locale
  getPreferredLocale: async (): Promise<string> => {
    if (isElectron && window.electronAPI?.getPreferredLocale) {
      return window.electronAPI.getPreferredLocale();
    }
    // Web fallback: Use browser language or localStorage
    return localStorage.getItem('preferredLocale') || navigator.language || 'en';
  },

  setPreferredLocale: async (locale: string): Promise<string> => {
    if (isElectron && window.electronAPI?.setPreferredLocale) {
      return window.electronAPI.setPreferredLocale(locale);
    }
    // Web fallback: Store in localStorage
    localStorage.setItem('preferredLocale', locale);
    return locale;
  },

  getSystemLocale: async (): Promise<string> => {
    if (isElectron && window.electronAPI?.getSystemLocale) {
      return window.electronAPI.getSystemLocale();
    }
    // Web fallback: Use browser language
    return navigator.language || 'en';
  },

  // Logging
  logError: async (message: string, meta?: unknown): Promise<boolean> => {
    if (isElectron && window.electronAPI?.logError) {
      return window.electronAPI.logError(message, meta);
    }
    // Web fallback: Console error
    console.error(message, meta);
    return true;
  },

  // App control
  quitApp: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.quitApp) {
      return window.electronAPI.quitApp();
    }
    // Web fallback: Not supported
    console.warn('quitApp not available in web mode');
    return false;
  },

  clearAllData: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.clearAllData) {
      return window.electronAPI.clearAllData();
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
    if (isElectron && window.electronAPI?.sendFileImportNotification) {
      window.electronAPI.sendFileImportNotification(payload);
    }
    // Web fallback: No-op
  },

  onFileImportNotification: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && window.electronAPI?.onFileImportNotification) {
      return window.electronAPI.onFileImportNotification(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Directory watcher
  registerDirectoryWatcherImporter: (): void => {
    if (isElectron && window.electronAPI?.registerDirectoryWatcherImporter) {
      window.electronAPI.registerDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  unregisterDirectoryWatcherImporter: (): void => {
    if (isElectron && window.electronAPI?.unregisterDirectoryWatcherImporter) {
      window.electronAPI.unregisterDirectoryWatcherImporter();
    }
    // Web fallback: No-op
  },

  pauseDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.pauseDirectoryWatcher) {
      return window.electronAPI.pauseDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  resumeDirectoryWatcher: async (): Promise<boolean> => {
    if (isElectron && window.electronAPI?.resumeDirectoryWatcher) {
      return window.electronAPI.resumeDirectoryWatcher();
    }
    // Web fallback: Not supported
    return false;
  },

  notifyDirectoryWatcherStatus: (payload: any): void => {
    if (isElectron && window.electronAPI?.notifyDirectoryWatcherStatus) {
      window.electronAPI.notifyDirectoryWatcherStatus(payload);
    }
    // Web fallback: No-op
  },

  onDirectoryWatcherImportRequest: (callback: (payload: any) => void): (() => void) => {
    if (isElectron && window.electronAPI?.onDirectoryWatcherImportRequest) {
      return window.electronAPI.onDirectoryWatcherImportRequest(callback);
    }
    // Web fallback: Return no-op cleanup function
    return () => {};
  },

  // Log archive
  getLogArchive: async (): Promise<{ filename: string; data: string; contentType?: string } | null> => {
    if (isElectron && window.electronAPI?.getLogArchive) {
      return window.electronAPI.getLogArchive();
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
