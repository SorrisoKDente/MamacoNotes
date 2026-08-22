import type { ImageElement } from '../types'

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

export function imageEraseParams(
  image: ImageElement,
  pageX: number,
  pageY: number,
  radiusPx: number,
  natW: number,
  natH: number,
): { x: number; y: number; radius: number } | null {
  const scaleX = natW / image.width
  const scaleY = natH / image.height

  const rad = -((image.rotation * Math.PI) / 180)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = image.x + image.width / 2
  const cy = image.y + image.height / 2
  const dx = pageX - cx
  const dy = pageY - cy
  const lx = dx * cos - dy * sin + image.width / 2
  const ly = dx * sin + dy * cos + image.height / 2

  const natX = lx * scaleX
  const natY = ly * scaleY
  const natRadius = Math.max(1, radiusPx * ((scaleX + scaleY) / 2))

  if (
    natX < -natRadius ||
    natY < -natRadius ||
    natX > natW + natRadius ||
    natY > natH + natRadius
  ) {
    return null
  }
  return { x: natX, y: natY, radius: natRadius }
}

interface SessionEntry {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  natW: number
  natH: number
}

/**
 * Holds offscreen canvases for images being erased. Erasing draws directly on
 * the cached canvas (fast), and the canvas is committed back to a dataUrl only
 * when the erase gesture finishes. This avoids re-encoding the whole image on
 * every pointer move, which caused the flicker and extreme slowness.
 */
export class ImageEraseSession {
  private canvases = new Map<string, SessionEntry>()
  private elements = new Map<string, ImageElement>()
  private loading = new Set<string>()

  ensure(img: ImageElement): boolean {
    if (this.canvases.has(img.id)) return true
    if (this.loading.has(img.id)) return false
    this.loading.add(img.id)
    void loadImage(img.dataUrl).then((im) => {
      this.loading.delete(img.id)
      if (!im || im.naturalWidth === 0 || im.naturalHeight === 0) return
      const canvas = document.createElement('canvas')
      canvas.width = im.naturalWidth
      canvas.height = im.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight)
      this.canvases.set(img.id, { canvas, ctx, natW: im.naturalWidth, natH: im.naturalHeight })
      this.elements.set(img.id, img)
    })
    return false
  }

  erase(img: ImageElement, pageX: number, pageY: number, radiusPx: number): boolean {
    const entry = this.canvases.get(img.id)
    if (!entry) return this.ensure(img)
    const p = imageEraseParams(img, pageX, pageY, radiusPx, entry.natW, entry.natH)
    if (!p) return true
    entry.ctx.save()
    entry.ctx.globalCompositeOperation = 'destination-out'
    entry.ctx.beginPath()
    entry.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
    entry.ctx.fill()
    entry.ctx.restore()
    return true
  }

  canvasFor(id: string): HTMLCanvasElement | null {
    return this.canvases.get(id)?.canvas ?? null
  }

  commit(): { element: ImageElement; newUrl: string }[] {
    const changed: { element: ImageElement; newUrl: string }[] = []
    for (const [id, entry] of this.canvases) {
      const el = this.elements.get(id)
      if (!el) continue
      changed.push({ element: el, newUrl: entry.canvas.toDataURL('image/png') })
    }
    this.canvases.clear()
    this.elements.clear()
    this.loading.clear()
    return changed
  }
}
