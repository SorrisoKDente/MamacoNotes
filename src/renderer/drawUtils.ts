import type { ImageElement, Layer, Page, Stroke, TextElement } from '../types'
import { layerItems } from '../types'
import { drawTextElement } from '../utils/drawText'
import { clamp } from '../utils/math'

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

/**
 * Width quantum (device px) used to bucket pressure-derived stroke widths.
 * Pen pressure changes on almost every sample, so without bucketing we issue
 * one `stroke()` per point — thousands per frame on ink-heavy pages. Bucketing
 * merges neighbouring samples into the same path: at most ~32 `stroke()` calls
 * per stroke (instead of one per sample), with no visible seam (round caps
 * overlap).
 */
const PRESSURE_SIZE_QUANTUM = 0.5

export function tracePressurePolyline(
  ctx: CanvasRenderingContext2D,
  pts: Stroke['points'],
  baseSize: number,
  scale = 1,
) {
  const bucket = PRESSURE_SIZE_QUANTUM * scale
  const minSize = 0.6 * scale
  // Two bounds keep the call count linear-ish and small regardless of how
  // noisy the pressure samples are:
  //  - hysteresis: only change width when the new bucket is ~1px away, so
  //    jitter around a bucket boundary does not flap between widths;
  //  - stride: at most ~32 width changes per stroke, no matter its length.
  // Round caps overlap, so the seams are invisible.
  const HYSTERESIS = 2
  const MAX_WIDTH_CHANGES = 32
  const stride = Math.max(1, Math.ceil(pts.length / MAX_WIDTH_CHANGES))
  let lastBucket = -1
  let lastSwitch = 0
  let started = false

  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const size = Math.max(minSize, baseSize * scale * clamp(p1.pressure, 0.15, 1))
    const q = Math.max(1, Math.round(size / bucket))

    if (!started || (i - lastSwitch >= stride && Math.abs(q - lastBucket) >= HYSTERESIS)) {
      if (started) ctx.stroke()
      ctx.lineWidth = q * bucket
      ctx.beginPath()
      ctx.moveTo(p0.x * scale, p0.y * scale)
      started = true
      lastBucket = q
      lastSwitch = i
    }
    ctx.lineTo(p1.x * scale, p1.y * scale)
  }
  if (started) ctx.stroke()
}

// ponytail: removed local clamp
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
    const size = Math.max(0.6 * scale, stroke.size * scale * clamp(pts[0].pressure, 0.15, 1))
    ctx.arc(pts[0].x * scale, pts[0].y * scale, size / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color

  if (stroke.geometry) {
    const start = pts[0]
    const end = pts[pts.length - 1]
    ctx.lineWidth = stroke.size * scale
    ctx.beginPath()
    if (stroke.geometry === 'line' || stroke.geometry === 'arrow') {
      ctx.moveTo(start.x * scale, start.y * scale)
      ctx.lineTo(end.x * scale, end.y * scale)
    } else if (stroke.geometry === 'rectangle') {
      ctx.rect(start.x * scale, start.y * scale, (end.x - start.x) * scale, (end.y - start.y) * scale)
    } else if (stroke.geometry === 'ellipse') {
      ctx.ellipse(
        ((start.x + end.x) / 2) * scale,
        ((start.y + end.y) / 2) * scale,
        (Math.abs(end.x - start.x) / 2) * scale,
        (Math.abs(end.y - start.y) / 2) * scale,
        0,
        0,
        Math.PI * 2,
      )
    } else {
      const left = Math.min(start.x, end.x)
      const right = Math.max(start.x, end.x)
      const top = Math.min(start.y, end.y)
      const bottom = Math.max(start.y, end.y)
      ctx.moveTo(((left + right) / 2) * scale, top * scale)
      ctx.lineTo(right * scale, bottom * scale)
      ctx.lineTo(left * scale, bottom * scale)
      ctx.closePath()
    }
    ctx.stroke()
    if (stroke.geometry === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x)
      const head = Math.max(8, stroke.size * 4) * scale
      ctx.beginPath()
      ctx.moveTo(end.x * scale, end.y * scale)
      ctx.lineTo(end.x * scale - head * Math.cos(angle - Math.PI / 6), end.y * scale - head * Math.sin(angle - Math.PI / 6))
      ctx.moveTo(end.x * scale, end.y * scale)
      ctx.lineTo(end.x * scale - head * Math.cos(angle + Math.PI / 6), end.y * scale - head * Math.sin(angle + Math.PI / 6))
      ctx.stroke()
    }
    ctx.restore()
    return
  }

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
    tracePressurePolyline(ctx, pts, stroke.size, scale)
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

export function loadImageElement(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export function drawImageElement(
  ctx: CanvasRenderingContext2D,
  imgEl: ImageElement,
  image: CanvasImageSource,
  scale = 1,
) {
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(
    Math.floor((imgEl.x + imgEl.width / 2) * scale),
    Math.floor((imgEl.y + imgEl.height / 2) * scale),
  )
  ctx.rotate((imgEl.rotation * Math.PI) / 180)
  ctx.drawImage(
    image,
    Math.floor((-imgEl.width / 2) * scale),
    Math.floor((-imgEl.height / 2) * scale),
    Math.floor(imgEl.width * scale),
    Math.floor(imgEl.height * scale),
  )
  ctx.restore()
}

/**
 * Draws a whole layer in z-order. Images must be preloaded by the caller
 * (`loadImageElement`) and keyed by element id; missing ones are skipped.
 */
export function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  scale = 1,
  images?: Map<string, HTMLImageElement>,
) {
  ctx.save()
  ctx.globalAlpha = layer.opacity
  for (const item of layerItems(layer)) {
    if (item.kind === 'stroke') drawStroke(ctx, item.item, scale)
    else if (item.kind === 'image') {
      const image = images?.get(item.item.id)
      if (image) drawImageElement(ctx, item.item, image, scale)
    } else drawTextOnCanvas(ctx, item.item, scale)
  }
  ctx.restore()
}
