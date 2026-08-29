import type { ImageElement, Layer, Page, Stroke, TextElement } from '../types'
import { drawTextElement } from '../utils/drawText'

const RULED_SPACING = 42
const GRID_SIZE = 34
const MARGIN = 60
const LINE_COLOR = '#c9d4e0'
const MARGIN_COLOR = '#e88a8a'

export function drawTemplate(
  ctx: CanvasRenderingContext2D,
  page: Pick<Page, 'width' | 'height' | 'template' | 'backgroundColor'>,
  scale = 1,
) {
  const w = page.width * scale
  const h = page.height * scale
  ctx.fillStyle = page.backgroundColor ?? '#ffffff'
  ctx.fillRect(0, 0, w, h)

  if (page.template === 'ruled') {
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = 1.5 * scale
    ctx.beginPath()
    for (let y = MARGIN * scale; y <= h; y += RULED_SPACING * scale) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.strokeStyle = MARGIN_COLOR
    ctx.lineWidth = 1.5 * scale
    ctx.beginPath()
    ctx.moveTo(MARGIN * scale, 0)
    ctx.lineTo(MARGIN * scale, h)
    ctx.stroke()
  } else if (page.template === 'grid') {
    ctx.strokeStyle = LINE_COLOR
    ctx.lineWidth = 1 * scale
    ctx.beginPath()
    for (let x = 0; x <= w; x += GRID_SIZE * scale) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
    }
    for (let y = 0; y <= h; y += GRID_SIZE * scale) {
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
  } else if (page.template === 'dot') {
    ctx.fillStyle = LINE_COLOR
    for (let x = (GRID_SIZE / 2) * scale; x < w; x += GRID_SIZE * scale) {
      for (let y = (GRID_SIZE / 2) * scale; y < h; y += GRID_SIZE * scale) {
        ctx.beginPath()
        ctx.arc(x, y, 1.6 * scale, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale = 1,
  colorOverride?: string,
) {
  const pts = stroke.points
  if (pts.length === 0) return
  const color = colorOverride ?? stroke.color
  if (pts.length === 1) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(pts[0].x * scale, pts[0].y * scale, (stroke.size / 2) * scale, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color

  if (stroke.kind === 'highlighter') {
    ctx.globalAlpha = 0.35
    ctx.lineWidth = stroke.size * scale
    ctx.beginPath()
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale)
    for (let i = 1; i < pts.length; i++) {
      const midX = (pts[i].x + pts[i - 1].x) / 2
      const midY = (pts[i].y + pts[i - 1].y) / 2
      ctx.quadraticCurveTo(
        pts[i - 1].x * scale,
        pts[i - 1].y * scale,
        midX * scale,
        midY * scale,
      )
    }
    ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale)
    ctx.stroke()
  } else {
    // Normal pen with pressure sensitivity
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const size = stroke.size * scale * clamp(p1.pressure, 0.15, 1)
      ctx.lineWidth = Math.max(0.6 * scale, size)
      ctx.beginPath()
      ctx.moveTo(p0.x * scale, p0.y * scale)
      ctx.lineTo(p1.x * scale, p1.y * scale)
      ctx.stroke()
    }
  }
  ctx.restore()
}

export function drawTextOnCanvas(
  ctx: CanvasRenderingContext2D,
  textEl: TextElement,
  scale = 1,
) {
  if (!textEl.text || !textEl.text.trim()) return
  drawTextElement(ctx, textEl, scale)
}

export function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  scale = 1,
  drawImage?: (img: ImageElement, s: number) => void,
) {
  ctx.save()
  ctx.globalAlpha = layer.opacity
  for (const img of layer.images) {
    if (drawImage) drawImage(img, scale)
  }
  for (const textEl of layer.texts) {
    drawTextOnCanvas(ctx, textEl, scale)
  }
  for (const stroke of layer.strokes) {
    drawStroke(ctx, stroke, scale)
  }
  ctx.restore()
}
