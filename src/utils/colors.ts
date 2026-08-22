export const PRESET_COLORS = [
  '#1c1c1c',
  '#ffffff',
  '#d0021b',
  '#f5821f',
  '#f5a623',
  '#f8e71c',
  '#7ed321',
  '#417505',
  '#00ad9f',
  '#4a90e2',
  '#0d3d91',
  '#9013fe',
  '#bd10e0',
  '#d3319f',
  '#ff7b9c',
  '#8b572a',
  '#4a4a4a',
  '#9b9b9b',
]

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const num = parseInt(h, 16)
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 }
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  )
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export function normalizeHex(input: string): string | null {
  const value = input.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(value)) return '#' + value.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const h = value.slice(1)
    return (
      '#' +
      h
        .split('')
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    )
  }
  return null
}
