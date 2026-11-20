import type { Layer, Page } from '../types'
import { drawLayer, drawTemplate, loadImageElement } from './drawUtils'

export async function renderThumbnail(
  page: Page,
  width: number,
  height: number,
): Promise<string> {
  const rot = ((page.rotation % 360) + 360) % 360
  const rad = (rot * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const bw = page.width * cos + page.height * sin
  const bh = page.width * sin + page.height * cos
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
  const scale = Math.max(0.02, Math.min(width / bw, height / bh) * dpr * 0.9)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * dpr))
  canvas.height = Math.max(1, Math.round(height * dpr))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#14141f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.translate(canvas.width / 2, canvas.height / 2)
  if (rot !== 0) ctx.rotate(rad)
  ctx.scale(scale, scale)
  ctx.translate(-page.width / 2, -page.height / 2)

  drawTemplate(ctx, page, 1)

  if (page.pdf) {
    const pdfDataUrl = page.pdf.dataUrl
    await loadPdfImage(ctx, pdfDataUrl, page, 1)
  }

  for (const layer of page.layers) {
    if (!layer.visible) continue
    drawLayer(ctx, layer, 1, await loadLayerImages(layer))
  }
  ctx.restore()

  return canvas.toDataURL('image/jpeg', 0.8)
}

async function loadLayerImages(layer: Layer): Promise<Map<string, HTMLImageElement>> {
  const images = new Map<string, HTMLImageElement>()
  for (const imgEl of layer.images) {
    const img = await loadImageElement(imgEl.dataUrl)
    if (img) images.set(imgEl.id, img)
  }
  return images
}

/**
 * Decoded PDF page images, keyed by their `dataUrl`. A PDF page is a multi-MB
 * base64 image, so decoding it again on every thumbnail regeneration blocked
 * the main thread (and competed with the live stroke). The promises are cached
 * (not the bitmaps) so concurrent requests share one decode; a small LRU keeps
 * mixed pages from holding an unbounded number of large images.
 */
const PDF_IMAGE_CACHE_LIMIT = 4
const pdfImageCache = new Map<string, Promise<HTMLImageElement | null>>()

function decodePdfImage(dataUrl: string): Promise<HTMLImageElement | null> {
  const cached = pdfImageCache.get(dataUrl)
  if (cached) {
    // Refresh recency (Map keeps insertion order).
    pdfImageCache.delete(dataUrl)
    pdfImageCache.set(dataUrl, cached)
    return cached
  }
  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      pdfImageCache.delete(dataUrl)
      resolve(null)
    }
    img.src = dataUrl
  })
  pdfImageCache.set(dataUrl, pending)
  while (pdfImageCache.size > PDF_IMAGE_CACHE_LIMIT) {
    const oldest = pdfImageCache.keys().next().value
    if (oldest === undefined) break
    pdfImageCache.delete(oldest)
  }
  return pending
}

async function loadPdfImage(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  page: Page,
  scale: number,
): Promise<void> {
  const img = await decodePdfImage(dataUrl)
  if (!img) return
  const s = Math.min((page.width * scale) / img.width, (page.height * scale) / img.height)
  const w = img.width * s
  const h = img.height * s
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    Math.floor((page.width * scale - w) / 2),
    Math.floor((page.height * scale - h) / 2),
    Math.floor(w),
    Math.floor(h),
  )
  ctx.restore()
}
