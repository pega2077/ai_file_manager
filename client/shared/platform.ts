/**
 * Platform detection utilities to handle both Electron and standalone web environments
 */

/**
 * Check if the app is running in Electron environment
 */
export function isElectron(): boolean {
  // Check if we're in Node.js environment with Electron
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    return true;
  }
  
  // Check if we're in renderer process with electronAPI exposed
  if (typeof window !== 'undefined' && window.electronAPI) {
    return true;
  }
  
  return false;
}

/**
 * Check if the app is running in standalone web mode
 */
export function isStandalone(): boolean {
  return !isElectron();
}

/**
 * Get platform type
 */
export function getPlatform(): 'electron' | 'web' {
  return isElectron() ? 'electron' : 'web';
}
