import { useSyncExternalStore } from 'react'
import type { Language } from './languages'
import { ptBRMessages } from './ptBR'
import { enMessages } from './en'

let currentLanguage: Language = 'pt-BR'
const listeners = new Set<() => void>()

function messages(lang: Language): Record<string, string> {
  return lang === 'en' ? enMessages : ptBRMessages
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = messages(currentLanguage)
  let str = dict[key] ?? ptBRMessages[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{{${k}}}`, String(v))
    }
  }
  return str
}

export function getLanguage(): Language {
  return currentLanguage
}

export function applyDocumentLanguage(lang: Language): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.title = lang === 'en' ? 'Mamaco Notes - Notes' : 'Mamaco Notes - Anotações'
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang
  applyDocumentLanguage(lang)
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { inkfolioDesktop?: { setLanguage?: (l: string) => void } })
      .inkfolioDesktop?.setLanguage
  ) {
    ;(window as unknown as { inkfolioDesktop: { setLanguage: (l: string) => void } })
      .inkfolioDesktop.setLanguage(lang)
  }
  listeners.forEach((fn) => fn())
}

export function initI18n(lang: Language): void {
  currentLanguage = lang
}

export function useI18n(): { t: typeof t; lang: Language } {
  useSyncExternalStore(subscribe, () => currentLanguage)
  return { t, lang: currentLanguage }
}
