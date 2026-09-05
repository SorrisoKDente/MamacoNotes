import type { Page, Stroke, ToolKind, ImageElement, TextElement, PageViewMode, Rect, StrokeErasure } from '../types'
import { newId } from '../types'
import { drawTextElement, measureTextElement, textElementCorners } from '../utils/drawText'
import { pageVisualRect, type PageOffset } from '../utils/layout'

export interface RendererCallbacks {
  onStrokeEnd: (stroke: Stroke) => void
  onRequestRerender: () => void
}

export interface CanvasProps {
  canvas: HTMLCanvasElement
  page: Page
  zoom: number
  panX: number
  panY: number
  callbacks: RendererCallbacks
}

const RULED_SPACING = 42
const GRID_SIZE = 34
const MARGIN = 60
const LINE_COLOR = '#c9d4e0'
const MARGIN_COLOR = '#e88a8a'

export interface SelectionRegion {
  type: 'rect' | 'circle' | 'free'
  points: { x: number; y: number }[]
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

  eraserActive = false
  eraserPoint: { x: number; y: number } | null = null

  pages: Page[] = []
  offsets: PageOffset[] = []
  viewMode: PageViewMode = 'separate'
  currentPageIndex = 0

  private imageCache = new Map<string, HTMLImageElement>()
  private static globalImageCache = new Map<string, HTMLImageElement>()
  private imageOverrides = new Map<string, { dataUrl: string; canvas: HTMLCanvasElement }>()

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

