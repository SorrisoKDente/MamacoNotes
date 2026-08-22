export type Language = 'pt-BR' | 'en'

export const SUPPORTED_LANGUAGES: { code: Language; label: string }[] = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en', label: 'English' },
]

export function detectLanguage(): Language {
  const nav = typeof navigator !== 'undefined' ? navigator.language : ''
  return nav.toLowerCase().startsWith('en') ? 'en' : 'pt-BR'
}
