import type { ImageElement, Layer, Page } from '../types'
import { drawTemplate, drawStroke, drawTextOnCanvas } from './drawUtils'

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
  const scale = Math.max(0.02, Math.min(width / bw, height / bh))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
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
    ctx.save()
    ctx.globalAlpha = layer.opacity
    await loadLayerImages(ctx, layer, 1)
    for (const textEl of layer.texts) {
      drawTextOnCanvas(ctx, textEl, 1)
    }
    for (const stroke of layer.strokes) {
      drawStroke(ctx, stroke, 1)
    }
    ctx.restore()
  }
  ctx.restore()

  return canvas.toDataURL('image/jpeg', 0.72)
}

function loadLayerImages(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  scale: number,
): Promise<void> {
  return loadImagesSequentially(ctx, layer.images, scale)
}

function loadPdfImage(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  page: Page,
  scale: number,
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
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
      resolve()
    }
    img.onerror = () => resolve()
    img.src = dataUrl
  })
}

function loadImagesSequentially(
  ctx: CanvasRenderingContext2D,
  imageEls: ImageElement[],
  scale: number,
): Promise<void> {
  let i = 0
  return new Promise((resolve) => {
    function next() {
      if (i >= imageEls.length) {
        resolve()
        return
      }
      const imgEl = imageEls[i]
      i += 1
      const img = new Image()
      img.onload = () => {
        ctx.save()
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.translate(
          Math.floor((imgEl.x + imgEl.width / 2) * scale),
          Math.floor((imgEl.y + imgEl.height / 2) * scale),
        )
        ctx.rotate((imgEl.rotation * Math.PI) / 180)
        ctx.drawImage(
          img,
          Math.floor((-imgEl.width / 2) * scale),
          Math.floor((-imgEl.height / 2) * scale),
          Math.floor(imgEl.width * scale),
          Math.floor(imgEl.height * scale),
        )
        ctx.restore()
        next()
      }
      img.onerror = () => next()
      img.src = imgEl.dataUrl
    }
    next()
  })
}