  toPageCoords(px: number, py: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
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
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (px - rect.left - this.panX) / this.zoom,
      y: (py - rect.top - this.panY) / this.zoom,
    }
  }

  toPageCoordsAt(px: number, py: number, pageIndex: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
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
    const rect = this.canvas.getBoundingClientRect()
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

  beginStroke(tool: ToolKind, color: string, size: number, px: number, py: number) {
    const p = this.toPageCoords(px, py)
    this.drawing = true
    this.currentStroke = {
      id: newId(),
      kind: tool,
      color,
      size,
      points: [{ x: p.x, y: p.y, pressure: 1 }],
    }
    this.lastPoint = p
  }

  extendStroke(px: number, py: number, pressure = 1) {
    if (!this.drawing || !this.currentStroke) return
    const p = this.toPageCoords(px, py)
    const last = this.currentStroke.points[this.currentStroke.points.length - 1]
    const dx = p.x - last.x
    const dy = p.y - last.y
    if (dx * dx + dy * dy < 0.4) return
    this.currentStroke.points.push({ x: p.x, y: p.y, pressure })
    this.lastPoint = p
    this.callbacks.onRequestRerender()
  }

  endStroke(): Stroke | null {
    if (!this.drawing || !this.currentStroke) return null
    const stroke = this.currentStroke
    this.drawing = false
    this.currentStroke = null
    this.lastPoint = null
    if (stroke.points.length < 2) return stroke
    return stroke
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
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

    this.renderBackground(ctx, page)
    if (page.pdf) {
      this.renderPdf(ctx, page.pdf.dataUrl, page.pdf.name, page)
    }
    this.renderPageContent(ctx, page, true)

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
      for (const img of layer.images) {
        this.renderImage(ctx, img)
      }
      for (const textEl of layer.texts) {
        this.renderText(ctx, textEl)
      }
      this.renderMaskedStrokes(ctx, page, layer.strokes, layer.strokeErasures ?? [])
      ctx.restore()
    }
    if (drawCurrentStroke && this.currentStroke) {
      this.renderStroke(ctx, this.currentStroke)
    }
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

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = Math.max(1, Math.ceil(page.width * this.devicePixelRatio))
    maskCanvas.height = Math.max(1, Math.ceil(page.height * this.devicePixelRatio))
    const maskCtx = maskCanvas.getContext('2d')!
    maskCtx.scale(this.devicePixelRatio, this.devicePixelRatio)
    for (const stroke of strokes) this.renderStroke(maskCtx, stroke)
    maskCtx.save()
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    for (const erasure of erasures) {
      const points = erasure.points
      if (points.length === 0) continue
      maskCtx.lineWidth = erasure.radius * 2
      maskCtx.beginPath()
      maskCtx.moveTo(points[0].x, points[0].y)
      if (points.length === 1) {
        maskCtx.arc(points[0].x, points[0].y, erasure.radius, 0, Math.PI * 2)
      } else {
        for (let i = 1; i < points.length; i++) maskCtx.lineTo(points[i].x, points[i].y)
      }
      maskCtx.stroke()
    }
    maskCtx.restore()
    ctx.drawImage(maskCanvas, 0, 0, page.width, page.height)
  }

  private renderMaskedStrokeGroup(
    ctx: CanvasRenderingContext2D,
    page: Page,
    strokes: Stroke[],
    erasures: StrokeErasure[],
  ) {
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = Math.max(1, Math.ceil(page.width * this.devicePixelRatio))
    maskCanvas.height = Math.max(1, Math.ceil(page.height * this.devicePixelRatio))
    const maskCtx = maskCanvas.getContext('2d')!
    maskCtx.scale(this.devicePixelRatio, this.devicePixelRatio)
    for (const stroke of strokes) this.renderStroke(maskCtx, stroke)
    maskCtx.save()
    maskCtx.globalCompositeOperation = 'destination-out'
    maskCtx.lineCap = 'round'
    maskCtx.lineJoin = 'round'
    for (const erasure of erasures) {
      const points = erasure.points
      if (points.length === 0) continue
      maskCtx.lineWidth = erasure.radius * 2
      maskCtx.beginPath()
      maskCtx.moveTo(points[0].x, points[0].y)
      if (points.length === 1) maskCtx.arc(points[0].x, points[0].y, erasure.radius, 0, Math.PI * 2)
      else for (let i = 1; i < points.length; i++) maskCtx.lineTo(points[i].x, points[i].y)
      maskCtx.stroke()
    }
    maskCtx.restore()
    ctx.drawImage(maskCanvas, 0, 0, page.width, page.height)
  }


  private renderContinuous() {
    const { ctx } = this
    const rect = this.canvas.getBoundingClientRect()
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

      this.renderBackground(ctx, page)
      if (page.pdf) {
        this.renderPdf(ctx, page.pdf.dataUrl, page.pdf.name, page)
      }
      this.renderPageContent(ctx, page, i === this.currentPageIndex)
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
    const pad = 4
    ctx.save()
    ctx.fillStyle = page.backgroundColor || '#ffffff'
    ctx.fillRect(0, 0, page.width, page.height)

    if (page.template === 'ruled') {
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let y = MARGIN; y <= page.height - pad; y += RULED_SPACING) {
        ctx.moveTo(pad, y)
        ctx.lineTo(page.width - pad, y)
      }
      ctx.stroke()
      ctx.strokeStyle = MARGIN_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(MARGIN, 0)
      ctx.lineTo(MARGIN, page.height)
      ctx.stroke()
    } else if (page.template === 'grid') {
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = pad; x <= page.width - pad; x += GRID_SIZE) {
        ctx.moveTo(x, 0)
        ctx.lineTo(x, page.height)
      }
      for (let y = pad; y <= page.height - pad; y += GRID_SIZE) {
        ctx.moveTo(0, y)
        ctx.lineTo(page.width, y)
      }
      ctx.stroke()
    } else if (page.template === 'dot') {
      ctx.fillStyle = LINE_COLOR
      for (let x = GRID_SIZE / 2; x < page.width; x += GRID_SIZE) {
        for (let y = GRID_SIZE / 2; y < page.height; y += GRID_SIZE) {
          ctx.beginPath()
          ctx.arc(x, y, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.restore()
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
    const img = this.getImage(dataUrl)
    if (!img) return
    const pg = pageArg ?? this.page
    const scale = Math.min(pg.width / img.width, pg.height / img.height)
    const w = img.width * scale
    const h = img.height * scale
    ctx.save()

    // Performance optimization: use low quality smoothing during active drawing/panning
    // to keep frame rate high on Windows/Low-end devices with many PDF pages.
    const isInteracting = this.drawing || this.eraserActive
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = isInteracting ? 'low' : 'high'

    // Arredondamos para evitar borrões causados por sub-pixel rendering
    ctx.drawImage(
      img,
      Math.floor((pg.width - w) / 2),
      Math.floor((pg.height - h) / 2),
      Math.floor(w),
      Math.floor(h),
    )
    ctx.restore()
  }

  renderImage(ctx: CanvasRenderingContext2D, imgEl: ImageElement) {
    const ov = this.imageOverrides.get(imgEl.id)
    if (ov && ov.dataUrl === imgEl.dataUrl) {
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
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
    ctx.imageSmoothingQuality = 'high'
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
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }

    ctx.save()
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
      this.tracePressurePolyline(ctx, pts, stroke.size)
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

  tracePressurePolyline(ctx: CanvasRenderingContext2D, pts: Stroke['points'], baseSize: number) {
    let lastSize = -1
    let started = false

    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i]
      const size = Math.max(0.6, baseSize * clamp(p1.pressure, 0.15, 1))

      if (Math.abs(size - lastSize) > 0.01 || !started) {
        if (started) ctx.stroke()
        ctx.lineWidth = size
        ctx.beginPath()
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
        started = true
        lastSize = size
      }
      ctx.lineTo(p1.x, p1.y)
    }
    if (started) ctx.stroke()
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

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
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
