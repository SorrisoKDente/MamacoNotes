import type { Page, Stroke, ToolKind, ImageElement, TextElement, PageViewMode, Rect, StrokeErasure } from '../types'
import { layerItems, newId } from '../types'
import { drawTextElement, measureTextElement, textElementCorners } from '../utils/drawText'
import { pageVisualRect, type PageOffset } from '../utils/layout'
import { drawTemplate, tracePressurePolyline } from './drawUtils'
import { clamp } from '../utils/math'
import { trace } from '../utils/debug'

interface RendererCallbacks {
  onStrokeEnd: (stroke: Stroke) => void
  onRequestRerender: () => void
}

interface CanvasProps {
  canvas: HTMLCanvasElement
  page: Page
  zoom: number
  panX: number
  panY: number
  callbacks: RendererCallbacks
}


export interface SelectionRegion {
  type: 'rect' | 'circle' | 'free'
  points: { x: number; y: number }[]
}

/** Pixel budget shared by the page-sized bitmaps (20 MP ≈ 80 MB at 4 B/px). */
export const PAGE_BITMAP_MAX_PIXELS = 20_000_000

/**
 * Resolution of every page-sized bitmap: the display scale (zoom × DPR) so a
 * blit is 1:1 and nothing looks softer than a full render, lowered only when a
 * huge page would exceed the pixel budget. `tryCachedPage` refuses the cache in
 * that case rather than upscaling it (upscaling is what made PDF text blurry).
 */
export function pageRenderScale(width: number, height: number, zoom: number, dpr: number): number {
  let scale = Math.max(0.25, zoom * dpr)
  const pagePixels = width * height
  if (pagePixels > 0 && pagePixels * scale * scale > PAGE_BITMAP_MAX_PIXELS) {
    scale = Math.max(0.25, Math.sqrt(PAGE_BITMAP_MAX_PIXELS / pagePixels))
  }
  return scale
}

export function maskRenderScale(width: number, height: number, zoom: number, dpr: number): number {
  return pageRenderScale(width, height, zoom, dpr)
}

export function shouldUsePageCache(
  drawing: boolean,
  hasCurrentStroke: boolean,
  hasPdfBackground = false,
): boolean {
  return drawing && hasCurrentStroke && !hasPdfBackground
}

