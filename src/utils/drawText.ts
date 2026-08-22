import type { TextElement } from '../types'

export interface TextLayout {
  w: number
  h: number
}

export const DEFAULT_TEXT_WIDTH = 400
export const LINE_HEIGHT_FACTOR = 1.35
const COLUMN_WIDTH_FACTOR = 1.25

export function textFont(el: Pick<TextElement, 'fontSize' | 'fontFamily' | 'bold' | 'italic'>): string {
  const weight = el.bold ? '700' : '400'
  const style = el.italic ? 'italic ' : ''
  return `${weight} ${style}${el.fontSize}px ${el.fontFamily}`
}

export function measureTextElement(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
): TextLayout {
  const lines = el.text.split('\n')
  const fontSize = el.fontSize
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR
  ctx.save()
  ctx.font = textFont(el)
  if (el.direction === 'vertical') {
    const maxLen = Math.max(1, ...lines.map((l) => l.length))
    const w = lines.length * fontSize * COLUMN_WIDTH_FACTOR
    const h = maxLen * lineHeight
    ctx.restore()
    return { w, h }
  }
  const maxLine = Math.max(1, ...lines.map((l) => ctx.measureText(l).width))
  const w = Math.max(el.width, maxLine)
  const h = lines.length * lineHeight
  ctx.restore()
  return { w, h }
}

export function drawTextElement(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  scale = 1,
): void {
  const lines = el.text.split('\n')
  if (lines.length === 0) return
  const fontSize = el.fontSize
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR
  ctx.save()
  ctx.scale(scale, scale)
  ctx.font = textFont(el)

  const { w, h } = measureTextElement(ctx, el)
  const cx = el.x + w / 2
  const cy = el.y + h / 2
  ctx.translate(cx, cy)
  ctx.rotate((el.rotation * Math.PI) / 180)
  ctx.translate(-w / 2, -h / 2)

  if (el.backgroundColor) {
    ctx.fillStyle = el.backgroundColor
    ctx.fillRect(0, 0, w, h)
  }

  ctx.fillStyle = el.color
  ctx.textBaseline = 'alphabetic'

  if (el.direction === 'vertical') {
    drawVerticalText(ctx, el, lines, w, h, lineHeight, fontSize)
  } else {
    drawHorizontalText(ctx, el, lines, w, lineHeight, fontSize)
  }

  ctx.restore()
}

function drawHorizontalText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  lines: string[],
  w: number,
  lineHeight: number,
  fontSize: number,
) {
  ctx.textAlign = el.align
  for (let i = 0; i < lines.length; i++) {
    const prefix =
      el.marker === 'number'
        ? `${i + 1}. `
        : el.marker === 'disc'
          ? '•  '
          : ''
    const text = prefix + lines[i]
    const textW = ctx.measureText(text).width
    let startX: number
    if (el.align === 'center') startX = w / 2
    else if (el.align === 'right') startX = w
    else startX = 0
    const baseline = i * lineHeight + fontSize * 0.95
    ctx.fillText(text, startX, baseline)

    const markerGap = el.marker === 'none' ? 0 : fontSize * 1.1
    const textStart = el.align === 'left' ? markerGap : startX
    if (el.underline) {
      ctx.strokeStyle = el.color
      ctx.lineWidth = Math.max(1, fontSize / 16)
      ctx.beginPath()
      ctx.moveTo(textStart, baseline + fontSize * 0.12)
      ctx.lineTo(textStart + (textW - markerGap), baseline + fontSize * 0.12)
      ctx.stroke()
    }
    if (el.strikethrough) {
      ctx.strokeStyle = el.color
      ctx.lineWidth = Math.max(1, fontSize / 16)
      ctx.beginPath()
      ctx.moveTo(textStart, baseline - fontSize * 0.35)
      ctx.lineTo(textStart + (textW - markerGap), baseline - fontSize * 0.35)
      ctx.stroke()
    }
  }
}

function drawVerticalText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  lines: string[],
  w: number,
  h: number,
  lineHeight: number,
  fontSize: number,
) {
  const colW = fontSize * COLUMN_WIDTH_FACTOR
  const blockW = lines.length * colW
  let startX = 0
  if (el.align === 'center') startX = (w - blockW) / 2
  else if (el.align === 'right') startX = w - blockW
  ctx.textAlign = 'center'
  for (let c = 0; c < lines.length; c++) {
    const line = lines[c]
    const colY = (h - line.length * lineHeight) / 2
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      const y = colY + j * lineHeight + fontSize * 0.95
      ctx.fillText(ch, startX + c * colW + colW / 2, y)
      if (el.underline) {
        ctx.strokeStyle = el.color
        ctx.lineWidth = Math.max(1, fontSize / 16)
        ctx.beginPath()
        ctx.moveTo(startX + c * colW + colW / 2 - fontSize / 2, y)
        ctx.lineTo(startX + c * colW + colW / 2 + fontSize / 2, y)
        ctx.stroke()
      }
      if (el.strikethrough) {
        ctx.strokeStyle = el.color
        ctx.lineWidth = Math.max(1, fontSize / 16)
        ctx.beginPath()
        ctx.moveTo(startX + c * colW + colW / 2 - fontSize / 2, y - fontSize * 0.45)
        ctx.lineTo(startX + c * colW + colW / 2 + fontSize / 2, y - fontSize * 0.45)
        ctx.stroke()
      }
    }
  }
}

export function textElementCorners(el: TextElement, layout: TextLayout): { x: number; y: number }[] {
  const cx = el.x + layout.w / 2
  const cy = el.y + layout.h / 2
  const hw = layout.w / 2
  const hh = layout.h / 2
  const rad = (el.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rot = (dx: number, dy: number) => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  })
  return [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)]
}
