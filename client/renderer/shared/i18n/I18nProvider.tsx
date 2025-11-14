import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiService } from '../../services/api'
import {
  FALLBACK_LOCALE,
  LOCALE_LABELS,
  SupportedLocale,
  normalizeLocale,
  supportedLocales,
  translateValue,
} from './index'

const STORAGE_KEY = 'ai-file-manager.locale'

export type TranslationFunction = (key: string, params?: Record<string, string | number>) => string

type SetLocaleFunction = (locale: SupportedLocale) => void

interface I18nContextValue {
  locale: SupportedLocale
  t: TranslationFunction
  setLocale: SetLocaleFunction
  availableLocales: readonly SupportedLocale[]
  localeLabels: Record<SupportedLocale, string>
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

interface I18nProviderProps {
  children: React.ReactNode
  initialLocale?: string | null
}

function detectInitialLocale(initialLocale?: string | null): SupportedLocale {
  if (initialLocale) {
    return normalizeLocale(initialLocale)
  }

  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      return normalizeLocale(stored)
    }

    if (window.navigator?.language) {
      return normalizeLocale(window.navigator.language)
    }
  }

  return FALLBACK_LOCALE
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => detectInitialLocale(initialLocale))

  useEffect(() => {
    apiService.setLocale(locale)

    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(STORAGE_KEY, locale)

    if (window.electronAPI?.setPreferredLocale) {
      void window.electronAPI.setPreferredLocale(locale)
    }
  }, [locale])

  useEffect(() => {
    if (!window.electronAPI?.getPreferredLocale) {
      return
    }

    void window.electronAPI.getPreferredLocale()
      .then((storedLocale) => {
        if (typeof storedLocale === 'string') {
          setLocaleState(normalizeLocale(storedLocale))
        }
      })
      .catch(() => {
        // Ignore preload errors; fallback logic already covers locale selection.
      })
  }, [])

  const setLocale = useCallback<SetLocaleFunction>((nextLocale) => {
    setLocaleState(normalizeLocale(nextLocale))
  }, [])

  const translate = useCallback<TranslationFunction>((key, params) => {
    return translateValue(locale, key, params)
  }, [locale])

  const contextValue = useMemo<I18nContextValue>(() => ({
    locale,
    t: translate,
    setLocale,
    availableLocales: supportedLocales,
    localeLabels: LOCALE_LABELS,
  }), [locale, setLocale, translate])

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
    </I18nContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTranslation() {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useTranslation must be used within I18nProvider')
  }

  return context
}

