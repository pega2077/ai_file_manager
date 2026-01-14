import path from 'node:path'
import { promises as fs } from 'node:fs'
import { configManager } from './configManager'
import { getBaseDir, resolveProjectRoot } from './backend/utils/pathHelper'

// Dynamic import for Electron to support both standalone and Electron modes
let app: any = null;

/**
 * Lazy-load Electron app if available
 */
function getElectronApp(): any {
  if (app === null) {
    try {
      // Only import electron if available (Electron environment)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require("electron");
      app = electron.app;
    } catch {
      // Standalone mode - electron not available
      app = false; // Set to false to indicate we've tried and failed
    }
  }
  return app === false ? null : app;
}

type Dict = Record<string, unknown>

function getByPath(obj: Dict | undefined, keyPath: string): unknown {
  if (!obj) return undefined
  return keyPath.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object' && k in (acc as Dict)) {
      return (acc as Dict)[k]
    }
    return undefined
  }, obj)
}

function normalizeLocale(value?: string | null): 'en' | 'zh' {
  if (!value) return 'zh'
  const lower = value.toLowerCase()
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh'
  return 'en'
}

async function findLocalesDir(): Promise<string> {
  // Try common locations in dev/prod
  const projectRoot = resolveProjectRoot()
  const baseDir = getBaseDir()
  const candidates = [
    path.join(projectRoot, 'client', 'locales'),
    path.join(projectRoot, 'locales'),
    path.join(baseDir, 'locales'),
  ]
  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir)
      if (stat.isDirectory()) return dir
    } catch {
      // ignore
    }
  }
  // Fallback to relative to app path or current directory
  const electronApp = getElectronApp();
  if (electronApp) {
    return path.join(electronApp.getAppPath(), 'locales')
  }
  return path.join(process.cwd(), 'locales')
}

class I18n {
  private locale: 'en' | 'zh' = 'zh'
  private loaded = false
  private dictEn: Dict = {}
  private dictZh: Dict = {}

  async load(forceLocale?: string): Promise<void> {
    const cfgLocale = configManager.getConfig().language
    const electronApp = getElectronApp();
    const systemLocale = electronApp ? normalizeLocale(electronApp.getLocale()) : normalizeLocale(process.env.LANG || 'en');
    this.locale = normalizeLocale(forceLocale ?? cfgLocale ?? systemLocale)
    const localesDir = await findLocalesDir()
    try {
      const [enRaw, zhRaw] = await Promise.all([
        fs.readFile(path.join(localesDir, 'en.json'), 'utf-8').catch(() => '{}'),
        fs.readFile(path.join(localesDir, 'zh.json'), 'utf-8').catch(() => '{}'),
      ])
      this.dictEn = JSON.parse(enRaw) as Dict
      this.dictZh = JSON.parse(zhRaw) as Dict
      this.loaded = true
    } catch {
      // keep empty dicts on failure
      this.dictEn = {}
      this.dictZh = {}
      this.loaded = true
    }
  }

  getLocale(): 'en' | 'zh' {
    return this.locale
  }

  t(key: string, fallback?: string): string {
    const dict = this.locale === 'zh' ? this.dictZh : this.dictEn
    const alt = this.locale === 'zh' ? this.dictEn : this.dictZh
    const val = getByPath(dict, key) as string | undefined
    if (typeof val === 'string') return val
    const valAlt = getByPath(alt, key) as string | undefined
    if (typeof valAlt === 'string') return valAlt
    return fallback ?? key
  }
}

export const i18n = new I18n()
