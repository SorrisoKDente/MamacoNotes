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
