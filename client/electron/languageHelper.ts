import path from 'node:path'
import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { configManager } from './configManager'
import { getBaseDir, resolveProjectRoot } from './backend/utils/pathHelper'

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
  // Fallback to relative to app path
  return path.join(app.getAppPath(), 'locales')
}

class I18n {
  private locale: 'en' | 'zh' = 'zh'
  private loaded = false
  private dictEn: Dict = {}
  private dictZh: Dict = {}

  async load(forceLocale?: string): Promise<void> {
    const cfgLocale = configManager.getConfig().language
    const systemLocale = normalizeLocale(app.getLocale())
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
