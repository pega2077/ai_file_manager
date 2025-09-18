import en from '@locales/en.json'
import zh from '@locales/zh.json'

export const supportedLocales = ['en', 'zh'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

export const defaultLocale: SupportedLocale = 'en'

export type TranslationDictionary = Record<string, TranslationValue>
type TranslationValue = string | TranslationDictionary

const dictionaries: Record<SupportedLocale, TranslationDictionary> = {
  en: en as TranslationDictionary,
  zh: zh as TranslationDictionary,
}

export const FALLBACK_LOCALE = defaultLocale

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '简体中文',
}

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return supportedLocales.includes(locale as SupportedLocale)
}

export function normalizeLocale(locale: string | undefined | null): SupportedLocale {
  if (!locale) {
    return FALLBACK_LOCALE
  }

  const normalized = locale.toLowerCase()
  if (isSupportedLocale(normalized)) {
    return normalized
  }

  const base = normalized.split('-')[0]
  if (isSupportedLocale(base)) {
    return base
  }

  return FALLBACK_LOCALE
}

export function getDictionary(locale: string): TranslationDictionary {
  if (isSupportedLocale(locale)) {
    return dictionaries[locale]
  }

  return dictionaries[FALLBACK_LOCALE]
}

export function translateValue(
  locale: string,
  key: string,
  params?: Record<string, string | number>,
): string {
  const normalizedLocale = normalizeLocale(locale)
  const fallbackDict = dictionaries[FALLBACK_LOCALE]
  const dictionary = dictionaries[normalizedLocale]

  const direct = resolveKey(dictionary, key) ??
    (normalizedLocale === FALLBACK_LOCALE ? undefined : resolveKey(fallbackDict, key))

  if (typeof direct !== 'string') {
    if (import.meta.env.DEV) {
      console.warn(`Missing translation for key "${key}" in locale "${normalizedLocale}"`)
    }

    return key
  }

  return formatParams(direct, params)
}

function resolveKey(dictionary: TranslationDictionary, key: string): TranslationValue | undefined {
  const segments = key.split('.')
  let current: TranslationValue | undefined = dictionary

  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function formatParams(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template
  }

  return Object.entries(params).reduce<string>((value, [key, paramValue]) => {
    return value.replace(new RegExp(`{${key}}`, 'g'), String(paramValue))
  }, template)
}