export class PageCanvas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  page: Page
  zoom = 1
  panX = 0
  panY = 0
  callbacks: RendererCallbacks

  devicePixelRatio = window.devicePixelRatio || 1

  drawing = false
  currentStroke: Stroke | null = null
  lastPoint: { x: number; y: number } | null = null
  private lastRect: DOMRect | null = null

  eraserActive = false
  eraserPoint: { x: number; y: number } | null = null

  pages: Page[] = []
  offsets: PageOffset[] = []
  viewMode: PageViewMode = 'separate'
  currentPageIndex = 0

  private imageCache = new Map<string, HTMLImageElement>()
  private static globalImageCache = new Map<string, HTMLImageElement>()
  private imageOverrides = new Map<string, { dataUrl: string; canvas: HTMLCanvasElement }>()
  private scratchCanvas: HTMLCanvasElement | null = null
  private scratchCtx: CanvasRenderingContext2D | null = null
  private bgCache = new Map<string, { canvas: HTMLCanvasElement; scale: number }>()
  private pdfCache = new Map<string, { canvas: HTMLCanvasElement; scale: number }>()
  private pageCache: { page: Page; canvas: HTMLCanvasElement; scale: number; signature: string } | null = null
  /** Last render path, only to log transitions (see `trace`). */
  private lastPath = ''

  constructor(props: CanvasProps) {
    this.canvas = props.canvas
    this.page = props.page
    this.pages = [props.page]
    this.zoom = props.zoom
    this.panX = props.panX
    this.panY = props.panY
    this.callbacks = props.callbacks
    this.ctx = this.canvas.getContext('2d')!
  }

  setDocument(
    pages: Page[],
    offsets: PageOffset[],
    viewMode: PageViewMode,
    currentPageIndex: number,
  ) {
    this.pages = pages
    this.offsets = offsets
    this.viewMode = viewMode
    this.currentPageIndex = currentPageIndex
    const current = pages[currentPageIndex]
    if (current) this.page = current
  }

  get currentOffset(): PageOffset {
    return this.offsets[this.currentPageIndex] ?? { x: 0, y: 0 }
  }

  /**
   * Re-reads the canvas rect. The value is cached: pointer handlers call this on
   * every event, and an uncached getBoundingClientRect() there forces a layout
   * flush per event (the main cause of the cursor stutter).
   */
  updateRect(force = false) {
    if (!force && this.lastRect) return
    this.lastRect = this.canvas.getBoundingClientRect()
  }

  /** Drop the cached rect after any layout change (resize, panels, scroll). */
  invalidateRect() {
    this.lastRect = null
  }

  private rect(): DOMRect {
    if (!this.lastRect) this.lastRect = this.canvas.getBoundingClientRect()
    return this.lastRect
  }

  /** Cached canvas rect (no layout read after the first call). */
  getRect(): DOMRect {
    return this.rect()
  }

  toPageCoords(px: number, py: number): { x: number; y: number } {
    const rect = this.rect()
    const off = this.currentOffset
    let x = (px - rect.left - this.panX) / this.zoom - off.x
    let y = (py - rect.top - this.panY) / this.zoom - off.y
    const rot = ((this.page.rotation % 360) + 360) % 360
    if (rot !== 0) {
      const cx = this.page.width / 2
      const cy = this.page.height / 2
      const rad = (rot * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = x - cx
      const dy = y - cy
      x = cx + dx * cos + dy * sin
      y = cy - dx * sin + dy * cos
    }
    return { x, y }
  }

  toDocumentCoords(px: number, py: number): { x: number; y: number } {
    const rect = this.rect()
    return {
      x: (px - rect.left - this.panX) / this.zoom,
      y: (py - rect.top - this.panY) / this.zoom,
    }
  }

  toPageCoordsAt(px: number, py: number, pageIndex: number): { x: number; y: number } {
    const rect = this.rect()
    const off = this.offsets[pageIndex] ?? { x: 0, y: 0 }
    const pg = this.pages[pageIndex]
    if (!pg) return { x: 0, y: 0 }
    let x = (px - rect.left - this.panX) / this.zoom - off.x
    let y = (py - rect.top - this.panY) / this.zoom - off.y
    const rot = ((pg.rotation % 360) + 360) % 360
    if (rot !== 0) {
      const cx = pg.width / 2
      const cy = pg.height / 2
      const rad = (rot * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = x - cx
      const dy = y - cy
      x = cx + dx * cos + dy * sin
      y = cy - dx * sin + dy * cos
    }
    return { x, y }
  }

  toScreenCoords(px: number, py: number): { x: number; y: number } {
    const rect = this.rect()
    const off = this.currentOffset
    const rot = ((this.page.rotation % 360) + 360) % 360
    let x = px
    let y = py
    if (rot !== 0) {
      const cx = this.page.width / 2
      const cy = this.page.height / 2
      const rad = (rot * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const dx = px - cx
      const dy = py - cy
      x = cx + dx * cos - dy * sin
      y = cy + dx * sin + dy * cos
    }
    return {
      x: rect.left + this.panX + (x + off.x) * this.zoom,
      y: rect.top + this.panY + (y + off.y) * this.zoom,
    }
  }

  beginStroke(
    tool: ToolKind,
    color: string,
    size: number,
    px: number,
    py: number,
    pressure = 1,
    geometry?: Stroke['geometry'],
  ) {
    let p = this.toPageCoords(px, py)
    // A new stroke starting while the previous one is still active means its
    // pointerup was swallowed: log it, that is the "second stroke disappears" bug.
    if (this.drawing) trace('engine.begin(stale)', `pts=${this.currentStroke?.points.length ?? 0}`)
    trace('engine.begin', tool, `page=${this.page?.id.slice(0, 6)}`, `pts=1`)
    this.drawing = true
    this.currentStroke = {
      id: newId(),
      kind: tool,
      color,
      size,
      points: [{ x: p.x, y: p.y, pressure }],
      geometry,
    }
    this.lastPoint = p
  }

  extendStroke(px: number, py: number, pressure = 1, constrain: 'square' | 'direction' | false = false) {
    if (!this.drawing || !this.currentStroke) return
    let p = this.toPageCoords(px, py)
    const last = this.currentStroke.points[this.currentStroke.points.length - 1]
    const dx = p.x - last.x
    const dy = p.y - last.y
    const distSq = dx * dx + dy * dy
    if (distSq < 0.4) return

    // ponytail: relax "teleportation" filter to 1000px to avoid discarding strokes
    // during lag spikes, while still catching extreme palm-rejection artifacts.
    if (distSq > 1000 * 1000) return

    if (this.currentStroke.geometry && constrain === 'square') {
      const start = this.currentStroke.points[0]
      const side = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y))
      p = {
        x: start.x + Math.sign(p.x - start.x || 1) * side,
        y: start.y + Math.sign(p.y - start.y || 1) * side,
      }
    } else if (this.currentStroke.geometry && constrain === 'direction') {
      const start = this.currentStroke.points[0]
      const distance = Math.hypot(p.x - start.x, p.y - start.y)
      const angle = Math.atan2(p.y - start.y, p.x - start.x)
      const snappedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      p = {
        x: start.x + Math.cos(snappedAngle) * distance,
        y: start.y + Math.sin(snappedAngle) * distance,
      }
    }
    if (this.currentStroke.geometry) {
      if (this.currentStroke.points.length === 1) this.currentStroke.points.push({ x: p.x, y: p.y, pressure })
      else this.currentStroke.points[1] = { x: p.x, y: p.y, pressure }
    } else {
      this.currentStroke.points.push({ x: p.x, y: p.y, pressure })
    }
    this.lastPoint = p
    this.callbacks.onRequestRerender()
  }

  endStroke(): Stroke | null {
    if (!this.drawing || !this.currentStroke) {
      trace('engine.end(null)', `drawing=${this.drawing}`)
      return null
    }
    const stroke = this.currentStroke
    trace('engine.end', `pts=${stroke.points.length}`)
    this.drawing = false
    this.currentStroke = null
    this.lastPoint = null
    if (stroke.points.length < 2) return stroke
    return stroke
  }

  resize() {
    const rect = this.rect()
    if (rect.width === 0 || rect.height === 0) return
    const dpr = this.devicePixelRatio
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  render() {
    // Resize/scroll observers invalidate the cached rect. Forcing a layout read
    // on every animation frame makes writing stutter.
    this.updateRect()
    // While idle, drop the cached page bitmap as soon as the page content no
    // longer matches what was cached (undo, eraser, layer/edit operations): the
    // next render then draws live data instead of serving stale pixels.
    if (!this.drawing && this.pageCache && this.pageCache.signature !== this.pageSignature(this.page)) {
      trace('cache.drop', 'signature')
      this.pageCache = null
    }
    if (this.eraserActive && this.pageCache) {
      trace('cache.drop', 'eraser')
      this.pageCache = null
    }
    this.resize()
    const { ctx } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    if (this.viewMode === 'separate') {
      this.renderSinglePage()
    } else {
      this.renderContinuous()
    }
  }

  private renderSinglePage() {
    const { ctx } = this
    const page = this.page
    if (!page) return
    ctx.save()
    this.applyPageTransform()

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, page.width, page.height)
    ctx.clip()

    if (!this.tryCachedPage(ctx, page, true)) {
      this.renderBackground(ctx, page)
      if (page.pdf) {
        this.renderPdf(ctx, page.pdf.dataUrl, page.pdf.name, page)
      }
      this.renderPageContent(ctx, page, true)
    }

    ctx.restore()

    ctx.strokeStyle = 'rgba(80,80,120,0.5)'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.strokeRect(0, 0, page.width, page.height)

    ctx.restore()
    ctx.restore()
  }

  private renderPageContent(
    ctx: CanvasRenderingContext2D,
    page: Page,
    drawCurrentStroke: boolean,
  ) {
    for (const layer of page.layers) {
      if (!layer.visible) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      // Draw the layer's elements interleaved by z-order. Consecutive strokes are
      // batched so the erasure-mask pass stays a single scratch-canvas draw.
      const strokeRun: Stroke[] = []
      const flushStrokes = () => {
        if (strokeRun.length === 0) return
        this.renderMaskedStrokes(ctx, page, strokeRun, layer.strokeErasures ?? [])
        strokeRun.length = 0
      }
      for (const item of layerItems(layer)) {
        if (item.kind === 'stroke') {
          strokeRun.push(item.item)
          continue
        }
        flushStrokes()
        if (item.kind === 'image') this.renderImage(ctx, item.item)
        else this.renderText(ctx, item.item)
      }
      flushStrokes()
      ctx.restore()
    }
    if (drawCurrentStroke && this.currentStroke) {
      this.renderStroke(ctx, this.currentStroke)
    }
  }

  /**
   * Cached page bitmap (background + PDF + layers, everything except the stroke
   * being drawn). Serving a blit instead of re-tracing the page is what makes a
   * stroke follow the pen on dense pages and PDF backgrounds.
   *
   * It is used only while a stroke is active. Idle renders use the page model
   * directly so a lower-resolution intermediate bitmap is never shown after
   * the pen is released.
   *
   * Resolution matches the display exactly (zoom × DPR, see `renderScale`), so
   * the blit is 1:1 and nothing looks softer than a full render.
   */
  private getPageCache(page: Page): HTMLCanvasElement | null {
    const exact = this.matchingPageCache(page)
    if (exact) return exact

    const signature = this.pageSignature(page)
    const scale = this.renderScale(page)
    const w = Math.max(1, Math.round(page.width * scale))
    const h = Math.max(1, Math.round(page.height * scale))
    const cached = this.pageCache
    if (!this.pageAssetsReady(page)) return null

    const canvas = cached?.canvas ?? document.createElement('canvas')
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const cctx = canvas.getContext('2d')
    if (!cctx) return null
    const t0 = performance.now()
    cctx.setTransform(1, 0, 0, 1, 0, 0)
    cctx.clearRect(0, 0, w, h)
    cctx.scale(scale, scale)
    this.renderBackground(cctx, page)
    if (page.pdf) this.renderPdf(cctx, page.pdf.dataUrl, page.pdf.name, page)
    this.renderPageContent(cctx, page, false)
    this.pageCache = { page, canvas, scale, signature }
    trace('cache.build', `page=${page.id.slice(0, 6)}`, `scale=${scale.toFixed(2)}`, `${(performance.now() - t0).toFixed(1)}ms`)
    return canvas
  }

  /** The cached bitmap, only if it still matches the page and the current scale. */
  private matchingPageCache(page: Page): HTMLCanvasElement | null {
    const cached = this.pageCache
    if (!cached || cached.page !== page) return null
    if (cached.signature !== this.pageSignature(page)) return null
    const scale = this.renderScale(page)
    if (
      cached.canvas.width !== Math.max(1, Math.round(page.width * scale)) ||
      cached.canvas.height !== Math.max(1, Math.round(page.height * scale))
    ) {
      return null
    }
    return cached.canvas
  }

  /**
   * The cache has to be at least as fine as the screen. A huge page that hits
   * the pixel budget would have to be upscaled (that is what made PDF text look
   * washed out while drawing), so those pages fall back to a sharp full render
   * instead of being served blurry.
   */
  private cacheSharpEnough(page: Page): boolean {
    const required = Math.max(0.25, this.zoom * this.devicePixelRatio)
    return this.renderScale(page) >= required * 0.95
  }

  /**
   * Blits the cached page and, during a stroke, only the live stroke.
   * Idle renders (undo/selection/persist-triggered repaints) always use the page
   * model directly. Building and blitting the cache is reserved for the active
   * stroke preview, where it is needed to keep pointer feedback responsive.
   */
  private tryCachedPage(
    ctx: CanvasRenderingContext2D,
    page: Page,
    drawCurrentStroke: boolean,
  ): boolean {
    const drawingNow = drawCurrentStroke && !!this.currentStroke
    if (!shouldUsePageCache(this.drawing, drawingNow, !!page.pdf)) {
      this.notePath(page.pdf && drawingNow ? 'full(pdf-stroke)' : 'full(idle)')
      return false
    }
    if (!this.cacheSharpEnough(page)) {
      this.notePath('full(too-big)')
      return false
    }
    const cache = this.getPageCache(page)
    if (!cache) {
      this.notePath('full(stroke)')
      return false
    }
    this.notePath('cached(stroke)')
    ctx.drawImage(cache, 0, 0, page.width, page.height)
    if (this.currentStroke) this.renderStroke(ctx, this.currentStroke)
    return true
  }

  /** Log only when the render path changes, so the trace stays readable. */
  private notePath(path: string) {
    if (this.lastPath === path) return
    this.lastPath = path
    trace('render', path)
  }

  /**
   * Folds a just-committed stroke into the cached bitmap, so the render right
   * after releasing the pen is a blit (no full-page repaint). Only valid when
   * the live preview was already painted on top of everything: topmost visible
   * layer at full opacity. Otherwise the cache is dropped and the next render
   * repaints the page correctly.
   */
  commitStrokeToPageCache(page: Page, stroke: Stroke) {
    const cached = this.pageCache
    if (!cached || cached.page !== page) {
      trace('cache.fold(skip)', 'no-cache')
      return
    }
    const visible = page.layers.filter((layer) => layer.visible)
    const top = visible[visible.length - 1]
    const owner = page.layers.find((layer) => layer.strokes.includes(stroke))
    if (!top || owner !== top || top.opacity !== 1) {
      trace('cache.fold(drop)', 'not-top-layer')
      this.pageCache = null
      return
    }
    const cctx = cached.canvas.getContext('2d')
    if (!cctx) {
      this.pageCache = null
      return
    }
    cctx.save()
    // The build left the cache context scaled; `scale()` again would compound
    // it (a 2× cache drew the stroke at 4×). Set the transform explicitly.
    cctx.setTransform(cached.scale, 0, 0, cached.scale, 0, 0)
    this.renderStroke(cctx, stroke)
    cctx.restore()
    cached.signature = this.pageSignature(page)
    trace('cache.fold', `pts=${stroke.points.length}`)
  }

  invalidatePageCache() {
    this.pageCache = null
  }

  /**
   * Scale shared by every page-sized bitmap (background, PDF raster and the page
   * composite). Using the display scale (zoom × DPR) for all of them is what
   * keeps text sharp: a bitmap below it has to be upscaled and looks blurry
   * while drawing. A total-pixel budget bounds memory on very large pages; when
   * it bites, the page cache is simply not used (`tryCachedPage`) instead of
   * being served blurry.
   */
  private renderScale(page: Page): number {
    return pageRenderScale(page.width, page.height, this.zoom, this.devicePixelRatio)
  }

  /**
   * Everything that changes the pixels of a page. Cheap (O(layers)) and used to
   * decide whether the cached bitmap can still be served.
   */
  private pageSignature(page: Page): string {
    let sig = `${page.width}x${page.height}|${page.template}|${page.backgroundColor ?? ''}|${page.rotation}|${page.pdf?.dataUrl.length ?? 0}|${page.updatedAt}`
    for (const layer of page.layers) {
      sig += `|${layer.id}:${layer.visible ? 1 : 0}:${layer.opacity}:${layer.strokes.length}:${layer.images.length}:${layer.texts.length}:${layer.strokeErasures?.length ?? 0}`
    }
    return sig
  }

  /** Never bake a not-yet-loaded PDF/image into the cache. */
  private pageAssetsReady(page: Page): boolean {
    if (page.pdf && !this.isImageReady(page.pdf.dataUrl)) return false
    for (const layer of page.layers) {
      if (!layer.visible) continue
      for (const img of layer.images) if (!this.isImageReady(img.dataUrl)) return false
    }
    return true
  }

  private isImageReady(dataUrl: string): boolean {
    const img = this.imageCache.get(dataUrl) ?? PageCanvas.globalImageCache.get(dataUrl)
    return !!img && img.complete && img.naturalWidth > 0
  }

  private renderMaskedStrokes(
    ctx: CanvasRenderingContext2D,
    page: Page,
    strokes: Stroke[],
    erasures: StrokeErasure[],
  ) {
    if (erasures.length === 0) {
      for (const stroke of strokes) this.renderStroke(ctx, stroke)
      return
    }
    const appliesToStroke = (erasure: StrokeErasure, strokeId: string) =>
      !erasure.strokeIds || erasure.strokeIds.includes(strokeId)
    const hasScopedErasures = erasures.some((erasure) => Array.isArray(erasure.strokeIds))
    if (hasScopedErasures) {
      let index = 0
      while (index < strokes.length) {
        const applicable = erasures.filter((erasure) => appliesToStroke(erasure, strokes[index].id))
        const key = applicable.map((erasure) => erasures.indexOf(erasure)).join(',')
        const group = [strokes[index]]
        index++
        while (index < strokes.length) {
          const nextApplicable = erasures.filter((erasure) => appliesToStroke(erasure, strokes[index].id))
          const nextKey = nextApplicable.map((erasure) => erasures.indexOf(erasure)).join(',')
          if (nextKey !== key) break
          group.push(strokes[index])
          index++
        }
        if (applicable.length === 0) {
          for (const stroke of group) this.renderStroke(ctx, stroke)
        } else {
          this.renderMaskedStrokeGroup(ctx, page, group, applicable)
        }
      }
      return
    }

    const maskCtx = this.getMaskCtx(page.width, page.height)
    if (!maskCtx || !this.scratchCanvas) return

    for (const stroke of strokes) this.renderStroke(maskCtx, stroke)
    maskCtx.save()
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    for (const erasure of erasures) {
      const points = erasure.points
      if (points.length === 0) continue
      maskCtx.lineWidth = erasure.radius * 2
      if (points.length === 1) {
        maskCtx.beginPath()
        maskCtx.arc(points[0].x, points[0].y, erasure.radius, 0, Math.PI * 2)
        maskCtx.fill()
      } else {
        maskCtx.beginPath()
        maskCtx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) maskCtx.lineTo(points[i].x, points[i].y)
        maskCtx.stroke()
      }
    }
    maskCtx.restore()
    ctx.drawImage(this.scratchCanvas, 0, 0, page.width, page.height)
  }

  private renderMaskedStrokeGroup(
    ctx: CanvasRenderingContext2D,
    page: Page,
    strokes: Stroke[],
    erasures: StrokeErasure[],
  ) {
    const maskCtx = this.getMaskCtx(page.width, page.height)
    if (!maskCtx || !this.scratchCanvas) return

    for (const stroke of strokes) this.renderStroke(maskCtx, stroke)
    maskCtx.save()
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    for (const erasure of erasures) {
      const points = erasure.points
      if (points.length === 0) continue
      maskCtx.lineWidth = erasure.radius * 2
      if (points.length === 1) {
        maskCtx.beginPath()
        maskCtx.arc(points[0].x, points[0].y, erasure.radius, 0, Math.PI * 2)
        maskCtx.fill()
      } else {
        maskCtx.beginPath()
        maskCtx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) maskCtx.lineTo(points[i].x, points[i].y)
        maskCtx.stroke()
      }
    }
    maskCtx.restore()
    ctx.drawImage(this.scratchCanvas, 0, 0, page.width, page.height)
  }

  private getMaskCtx(w: number, h: number): CanvasRenderingContext2D | null {
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas')
      this.scratchCtx = this.scratchCanvas.getContext('2d')
    }
    const scale = maskRenderScale(w, h, this.zoom, this.devicePixelRatio)
    const tw = Math.max(1, Math.ceil(w * scale))
    const th = Math.max(1, Math.ceil(h * scale))
    if (this.scratchCanvas.width !== tw || this.scratchCanvas.height !== th) {
      this.scratchCanvas.width = tw
      this.scratchCanvas.height = th
    }
    const sctx = this.scratchCtx
    if (!sctx) return null
    sctx.setTransform(1, 0, 0, 1, 0, 0)
    sctx.clearRect(0, 0, tw, th)
    sctx.scale(scale, scale)
    return sctx
  }


  private renderContinuous() {
    const { ctx } = this
    const rect = this.rect()
    ctx.save()
    ctx.scale(this.devicePixelRatio, this.devicePixelRatio)
    ctx.translate(this.panX, this.panY)
    ctx.scale(this.zoom, this.zoom)

    const viewLeft = -this.panX / this.zoom
    const viewTop = -this.panY / this.zoom
    const viewW = rect.width / this.zoom
    const viewH = rect.height / this.zoom

    for (let i = 0; i < this.pages.length; i++) {
      const page = this.pages[i]
      const off = this.offsets[i] ?? { x: 0, y: 0 }
      const vr = pageVisualRect(page)
      if (
        off.x + vr.x + vr.w < viewLeft ||
        off.x + vr.x > viewLeft + viewW ||
        off.y + vr.y + vr.h < viewTop ||
        off.y + vr.y > viewTop + viewH
      ) {
        continue
      }

      ctx.save()
      ctx.translate(off.x, off.y)
      const rot = ((page.rotation % 360) + 360) % 360
      if (rot !== 0) {
        ctx.translate(page.width / 2, page.height / 2)
        ctx.rotate((rot * Math.PI) / 180)
        ctx.translate(-page.width / 2, -page.height / 2)
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, page.width, page.height)
      ctx.clip()

      if (!this.tryCachedPage(ctx, page, i === this.currentPageIndex)) {
        this.renderBackground(ctx, page)
        if (page.pdf) {
          this.renderPdf(ctx, page.pdf.dataUrl, page.pdf.name, page)
        }
        this.renderPageContent(ctx, page, i === this.currentPageIndex)
      }
      ctx.restore()

      ctx.strokeStyle = 'rgba(80,80,120,0.5)'
      ctx.lineWidth = 1.5 / this.zoom
      ctx.strokeRect(0, 0, page.width, page.height)
      ctx.restore()
    }

    ctx.restore()
    void viewLeft
    void viewTop
  }

  applyPageTransform() {
    const { ctx } = this
    ctx.save()
    ctx.scale(this.devicePixelRatio, this.devicePixelRatio)
    ctx.translate(this.panX, this.panY)
    ctx.scale(this.zoom, this.zoom)
    const off = this.currentOffset
    ctx.translate(off.x, off.y)
    const page = this.page
    const rot = ((page.rotation % 360) + 360) % 360
    if (rot !== 0) {
      ctx.translate(page.width / 2, page.height / 2)
      ctx.rotate((rot * Math.PI) / 180)
      ctx.translate(-page.width / 2, -page.height / 2)
    }
  }

  renderBackground(ctx: CanvasRenderingContext2D, page: Page = this.page) {
    ctx.save()
    ctx.drawImage(this.getBackgroundCanvas(page), 0, 0, page.width, page.height)
    ctx.restore()
  }

  /**
   * Template + background color are static per page, but the dot template draws
   * ~800-1.200 arcs. Rasterize them once into an offscreen canvas and blit it
   * every frame instead of re-creating thousands of paths. A tiny LRU map keeps
   * mixed templates in continuous mode from thrashing the cache.
   */
  private getBackgroundCanvas(page: Page): HTMLCanvasElement {
    const needed = this.renderScale(page)
    const key = `${page.width}x${page.height}|${page.template}|${page.backgroundColor ?? ''}`
    const cached = this.bgCache.get(key)
    if (cached && cached.scale >= needed * 0.98) return cached.canvas

    const resolution = needed
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(page.width * resolution))
    canvas.height = Math.max(1, Math.round(page.height * resolution))
    const bctx = canvas.getContext('2d')
    if (bctx) {
      bctx.scale(resolution, resolution)
      drawTemplate(bctx, page, 1)
    }
    this.bgCache.set(key, { canvas, scale: resolution })
    if (this.bgCache.size > 4) {
      const oldest = this.bgCache.keys().next().value
      if (oldest !== undefined) this.bgCache.delete(oldest)
    }
    return canvas
  }

  private getImage(dataUrl: string): HTMLImageElement | null {
    // Check local instance cache first (prioritize recently used in this session)
    const cached = this.imageCache.get(dataUrl)
    if (cached && cached.complete && cached.naturalWidth > 0) {
      return cached
    }

    // Check static global cache (allows sharing between PageCanvas instances/notebooks)
    const globalCached = PageCanvas.globalImageCache.get(dataUrl)
    if (globalCached && globalCached.complete && globalCached.naturalWidth > 0) {
      this.imageCache.set(dataUrl, globalCached)
      return globalCached
    }

    // Start loading
    const img = new Image()
    this.imageCache.set(dataUrl, img)
    PageCanvas.globalImageCache.set(dataUrl, img)
    img.onload = () => this.callbacks.onRequestRerender()
    img.src = dataUrl

    // Clean up global cache if it gets too large (simple LRU-ish cleanup)
    if (PageCanvas.globalImageCache.size > 200) {
      const keys = PageCanvas.globalImageCache.keys()
      for (let i = 0; i < 50; i++) {
        const next = keys.next()
        if (next.done) break
        PageCanvas.globalImageCache.delete(next.value)
      }
    }

    return null
  }

  clearImageCache(dataUrl: string) {
    if (dataUrl) {
      this.imageCache.delete(dataUrl)
      PageCanvas.globalImageCache.delete(dataUrl)
    }
  }

  setImageOverride(id: string, dataUrl: string, canvas: HTMLCanvasElement) {
    this.imageOverrides.set(id, { dataUrl, canvas })
  }

  getOverrideCanvas(id: string): HTMLCanvasElement | null {
    return this.imageOverrides.get(id)?.canvas ?? null
  }

  warmImage(id: string, dataUrl: string) {
    const cached = this.imageCache.get(dataUrl)
    if (cached) {
      if (cached.complete && cached.naturalWidth > 0) {
        const ov = this.imageOverrides.get(id)
        if (ov && ov.dataUrl === dataUrl) this.imageOverrides.delete(id)
      }
      return
    }
    const img = new Image()
    this.imageCache.set(dataUrl, img)
    img.onload = () => {
      const ov = this.imageOverrides.get(id)
      if (ov && ov.dataUrl === dataUrl) this.imageOverrides.delete(id)
      this.callbacks.onRequestRerender()
    }
    img.src = dataUrl
  }

  clearImageOverrides() {
    this.imageOverrides.clear()
  }

  renderPdf(ctx: CanvasRenderingContext2D, dataUrl: string, _name: string, pageArg?: Page) {
    const pg = pageArg ?? this.page
    const canvas = this.getPdfCanvas(pg, dataUrl)
    if (!canvas) return
    ctx.save()
    // Pre-rasterized at the device scale: a 1:1 blit, no per-frame resampling.
    // This is what keeps PDF text sharp while drawing (the old code lowered
    // `imageSmoothingQuality` during interaction and blurred the letters).
    ctx.drawImage(canvas, 0, 0, pg.width, pg.height)
    ctx.restore()
  }

  /**
   * PDF pages are large images drawn every frame. Resampling them per frame was
   * both slow and blurry (quality was lowered while drawing). Rasterize once per
   * page/scale into a page-sized bitmap and blit it 1:1 from then on.
   */
  private getPdfCanvas(page: Page, dataUrl: string): HTMLCanvasElement | null {
    const img = this.getImage(dataUrl)
    if (!img) return null
    const needed = this.renderScale(page)
    const key = `${dataUrl.length}|${page.width}x${page.height}|${img.naturalWidth}x${img.naturalHeight}`
    const cached = this.pdfCache.get(key)
    // A larger raster can be downscaled for free (still sharp); only upscaling
    // blurs, so rebuild when the display got finer than the cached bitmap.
    if (cached && cached.scale >= needed * 0.98) return cached.canvas

    const resolution = needed
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(page.width * resolution))
    canvas.height = Math.max(1, Math.round(page.height * resolution))
    const pctx = canvas.getContext('2d')
    if (!pctx) return null
    pctx.scale(resolution, resolution)
    const scale = Math.min(page.width / img.width, page.height / img.height)
    const w = img.width * scale
    const h = img.height * scale
    pctx.imageSmoothingEnabled = true
    pctx.imageSmoothingQuality = 'high'
    // Rounded to avoid blur caused by sub-pixel placement.
    pctx.drawImage(
      img,
      Math.floor((page.width - w) / 2),
      Math.floor((page.height - h) / 2),
      Math.floor(w),
      Math.floor(h),
    )
    this.pdfCache.set(key, { canvas, scale: resolution })
    if (this.pdfCache.size > 3) {
      const oldest = this.pdfCache.keys().next().value
      if (oldest !== undefined) this.pdfCache.delete(oldest)
    }
    return canvas
  }

  renderImage(ctx: CanvasRenderingContext2D, imgEl: ImageElement) {
    // Always high quality: during a stroke images come from the cached page
    // bitmap, so anything drawn here may be baked into it.
    const quality = 'high' as const
    const ov = this.imageOverrides.get(imgEl.id)
    if (ov && ov.dataUrl === imgEl.dataUrl) {
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = quality
      ctx.translate(Math.floor(imgEl.x + imgEl.width / 2), Math.floor(imgEl.y + imgEl.height / 2))
      ctx.rotate((imgEl.rotation * Math.PI) / 180)
      ctx.drawImage(
        ov.canvas,
        Math.floor(-imgEl.width / 2),
        Math.floor(-imgEl.height / 2),
        Math.floor(imgEl.width),
        Math.floor(imgEl.height),
      )
      ctx.restore()
      return
    }
    if (ov) this.imageOverrides.delete(imgEl.id)
    const img = this.getImage(imgEl.dataUrl)
    if (!img) return
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = quality
    ctx.translate(Math.floor(imgEl.x + imgEl.width / 2), Math.floor(imgEl.y + imgEl.height / 2))
    ctx.rotate((imgEl.rotation * Math.PI) / 180)
    ctx.drawImage(
      img,
      Math.floor(-imgEl.width / 2),
      Math.floor(-imgEl.height / 2),
      Math.floor(imgEl.width),
      Math.floor(imgEl.height),
    )
    ctx.restore()
  }

  renderText(ctx: CanvasRenderingContext2D, textEl: TextElement) {
    if (!textEl.text || !textEl.text.trim()) return
    drawTextElement(ctx, textEl)
  }

  textLayout(textEl: TextElement) {
    return measureTextElement(this.ctx, textEl)
  }

  hitTestTexts(
    texts: TextElement[],
    px: number,
    py: number,
  ): TextElement | null {
    for (let i = texts.length - 1; i >= 0; i--) {
      const el = texts[i]
      if (!el.text || !el.text.trim()) continue
      const corners = textElementCorners(el, this.textLayout(el))
      if (pointInPolygon(px, py, corners)) return el
    }
    return null
  }

  drawTextSelection(textEl: TextElement | null, isDraft = false) {
    if (!textEl || !textEl.text) return
    const { ctx } = this
    const layout = this.textLayout(textEl)
    const corners = textElementCorners(textEl, layout)
    this.applyPageTransform()
    ctx.strokeStyle = isDraft ? 'rgba(231,130,60,0.9)' : '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    if (isDraft) {
      ctx.setLineDash([6 / this.zoom, 4 / this.zoom])
    }
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])

    if (!isDraft) {
      for (const c of corners) {
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#4a90e2'
        ctx.lineWidth = 1.5 / this.zoom
        const s = 7 / this.zoom
        ctx.fillRect(c.x - s / 2, c.y - s / 2, s, s)
        ctx.strokeRect(c.x - s / 2, c.y - s / 2, s, s)
      }
    }

    const cx = textEl.x + layout.w / 2
    const cy = textEl.y + layout.h / 2
    const rotP = rotatePoint(
      { x: cx, y: cy - layout.h / 2 - 26 / this.zoom },
      cx,
      cy,
      textEl.rotation,
    )
    ctx.strokeStyle = isDraft ? 'rgba(231,130,60,0.9)' : '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.beginPath()
    ctx.moveTo(cx, cy - layout.h / 2)
    ctx.lineTo(rotP.x, rotP.y)
    ctx.stroke()
    ctx.fillStyle = isDraft ? '#e7823c' : '#4a90e2'
    ctx.beginPath()
    ctx.arc(rotP.x, rotP.y, 6 / this.zoom, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  hitTestTextSelectionHandles(
    textEl: TextElement,
    px: number,
    py: number,
  ): string | null {
    const layout = this.textLayout(textEl)
    const corners = textElementCorners(textEl, layout)
    const radius = 10 / this.zoom
    const types = ['nw', 'ne', 'se', 'sw']
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(corners[i].x - px, corners[i].y - py) <= radius) return types[i]
    }
    if (this.hitTestTextRotateHandle(textEl, px, py)) return 'rotate'
    return null
  }

  hitTestTextRotateHandle(
    textEl: TextElement,
    px: number,
    py: number,
  ): boolean {
    const layout = this.textLayout(textEl)
    const cx = textEl.x + layout.w / 2
    const cy = textEl.y + layout.h / 2
    const rotP = rotatePoint(
      { x: cx, y: cy - layout.h / 2 - 26 / this.zoom },
      cx,
      cy,
      textEl.rotation,
    )
    return Math.hypot(rotP.x - px, rotP.y - py) <= 14 / this.zoom
  }

  textRotateCenter(textEl: TextElement): { x: number; y: number } {
    const layout = this.textLayout(textEl)
    return {
      x: textEl.x + layout.w / 2,
      y: textEl.y + layout.h / 2,
    }
  }

  renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    const pts = stroke.points
    if (pts.length === 0) return
    if (pts.length === 1) {
      ctx.fillStyle = stroke.color
      ctx.beginPath()
      const size = Math.max(0.6, stroke.size * clamp(pts[0].pressure, 0.15, 1))
      ctx.arc(pts[0].x, pts[0].y, size / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    ctx.save()
    if (stroke.geometry) {
      const start = pts[0]
      const end = pts[pts.length - 1]
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size
      ctx.beginPath()
      if (stroke.geometry === 'line' || stroke.geometry === 'arrow') {
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
      } else if (stroke.geometry === 'rectangle') {
        ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y)
      } else if (stroke.geometry === 'ellipse') {
        ctx.ellipse(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          Math.abs(end.x - start.x) / 2,
          Math.abs(end.y - start.y) / 2,
          0,
          0,
          Math.PI * 2,
        )
      } else {
        const left = Math.min(start.x, end.x)
        const right = Math.max(start.x, end.x)
        const top = Math.min(start.y, end.y)
        const bottom = Math.max(start.y, end.y)
        ctx.moveTo((left + right) / 2, top)
        ctx.lineTo(right, bottom)
        ctx.lineTo(left, bottom)
        ctx.closePath()
      }
      ctx.stroke()
      if (stroke.geometry === 'arrow') {
        const angle = Math.atan2(end.y - start.y, end.x - start.x)
        const head = Math.max(8, stroke.size * 4)
        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
        ctx.stroke()
      }
      ctx.restore()
      return
    }
    if (stroke.kind === 'highlighter') {
      ctx.globalAlpha = 0.35
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.size
      this.tracePolyline(ctx, pts)
    } else {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = stroke.color
      tracePressurePolyline(ctx, pts, stroke.size)
    }
    ctx.restore()
  }

  tracePolyline(ctx: CanvasRenderingContext2D, pts: Stroke['points']) {
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const midX = (pts[i].x + pts[i - 1].x) / 2
      const midY = (pts[i].y + pts[i - 1].y) / 2
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, midX, midY)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.stroke()
  }

  pointInStroke(stroke: Stroke, px: number, py: number, hitRadius: number): boolean {
    const pts = stroke.points
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - px
      const dy = pts[i].y - py
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return true
      if (i > 0) {
        const a = pts[i - 1]
        const b = pts[i]
        if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= hitRadius) return true
      }
    }
    return false
  }

  drawSelection(image: ImageElement | null) {
    if (!image) return
    const { ctx } = this
    const rect = this.canvas.getBoundingClientRect()
    ctx.save()
    ctx.scale(this.devicePixelRatio, this.devicePixelRatio)
    ctx.translate(this.panX, this.panY)
    ctx.scale(this.zoom, this.zoom)
    const off = this.currentOffset
    ctx.translate(off.x, off.y)

    const corners = rotatedCorners(image)
    ctx.save()
    ctx.strokeStyle = '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom])
    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])

    const cx = image.x + image.width / 2
    const cy = image.y + image.height / 2
    const hw = image.width / 2
    const hh = image.height / 2

    const handlePoints: { x: number; y: number; type: string }[] = [
      { x: cx - hw, y: cy - hh, type: 'nw' },
      { x: cx + hw, y: cy - hh, type: 'ne' },
      { x: cx - hw, y: cy + hh, type: 'sw' },
      { x: cx + hw, y: cy + hh, type: 'se' },
    ]
    for (const h of handlePoints) {
      const p = rotatePoint(h, cx, cy, image.rotation)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4a90e2'
      ctx.lineWidth = 1.5 / this.zoom
      const s = 7 / this.zoom
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s)
    }

    const edgePoints: { x: number; y: number; type: string }[] = [
      { x: cx, y: cy - hh, type: 'n' },
      { x: cx, y: cy + hh, type: 's' },
      { x: cx - hw, y: cy, type: 'w' },
      { x: cx + hw, y: cy, type: 'e' },
    ]
    for (const h of edgePoints) {
      const p = rotatePoint(h, cx, cy, image.rotation)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4a90e2'
      ctx.lineWidth = 1.5 / this.zoom
      const s = 5.5 / this.zoom
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
      ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s)
    }

    const rotateDist = 22 / this.zoom
    const rotateRad = 5.5 / this.zoom
    for (const h of handlePoints) {
      const corner = rotatePoint(h, cx, cy, image.rotation)
      const out = rotatePoint({ x: h.x, y: h.y }, cx, cy, image.rotation)
      const dx = corner.x - cx
      const dy = corner.y - cy
      const len = Math.hypot(dx, dy) || 1
      const rp = {
        x: out.x + (dx / len) * rotateDist,
        y: out.y + (dy / len) * rotateDist,
      }
      ctx.fillStyle = '#4a90e2'
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, rotateRad, 0, Math.PI * 2)
      ctx.fill()
    }

    const rotP = rotatePoint({ x: cx, y: cy - hh - 26 / this.zoom }, cx, cy, image.rotation)
    ctx.strokeStyle = '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.beginPath()
    ctx.moveTo(cx, cy - hh)
    ctx.lineTo(rotP.x, rotP.y)
    ctx.stroke()
    ctx.fillStyle = '#4a90e2'
    ctx.beginPath()
    ctx.arc(rotP.x, rotP.y, 6 / this.zoom, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
    ctx.restore()
    void rect
  }

  selectionBounds(sel: {
    strokes: Set<string>
    images: Set<string>
    texts: Set<string>
  }): Rect | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const layer of this.page.layers) {
      for (const s of layer.strokes) {
        if (!sel.strokes.has(s.id)) continue
        const b = strokeBounds(s)
        if (!b) continue
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.w)
        maxY = Math.max(maxY, b.y + b.h)
      }
      for (const img of layer.images) {
        if (!sel.images.has(img.id)) continue
        for (const c of rotatedCorners(img)) {
          minX = Math.min(minX, c.x)
          minY = Math.min(minY, c.y)
          maxX = Math.max(maxX, c.x)
          maxY = Math.max(maxY, c.y)
        }
      }
      for (const t of layer.texts) {
        if (!sel.texts.has(t.id)) continue
        if (!t.text || !t.text.trim()) continue
        for (const c of textElementCorners(t, this.textLayout(t))) {
          minX = Math.min(minX, c.x)
          minY = Math.min(minY, c.y)
          maxX = Math.max(maxX, c.x)
          maxY = Math.max(maxY, c.y)
        }
      }
    }
    if (!Number.isFinite(minX)) return null
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  drawSelectionTransform(box: Rect) {
    const { ctx } = this
    this.applyPageTransform()
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2

    ctx.strokeStyle = '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom])
    ctx.strokeRect(box.x, box.y, box.w, box.h)
    ctx.setLineDash([])

    const cornerPoints = [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ]
    for (const h of cornerPoints) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4a90e2'
      ctx.lineWidth = 1.5 / this.zoom
      const s = 7 / this.zoom
      ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s)
      ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s)
    }

    const edgePoints = [
      { x: cx, y: box.y },
      { x: cx, y: box.y + box.h },
      { x: box.x, y: cy },
      { x: box.x + box.w, y: cy },
    ]
    for (const h of edgePoints) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4a90e2'
      ctx.lineWidth = 1.5 / this.zoom
      const s = 5.5 / this.zoom
      ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s)
      ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s)
    }

    const rotateDist = 22 / this.zoom
    const rotateRad = 5.5 / this.zoom
    for (const h of cornerPoints) {
      const dx = h.x - cx
      const dy = h.y - cy
      const len = Math.hypot(dx, dy) || 1
      const rp = {
        x: h.x + (dx / len) * rotateDist,
        y: h.y + (dy / len) * rotateDist,
      }
      ctx.fillStyle = '#4a90e2'
      ctx.beginPath()
      ctx.arc(rp.x, rp.y, rotateRad, 0, Math.PI * 2)
      ctx.fill()
    }

    const rotP = { x: cx, y: box.y - 26 / this.zoom }
    ctx.strokeStyle = '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.beginPath()
    ctx.moveTo(cx, box.y)
    ctx.lineTo(rotP.x, rotP.y)
    ctx.stroke()
    ctx.fillStyle = '#4a90e2'
    ctx.beginPath()
    ctx.arc(rotP.x, rotP.y, 6 / this.zoom, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
  }

  hitTestSelectionTransform(box: Rect, px: number, py: number): string | null {
    const radius = 10 / this.zoom
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    const cornerTypes: { x: number; y: number; type: string }[] = [
      { x: box.x, y: box.y, type: 'nw' },
      { x: box.x + box.w, y: box.y, type: 'ne' },
      { x: box.x, y: box.y + box.h, type: 'sw' },
      { x: box.x + box.w, y: box.y + box.h, type: 'se' },
    ]
    const edgeTypes: { x: number; y: number; type: string }[] = [
      { x: cx, y: box.y, type: 'n' },
      { x: cx, y: box.y + box.h, type: 's' },
      { x: box.x, y: cy, type: 'w' },
      { x: box.x + box.w, y: cy, type: 'e' },
    ]
    const rotateDist = 22 / this.zoom
    for (const h of cornerTypes) {
      const dx = h.x - cx
      const dy = h.y - cy
      const len = Math.hypot(dx, dy) || 1
      const rp = {
        x: h.x + (dx / len) * rotateDist,
        y: h.y + (dy / len) * rotateDist,
      }
      if (Math.hypot(rp.x - px, rp.y - py) <= radius) return 'rotate'
    }
    for (const h of cornerTypes) {
      if (Math.hypot(h.x - px, h.y - py) <= radius) return h.type
    }
    for (const h of edgeTypes) {
      if (Math.hypot(h.x - px, h.y - py) <= radius) return h.type
    }
    const rotP = { x: cx, y: box.y - 26 / this.zoom }
    if (Math.hypot(rotP.x - px, rotP.y - py) <= radius) return 'rotate'
    return null
  }

  drawSelectionRegion(region: SelectionRegion | null) {
    if (!region || region.points.length === 0) return
    const { ctx } = this
    this.applyPageTransform()
    ctx.strokeStyle = '#4a90e2'
    ctx.lineWidth = 1.5 / this.zoom
    ctx.setLineDash([6 / this.zoom, 4 / this.zoom])
    ctx.fillStyle = 'rgba(74,144,226,0.12)'

    if (region.type === 'rect' && region.points.length >= 2) {
      const a = region.points[0]
      const b = region.points[1]
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      const w = Math.abs(b.x - a.x)
      const h = Math.abs(b.y - a.y)
      ctx.fillRect(x, y, w, h)
      ctx.strokeRect(x, y, w, h)
    } else if (region.type === 'circle' && region.points.length >= 2) {
      const a = region.points[0]
      const b = region.points[1]
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const r = Math.hypot(b.x - a.x, b.y - a.y) / 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else if (region.type === 'free' && region.points.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(region.points[0].x, region.points[0].y)
      for (let i = 1; i < region.points.length; i++) {
        ctx.lineTo(region.points[i].x, region.points[i].y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }

  drawStrokeBoxes(strokeIds: Set<string>) {
    if (!strokeIds || strokeIds.size === 0) return
    const { ctx } = this
    this.applyPageTransform()
    ctx.strokeStyle = 'rgba(74,144,226,0.85)'
    ctx.lineWidth = 1.2 / this.zoom
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom])
    for (const layer of this.page.layers) {
      for (const stroke of layer.strokes) {
        if (!strokeIds.has(stroke.id)) continue
        const bbox = strokeBounds(stroke)
        if (!bbox) continue
        const pad = 6 / this.zoom
        ctx.strokeRect(bbox.x - pad, bbox.y - pad, bbox.w + pad * 2, bbox.h + pad * 2)
      }
    }
    ctx.restore()
  }

  drawImageBoxes(imageIds: Set<string>) {
    if (!imageIds || imageIds.size === 0) return
    const { ctx } = this
    this.applyPageTransform()
    ctx.strokeStyle = 'rgba(74,144,226,0.85)'
    ctx.lineWidth = 1.2 / this.zoom
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom])
    for (const layer of this.page.layers) {
      for (const img of layer.images) {
        if (!imageIds.has(img.id)) continue
        const corners = rotatedCorners(img)
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
        ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  drawTextBoxes(textIds: Set<string>) {
    if (!textIds || textIds.size === 0) return
    const { ctx } = this
    this.applyPageTransform()
    ctx.strokeStyle = 'rgba(74,144,226,0.85)'
    ctx.lineWidth = 1.2 / this.zoom
    ctx.setLineDash([4 / this.zoom, 3 / this.zoom])
    for (const layer of this.page.layers) {
      for (const t of layer.texts) {
        if (!textIds.has(t.id)) continue
        if (!t.text || !t.text.trim()) continue
        const corners = textElementCorners(t, this.textLayout(t))
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y)
        ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  hitTestImages(
    images: ImageElement[],
    px: number,
    py: number,
  ): ImageElement | null {
    for (let i = images.length - 1; i >= 0; i--) {
      const img = images[i]
      const corners = rotatedCorners(img)
      if (pointInPolygon(px, py, corners)) return img
    }
    return null
  }

  hitTestImageHandles(
    image: ImageElement,
    px: number,
    py: number,
  ): 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'rotate' | null {
    const cx = image.x + image.width / 2
    const cy = image.y + image.height / 2
    const hw = image.width / 2
    const hh = image.height / 2
    const radius = 12 / this.zoom
    const cornerTypes: { x: number; y: number; type: 'nw' | 'ne' | 'sw' | 'se' }[] = [
      { x: cx - hw, y: cy - hh, type: 'nw' },
      { x: cx + hw, y: cy - hh, type: 'ne' },
      { x: cx - hw, y: cy + hh, type: 'sw' },
      { x: cx + hw, y: cy + hh, type: 'se' },
    ]
    const edgeTypes: { x: number; y: number; type: 'n' | 's' | 'e' | 'w' }[] = [
      { x: cx, y: cy - hh, type: 'n' },
      { x: cx, y: cy + hh, type: 's' },
      { x: cx - hw, y: cy, type: 'w' },
      { x: cx + hw, y: cy, type: 'e' },
    ]

    for (const h of cornerTypes) {
      const p = rotatePoint({ x: h.x, y: h.y }, cx, cy, image.rotation)
      const d = Math.hypot(p.x - px, p.y - py)
      if (d > 10 / this.zoom) {
        const dx = h.x - cx
        const dy = h.y - cy
        const len = Math.hypot(dx, dy) || 1
        const out = rotatePoint(
          { x: h.x + (dx / len) * (22 / this.zoom), y: h.y + (dy / len) * (22 / this.zoom) },
          cx,
          cy,
          image.rotation,
        )
        if (Math.hypot(out.x - px, out.y - py) <= radius) return 'rotate'
      }
    }
    for (const h of cornerTypes) {
      const p = rotatePoint({ x: h.x, y: h.y }, cx, cy, image.rotation)
      if (Math.hypot(p.x - px, p.y - py) <= radius) return h.type
    }
    for (const h of edgeTypes) {
      const p = rotatePoint({ x: h.x, y: h.y }, cx, cy, image.rotation)
      if (Math.hypot(p.x - px, p.y - py) <= radius) return h.type
    }
    const rotP = rotatePoint({ x: cx, y: cy - hh - 26 / this.zoom }, cx, cy, image.rotation)
    if (Math.hypot(rotP.x - px, rotP.y - py) <= 12 / this.zoom) return 'rotate'
    return null
  }
}

function rotatedCorners(img: ImageElement): { x: number; y: number }[] {
  const cx = img.x + img.width / 2
  const cy = img.y + img.height / 2
  const hw = img.width / 2
  const hh = img.height / 2
  return [
    rotatePoint({ x: cx - hw, y: cy - hh }, cx, cy, img.rotation),
    rotatePoint({ x: cx + hw, y: cy - hh }, cx, cy, img.rotation),
    rotatePoint({ x: cx + hw, y: cy + hh }, cx, cy, img.rotation),
    rotatePoint({ x: cx - hw, y: cy + hh }, cx, cy, img.rotation),
  ]
}

function rotatePoint(
  p: { x: number; y: number },
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - cx
  const dy = p.y - cy
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }
}

function pointInPolygon(
  px: number,
  py: number,
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = clamp(t, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function strokeBounds(stroke: Stroke): { x: number; y: number; w: number; h: number } | null {
  const pts = stroke.points
  if (pts.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const r = stroke.size / 2
  return { x: minX - r, y: minY - r, w: maxX - minX + r * 2, h: maxY - minY + r * 2 }
}
