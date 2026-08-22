const FALLBACK_FONTS = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Comic Sans MS',
  'Consolas',
  'Courier New',
  'Georgia',
  'Impact',
  'Liberation Sans',
  'Liberation Serif',
  'Noto Sans',
  'Noto Serif',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
]

interface LocalFontInfo {
  family: string
  fullName: string
  postscriptName: string
}

export async function getSystemFonts(): Promise<string[]> {
  const w = window as unknown as {
    queryLocalFonts?: () => Promise<LocalFontInfo[]>
  }
  if (typeof w.queryLocalFonts === 'function') {
    try {
      const fonts = await w.queryLocalFonts()
      const families = Array.from(
        new Set(fonts.map((f) => f.family).filter(Boolean) as string[]),
      )
      if (families.length > 0) {
        families.sort((a, b) => a.localeCompare(b))
        return families
      }
    } catch {
      // permission denied or unsupported - fall through
    }
  }
  return [...FALLBACK_FONTS].sort((a, b) => a.localeCompare(b))
}

export function isFontLoaded(fontFamily: string): boolean {
  try {
    return document.fonts?.check(`16px "${fontFamily}"`) ?? true
  } catch {
    return true
  }
}
