import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, clonePage } from '../store'
import { useTextStore } from '../textStore'
import { PageCanvas, strokeBounds, type SelectionRegion } from '../renderer/canvas'
import type { ImageElement, Page, Rect, Stroke, StrokePoint, TextElement, ToolKind } from '../types'
import { getActiveLayer, makeTextElement, newId } from '../types'
import { ImageEraseSession } from '../utils/imageErase'
import { computePageOffsets, pageUnderPoint, pageVisualBox, pageVisualRect } from '../utils/layout'
import type { PageOffset } from '../utils/layout'
import { measureTextElement, textElementCorners, type TextLayout } from '../utils/drawText'
import { useI18n } from '../i18n'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const TWO_FINGER_THRESHOLD = 14
const TWO_FINGER_TAP_MAX_MS = 300
const TWO_FINGER_DOUBLE_TAP_GAP_MS = 400

interface Pt {
  x: number
  y: number
}

function angleBetween(a: Pt, b: Pt): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

function rotationPair(pts: Pt[]): [Pt, Pt] {
  if (pts.length < 2) return [pts[0] ?? { x: 0, y: 0 }, pts[0] ?? { x: 0, y: 0 }]
  if (pts.length === 2) return [pts[0], pts[1]]
  let bestA = pts[0]
  let bestB = pts[1]
  let bestD = -1
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2
      if (d > bestD) {
        bestD = d
        bestA = pts[i]
        bestB = pts[j]
      }
    }
  }
  return [bestA, bestB]
}

interface SelectionState {
  strokes: Set<string>
  images: Set<string>
  texts: Set<string>
}

export function Editor() {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<PageCanvas | null>(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const mousePosRef = useRef<Pt>({ x: -1, y: -1 })
  const activePointersRef = useRef<Map<number, Pt>>(new Map())
  const pointerDownPosRef = useRef<Map<number, Pt>>(new Map())
  const pinchRef = useRef<{ prevDist: number; prevMid: Pt } | null>(null)
  const pendingTwoFingerRef = useRef<{ id: number; start: Pt } | null>(null)
  const twoFingerDownAtRef = useRef<number | null>(null)
  const lastTwoFingerTapAtRef = useRef(0)
  const threeFingerDownAtRef = useRef<number | null>(null)
  const lastThreeFingerTapAtRef = useRef(0)
  const pinchRotationUndoPushedRef = useRef(false)
  const pageRotateUndoPushedRef = useRef(false)
  const dragOwnerIdRef = useRef<number | null>(null)
  const dragInterruptedByTouchRef = useRef(false)
  const multiTouchDownAtRef = useRef(0)

  const notebook = useAppStore((s) =>
    s.notebooks.find((n) => n.id === s.selectedNotebookId),
  )
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const tool = useAppStore((s) => s.tool)
  const setTool = useAppStore((s) => s.setTool)
  const settings = useAppStore((s) => s.settings)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const persistNotebook = useAppStore((s) => s.persistNotebook)
  const storePushUndo = useAppStore((s) => s.pushUndo)

  const [zoomDisplay, setZoomDisplay] = useState(1)
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 })

  const [inlineText, setInlineText] = useState<{
    pageX: number
    pageY: number
    value: string
    targetId: string | null
  } | null>(null)
  const inlineTextRef = useRef(inlineText)
  inlineTextRef.current = inlineText

  const page = notebook?.pages[currentPageIndex]

  const pageRef = useRef<Page | undefined>(undefined)
  pageRef.current = page
  const notebookRef = useRef(notebook)
  notebookRef.current = notebook

  const viewMode = settings.pageViewMode
  const offsets = useMemo<PageOffset[]>(
    () => computePageOffsets(notebook?.pages ?? [], viewMode),
    [notebook, viewMode, dataVersion],
  )

  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets
  const pagesRef = useRef<Page[]>(notebook?.pages ?? [])
  pagesRef.current = notebook?.pages ?? []
  const currentPageIndexRef = useRef(currentPageIndex)
  currentPageIndexRef.current = currentPageIndex

  const followTimerRef = useRef<number | null>(null)
  const resizeTimerRef = useRef<number | null>(null)
  const autoFollowRef = useRef(false)
  const suppressPageFocusRef = useRef(false)
  const prevPageIndexRef = useRef(currentPageIndex)
  const lastInteractionPanRef = useRef({ x: 0, y: 0 })
  const prevActiveLayerIdRef = useRef<string | null>(null)

  const selectionRef = useRef<SelectionState>({ strokes: new Set(), images: new Set(), texts: new Set() })
  const selectionRegionRef = useRef<SelectionRegion | null>(null)
  const clipboardRef = useRef<{ strokes: Stroke[]; images: ImageElement[]; texts: TextElement[] } | null>(null)
  const selectionDragRef = useRef<{
    kind: 'region-move'
    startX: number
    startY: number
    startPagePt: Pt
    snapshotStrokes: Stroke[]
    snapshotImages: ImageElement[]
    snapshotTexts: TextElement[]
  } | null>(null)

  const draftRef = useRef<TextElement | null>(null)
  const persistTimerRef = useRef<number | null>(null)

  const toolRef = useRef<ToolKind>(tool)
  toolRef.current = tool
  const selectedImageIdRef = useRef<string | null>(null)
  selectedImageIdRef.current = selectedImageId

  const lastSelectModeRef = useRef(settings.lastSelectMode)
  lastSelectModeRef.current = settings.lastSelectMode

  const ctrlSelectRef = useRef(false)
  const cropVersionRef = useRef(0)
  const delimitedSnapshotRef = useRef<Page | null>(null)
  const pushUndo = () => {
    delimitedSnapshotRef.current = null
    storePushUndo()
  }
  const eraseSessionRef = useRef<ImageEraseSession | null>(null)
  const erasePendingRef = useRef<{ from: Pt; to: Pt | null; scheduled: boolean }>({
    from: { x: 0, y: 0 },
    to: null,
    scheduled: false,
  })
  const lastClickRef = useRef<{ x: number; y: number; time: number; type: string; id: string } | null>(null)
  const pressedKeysRef = useRef<Set<string>>(new Set())

  const dirtyRef = useRef(false)

  const dragRef = useRef<{
    kind: 'pan' | 'draw' | 'erase' | 'select-move' | 'select-resize' | 'select-rotate' | 'region-draw' | 'region-move' | 'text-rotate' | 'text-resize' | 'page-rotate' | 'group-resize' | 'group-rotate'
    startX: number
    startY: number
    lastX: number
    lastY: number
    imageId: string | null
    handle: string | null
    startPan: { x: number; y: number }
    multiTouch?: boolean
    startImage?: ImageElement
    startRotation?: number
    startPagePt?: Pt
    textTarget?: { type: 'existing'; id: string } | { type: 'draft' }
    lastErasePage?: Pt
    startBox?: Rect
    snapshotStrokes?: Stroke[]
    snapshotImages?: ImageElement[]
    snapshotTexts?: TextElement[]
    startAngle?: number
  } | null>(null)

  function schedulePersist() {
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      const nb = notebookRef.current
      if (nb) void persistNotebook(nb)
    }, 400)
  }

  const requestRender = useCallback(() => {
    const engine = engineRef.current
    const pg = pageRef.current
    if (!engine || !pg) return
    engine.zoom = zoomRef.current
    engine.panX = panRef.current.x
    engine.panY = panRef.current.y
    engine.page = pg
    engine.setDocument(
      pagesRef.current,
      offsetsRef.current,
      viewModeRef.current,
      currentPageIndexRef.current,
    )
    engine.render()
    if (toolRef.current === 'select') {
      const sel = selectionRef.current
      const hasInkOrText = sel.strokes.size > 0 || sel.texts.size > 0
      if (hasInkOrText) {
        const tbox = engine.selectionBounds(sel)
        if (tbox) engine.drawSelectionTransform(tbox)
      } else {
        const selected = getActiveLayer(engine.page).images.find((i) => i.id === selectedImageIdRef.current) ?? null
        const boxImages = new Set(sel.images)
        if (selected) boxImages.delete(selected.id)
        engine.drawSelection(selected)
        engine.drawStrokeBoxes(sel.strokes)
        engine.drawImageBoxes(boxImages)
        engine.drawTextBoxes(sel.texts)
      }
      engine.drawSelectionRegion(selectionRegionRef.current)
    }
    if (toolRef.current === 'text') {
      const ts = useTextStore.getState()
      const pg = pageRef.current
      if (pg) {
        if (ts.selectedTextId) {
          const el = getActiveLayer(pg).texts.find((t) => t.id === ts.selectedTextId)
          if (el) engine.drawTextSelection(el, false)
        } else if (ts.draft.trim()) {
          const st = useAppStore.getState().settings
          let pos = ts.draftPos
          const draft = makeTextElement(ts.draft, pos?.x ?? 0, pos?.y ?? 0, st)
          draft.rotation = ts.draftRotation
          if (!pos) {
            const layout = engine.textLayout(draft)
            draft.x = Math.max(0, (pg.width - layout.w) / 2)
            draft.y = Math.max(0, (pg.height - layout.h) / 2)
          }
          engine.applyPageTransform()
          engine.renderText(engine.ctx, draft)
          engine.ctx.restore()
          engine.drawTextSelection(draft, true)
          draftRef.current = draft
        }
      }
    }
  }, [])

  const requestRenderRef = useRef(requestRender)
  requestRenderRef.current = requestRender

  const notebookIdRef = useRef<string | null>(null)
  const pageIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (tool !== 'select') {
      selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
      selectionRegionRef.current = null
      selectionDragRef.current = null
      setSelectedImageId(null)
    }
    lastClickRef.current = null
    requestRender()
  }, [tool, requestRender])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ink:image-selected', { detail: { id: selectedImageId } }))
  }, [selectedImageId])

  const prevToolRef = useRef<ToolKind>(tool)

  useEffect(() => {
    const prev = prevToolRef.current
    prevToolRef.current = tool
    delimitedSnapshotRef.current = null
    if (prev === 'text' && tool !== 'text') {
      const inline = inlineTextRef.current
      if (inline) {
        const ts = useTextStore.getState()
        if (inline.value.trim() && !inline.targetId) {
          const pg = pageRef.current
          const engine = engineRef.current
          if (pg && engine) {
            ts.setDraft(inline.value)
            ts.setDraftPos({ x: inline.pageX, y: inline.pageY })
            commitDraftAt(inline.pageX, inline.pageY)
          }
        }
        ts.selectText(null)
        ts.setEditingExisting(false)
        ts.setDraft('')
        ts.setDraftRotation(0)
        setInlineText(null)
      }
      const ts = useTextStore.getState()
      if (ts.draft.trim() && !ts.editingExisting) {
        const pg = pageRef.current
        const engine = engineRef.current
        if (pg && engine) {
          const st = useAppStore.getState().settings
          let pos = ts.draftPos
          const draft = makeTextElement(ts.draft, pos?.x ?? 0, pos?.y ?? 0, st)
          draft.rotation = ts.draftRotation
          if (!pos) {
            const layout = engine.textLayout(draft)
            draft.x = Math.max(0, (pg.width - layout.w) / 2)
            draft.y = Math.max(0, (pg.height - layout.h) / 2)
          } else {
            draft.x = clamp(draft.x, 0, Math.max(0, pg.width - 20))
            draft.y = clamp(draft.y, 0, Math.max(0, pg.height - 20))
          }
          pushUndo()
          getActiveLayer(pg).texts.push(draft)
          pg.updatedAt = Date.now()
          notebookRef.current!.updatedAt = Date.now()
          dirtyRef.current = true
          void persistNow()
        }
      }
      useTextStore.getState().reset()
    }
    requestRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!page) {
      engineRef.current = null
      return
    }
    if (!engineRef.current || engineRef.current.canvas !== canvas) {
      engineRef.current = new PageCanvas({
        canvas,
        page,
        zoom: zoomRef.current,
        panX: panRef.current.x,
        panY: panRef.current.y,
        callbacks: {
          onStrokeEnd: () => {},
          onRequestRerender: () => requestRenderRef.current(),
        },
      })
    }
    const engine = engineRef.current
    engine.page = page
    if (notebookIdRef.current !== notebook?.id) {
      notebookIdRef.current = notebook?.id ?? null
      fitPage()
    }
    if (pageIdRef.current !== page.id) {
      pageIdRef.current = page.id
      delimitedSnapshotRef.current = null
      if (!dragRef.current) {
        selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
        selectionRegionRef.current = null
        selectionDragRef.current = null
        setSelectedImageId(null)
        useTextStore.getState().reset()
      }
      engine.clearImageOverrides()
    }
    requestRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, dataVersion, requestRender])

  useEffect(() => {
    const id = page?.activeLayerId ?? null
    if (prevActiveLayerIdRef.current !== null && prevActiveLayerIdRef.current !== id) {
      selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
      selectionRegionRef.current = null
      selectionDragRef.current = null
      setSelectedImageId(null)
      requestRender()
    }
    prevActiveLayerIdRef.current = id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.activeLayerId, requestRender])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pageRef.current) return
    if (viewMode === 'separate') {
      fitPage()
    } else {
      focusSelectedPage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode])

  useEffect(() => {
    return useTextStore.subscribe((state, prev) => {
      if (
        state.draft !== prev.draft ||
        state.draftRotation !== prev.draftRotation ||
        state.selectedTextId !== prev.selectedTextId ||
        state.draftPos !== prev.draftPos
      ) {
        requestRenderRef.current()
      }
    })
  }, [])

  useEffect(() => {
    const prev = prevPageIndexRef.current
    prevPageIndexRef.current = currentPageIndex
    if (prev === currentPageIndex) return
    if (suppressPageFocusRef.current) {
      suppressPageFocusRef.current = false
      requestRender()
      return
    }
    if (autoFollowRef.current) {
      autoFollowRef.current = false
      requestRender()
      return
    }
    focusSelectedPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex])

  useEffect(() => {
    return () => {
      if (followTimerRef.current) window.clearTimeout(followTimerRef.current)
    }
  }, [])

  function fitPage() {
    const canvas = canvasRef.current
    const pg = pageRef.current
    if (!canvas || !pg) return
    const rect = canvas.getBoundingClientRect()
    const pad = 60
    const vm = viewModeRef.current
    const box = pageVisualBox(pg)
    const vr = pageVisualRect(pg)
    if (vm === 'separate') {
      const z = Math.min(
        (rect.width - pad) / box.w,
        (rect.height - pad) / box.h,
      )
      zoomRef.current = clamp(z, MIN_ZOOM, MAX_ZOOM)
      panRef.current = {
        x: (rect.width - box.w * zoomRef.current) / 2 - vr.x * zoomRef.current,
        y: (rect.height - box.h * zoomRef.current) / 2 - vr.y * zoomRef.current,
      }
    } else {
      const z =
        vm === 'vertical'
          ? (rect.width - pad) / box.w
          : (rect.height - pad) / box.h
      zoomRef.current = clamp(z, MIN_ZOOM, MAX_ZOOM)
      focusPageRect(rect)
    }
    setZoomDisplay(Math.round(zoomRef.current * 100))
    requestRender()
  }

  function focusPageRect(rect: DOMRect) {
    const pg = pageRef.current
    const idx = currentPageIndexRef.current
    const off = offsetsRef.current[idx] ?? { x: 0, y: 0 }
    if (!pg) return
    const vm = viewModeRef.current
    const box = pageVisualBox(pg)
    const vr = pageVisualRect(pg)
    if (vm === 'vertical') {
      panRef.current = {
        x: (rect.width - box.w * zoomRef.current) / 2 - vr.x * zoomRef.current,
        y: 40 - (off.y + vr.y) * zoomRef.current,
      }
    } else {
      panRef.current = {
        x: 40 - (off.x + vr.x) * zoomRef.current,
        y: (rect.height - box.h * zoomRef.current) / 2 - vr.y * zoomRef.current,
      }
    }
  }

  function followViewportPage() {
    const canvas = canvasRef.current
    if (!canvas) return
    const vm = viewModeRef.current
    if (vm === 'separate') return
    const pan = panRef.current
    const lastPan = lastInteractionPanRef.current
    if (
      Math.abs(pan.x - lastPan.x) < 0.5 &&
      Math.abs(pan.y - lastPan.y) < 0.5
    ) {
      return
    }
    const rect = canvas.getBoundingClientRect()
    const docX = (rect.width / 2 - pan.x) / zoomRef.current
    const docY = (rect.height / 2 - pan.y) / zoomRef.current
    const idx = pageUnderPoint(pagesRef.current, offsetsRef.current, docX, docY)
    if (idx !== null && idx !== currentPageIndexRef.current) {
      autoFollowRef.current = true
      useAppStore.getState().selectPage(idx)
    }
  }

  function scheduleFollowPage() {
    if (followTimerRef.current) window.clearTimeout(followTimerRef.current)
    followTimerRef.current = window.setTimeout(() => {
      followTimerRef.current = null
      followViewportPage()
    }, 150)
  }

  function focusSelectedPage() {
    const canvas = canvasRef.current
    if (!canvas) return
    const vm = viewModeRef.current
    if (vm === 'separate') {
      fitPage()
      return
    }
    const rect = canvas.getBoundingClientRect()
    const pg = pageRef.current
    if (!pg) return
    const pad = 60
    const box = pageVisualBox(pg)
    zoomRef.current =
      vm === 'vertical'
        ? clamp((rect.width - pad) / box.w, MIN_ZOOM, MAX_ZOOM)
        : clamp((rect.height - pad) / box.h, MIN_ZOOM, MAX_ZOOM)
    setZoomDisplay(Math.round(zoomRef.current * 100))
    focusPageRect(rect)
    requestRender()
  }

  function recenterPage() {
    fitPage()
  }

  function applyZoomAt(px: number, py: number, factor: number) {
    const engine = engineRef.current
    if (!engine || !page) return
    let z = zoomRef.current * factor
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
    const p = {
      x: (px - panRef.current.x) / zoomRef.current,
      y: (py - panRef.current.y) / zoomRef.current,
    }
    panRef.current = {
      x: px - p.x * z,
      y: py - p.y * z,
    }
    zoomRef.current = z
    setZoomDisplay(Math.round(z * 100))
    requestRender()
  }

  function zoomAt(px: number, py: number, delta: number) {
    applyZoomAt(px, py, delta > 0 ? 1.2 : 1 / 1.2)
  }

  function zoomBy(delta: number) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = mousePosRef.current
    const px = mx.x >= 0 && mx.y >= 0 ? mx.x : rect.width / 2
    const py = mx.y >= 0 ? mx.y : rect.height / 2
    zoomAt(px, py, delta)
  }

  function trackMouse(e: React.MouseEvent | React.PointerEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    mousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function getPointerPos(e: PointerEvent) {
    return { x: e.clientX, y: e.clientY }
  }

  // ---- Selection helpers ----

  function snapshotSelected(): { strokes: Stroke[]; images: ImageElement[]; texts: TextElement[] } {
    const pg = pageRef.current
    if (!pg) return { strokes: [], images: [], texts: [] }
    const sel = selectionRef.current
    const layer = getActiveLayer(pg)
    const strokes = layer.strokes
      .filter((s) => sel.strokes.has(s.id))
      .map((s) => ({ ...s, points: s.points.slice() }))
    const images = layer.images.filter((i) => sel.images.has(i.id)).map((i) => ({ ...i }))
    const texts = layer.texts.filter((t) => sel.texts.has(t.id)).map((t) => ({ ...t }))
    return { strokes, images, texts }
  }

  function hitTestSelectionBounds(p: Pt): boolean {
    const pg = pageRef.current
    if (!pg) return false
    const sel = selectionRef.current
    const layer = getActiveLayer(pg)
    for (const s of layer.strokes) {
      if (!sel.strokes.has(s.id)) continue
      const b = strokeBounds(s)
      if (b && p.x >= b.x - 8 && p.x <= b.x + b.w + 8 && p.y >= b.y - 8 && p.y <= b.y + b.h + 8) return true
    }
    for (const img of layer.images) {
      if (!sel.images.has(img.id)) continue
      const c = imageCorners(img)
      const minX = Math.min(c[0].x, c[1].x, c[2].x, c[3].x) - 8
      const maxX = Math.max(c[0].x, c[1].x, c[2].x, c[3].x) + 8
      const minY = Math.min(c[0].y, c[1].y, c[2].y, c[3].y) - 8
      const maxY = Math.max(c[0].y, c[1].y, c[2].y, c[3].y) + 8
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return true
    }
    for (const t of layer.texts) {
      if (!sel.texts.has(t.id)) continue
      const c = textCorners(t)
      if (c.length < 4) continue
      const minX = Math.min(c[0].x, c[1].x, c[2].x, c[3].x) - 8
      const maxX = Math.max(c[0].x, c[1].x, c[2].x, c[3].x) + 8
      const minY = Math.min(c[0].y, c[1].y, c[2].y, c[3].y) - 8
      const maxY = Math.max(c[0].y, c[1].y, c[2].y, c[3].y) + 8
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) return true
    }
    return false
  }

  function transformHandleAt(p: Pt): { handle: string; box: Rect } | null {
    const engine = engineRef.current
    if (!engine) return null
    const sel = selectionRef.current
    if (sel.strokes.size === 0 && sel.texts.size === 0) return null
    const box = engine.selectionBounds(sel)
    if (!box) return null
    const handle = engine.hitTestSelectionTransform(box, p.x, p.y)
    if (!handle) return null
    return { handle, box }
  }

  function computeSelection(region: SelectionRegion, pg: Page): SelectionState {
    const strokes = new Set<string>()
    const images = new Set<string>()
    const texts = new Set<string>()
    const layer = getActiveLayer(pg)
    for (const s of layer.strokes) {
      if (strokeInRegion(s, region)) strokes.add(s.id)
    }
    for (const img of layer.images) {
      if (imageInRegion(img, region)) images.add(img.id)
    }
    for (const t of layer.texts) {
      if (textInRegion(t, region)) texts.add(t.id)
    }
    return { strokes, images, texts }
  }

  function isDegenerateRegion(region: SelectionRegion): boolean {
    if (region.type === 'rect' && region.points.length >= 2) {
      const a = region.points[0]
      const b = region.points[1]
      return Math.abs(b.x - a.x) < 6 && Math.abs(b.y - a.y) < 6
    }
    if (region.type === 'circle' && region.points.length >= 2) {
      return Math.hypot(region.points[1].x - region.points[0].x, region.points[1].y - region.points[0].y) < 4
    }
    if (region.type === 'free') {
      return region.points.length < 3
    }
    return false
  }

  function hitTestTopItem(p: Pt): { type: 'stroke' | 'image' | 'text'; id: string } | null {
    const pg = pageRef.current
    if (!pg) return null
    const layer = getActiveLayer(pg)
    for (let i = layer.strokes.length - 1; i >= 0; i--) {
      const s = layer.strokes[i]
      const b = strokeBounds(s)
      if (b && p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 3 && p.y <= b.y + b.h + 3) {
        return { type: 'stroke', id: s.id }
      }
    }
    for (let i = layer.images.length - 1; i >= 0; i--) {
      const img = layer.images[i]
      if (pointInPolygon(p.x, p.y, imageCorners(img))) {
        return { type: 'image', id: img.id }
      }
    }
    for (let i = layer.texts.length - 1; i >= 0; i--) {
      const t = layer.texts[i]
      if (!t.text || !t.text.trim()) continue
      if (pointInPolygon(p.x, p.y, textCorners(t))) {
        return { type: 'text', id: t.id }
      }
    }
    return null
  }

  function singleSelection(hit: { type: 'stroke' | 'image' | 'text'; id: string }): SelectionState {
    if (hit.type === 'stroke') return { strokes: new Set([hit.id]), images: new Set(), texts: new Set() }
    if (hit.type === 'image') return { strokes: new Set(), images: new Set([hit.id]), texts: new Set() }
    return { strokes: new Set(), images: new Set(), texts: new Set([hit.id]) }
  }

  function isItemSelected(hit: { type: 'stroke' | 'image' | 'text'; id: string }): boolean {
    const sel = selectionRef.current
    if (hit.type === 'stroke') return sel.strokes.has(hit.id)
    if (hit.type === 'image') return sel.images.has(hit.id)
    return sel.texts.has(hit.id)
  }

  function toggleSelectionItem(hit: { type: 'stroke' | 'image' | 'text'; id: string }) {
    const sel = selectionRef.current
    if (hit.type === 'stroke') {
      if (sel.strokes.has(hit.id)) sel.strokes.delete(hit.id)
      else sel.strokes.add(hit.id)
    } else if (hit.type === 'image') {
      if (sel.images.has(hit.id)) sel.images.delete(hit.id)
      else sel.images.add(hit.id)
    } else {
      if (sel.texts.has(hit.id)) sel.texts.delete(hit.id)
      else sel.texts.add(hit.id)
    }
    if (hit.type === 'image') {
      if (sel.images.has(hit.id)) setSelectedImageId(hit.id)
      else if (selectedImageIdRef.current === hit.id) setSelectedImageId(null)
    }
  }

  function clickSelect(p: Pt): SelectionState {
    const hit = hitTestTopItem(p)
    return hit ? singleSelection(hit) : { strokes: new Set(), images: new Set(), texts: new Set() }
  }

  async function computeDelimitedSelection(region: SelectionRegion, pg: Page): Promise<SelectionState> {
    const layer = getActiveLayer(pg)
    const selectedStrokes = new Set<string>()
    const selectedImages = new Set<string>()
    const selectedTexts = new Set<string>()
    for (const t of layer.texts) {
      if (textInRegion(t, region)) selectedTexts.add(t.id)
    }

    let modified = false
    let undoPushed = false
    const ensureUndo = () => {
      if (!undoPushed) {
        pushUndo()
        delimitedSnapshotRef.current = clonePage(pg)
        undoPushed = true
      }
    }

    const nextStrokes: Stroke[] = []
    for (const s of layer.strokes) {
      if (!strokeInRegion(s, region)) {
        nextStrokes.push(s)
        continue
      }
      const res = splitStrokeByRegion(s, region)
      if (res.inside.length === 1 && res.outside.length === 0) {
        nextStrokes.push(s)
        selectedStrokes.add(s.id)
        continue
      }
      if (res.inside.length === 0 && res.outside.length === 1) {
        nextStrokes.push(s)
        continue
      }
      modified = true
      nextStrokes.push(...res.outside)
      for (const ins of res.inside) selectedStrokes.add(ins.id)
      nextStrokes.push(...res.inside)
    }

    const cropTargets: ImageElement[] = []
    for (const img of layer.images) {
      if (!imageInRegion(img, region)) continue
      if (imageFullyInsideRegion(img, region)) {
        selectedImages.add(img.id)
      } else {
        cropTargets.push(img)
      }
    }

    if (modified) {
      ensureUndo()
      layer.strokes = nextStrokes
    }

    if (cropTargets.length > 0) {
      const version = cropVersionRef.current
      for (const img of cropTargets) {
        const result = await cropImageToRegion(img, region)
        if (version !== cropVersionRef.current) return selectionRef.current
        if (result.kind === 'none') continue
        if (result.kind === 'whole') {
          selectedImages.add(img.id)
          continue
        }
        const idx = layer.images.indexOf(img)
        if (idx < 0) continue
        ensureUndo()
        layer.images[idx] = result.outside
        layer.images.splice(idx + 1, 0, result.inside)
        modified = true
        selectedImages.add(result.inside.id)
      }
      if (version !== cropVersionRef.current) return selectionRef.current
    }

    if (modified) {
      pg.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      dirtyRef.current = true
      schedulePersist()
    }
    return { strokes: selectedStrokes, images: selectedImages, texts: selectedTexts }
  }

  function finishSelectionUi() {
    const selImages = [...selectionRef.current.images]
    if (selImages.length === 0) {
      setSelectedImageId(null)
    } else if (
      !selectedImageIdRef.current ||
      !selectionRef.current.images.has(selectedImageIdRef.current)
    ) {
      setSelectedImageId(selImages[0])
    }
    ctrlSelectRef.current = false
    requestRender()
  }

  function finalizeRegion() {
    delimitedSnapshotRef.current = null
    const region = selectionRegionRef.current
    selectionRegionRef.current = null
    const pg = pageRef.current
    if (!region || !pg) return
    if (isDegenerateRegion(region)) {
      const clicked = clickSelect(region.points[0])
      if (ctrlSelectRef.current) {
        mergeSelection(clicked)
      } else {
        selectionRef.current = clicked
      }
      finishSelectionUi()
      return
    }
    if (useAppStore.getState().settings.selectDelimitedOnly) {
      const version = ++cropVersionRef.current
      void computeDelimitedSelection(region, pg).then((computed) => {
        if (version !== cropVersionRef.current || !computed) return
        if (ctrlSelectRef.current) {
          mergeSelection(computed)
        } else {
          selectionRef.current = computed
        }
        finishSelectionUi()
      })
      return
    }
    const computed = computeSelection(region, pg)
    if (ctrlSelectRef.current) {
      mergeSelection(computed)
    } else {
      selectionRef.current = computed
    }
    finishSelectionUi()
  }

  function mergeSelection(next: SelectionState) {
    const sel = selectionRef.current
    for (const id of next.strokes) sel.strokes.add(id)
    for (const id of next.images) sel.images.add(id)
    for (const id of next.texts) sel.texts.add(id)
  }

  function detectDoubleClick(hit: { type: string; id: string }, pagePt: Pt): boolean {
    const last = lastClickRef.current
    if (!last) return false
    const now = Date.now()
    return (
      hit.type === last.type &&
      hit.id === last.id &&
      now - last.time < 400 &&
      Math.hypot(last.x - pagePt.x, last.y - pagePt.y) < 12
    )
  }

  function recordClick(hit: { type: string; id: string }, pagePt: Pt) {
    lastClickRef.current = { x: pagePt.x, y: pagePt.y, time: Date.now(), type: hit.type, id: hit.id }
  }

  async function persistNow() {
    const nb = notebookRef.current
    if (!nb) return
    dirtyRef.current = false
    await persistNotebook(nb)
  }

  function copySelection() {
    const snap = snapshotSelected()
    if (snap.strokes.length === 0 && snap.images.length === 0 && snap.texts.length === 0) return
    clipboardRef.current = { strokes: snap.strokes, images: snap.images, texts: snap.texts }
  }

  function pasteSelection() {
    const clip = clipboardRef.current
    if (!clip || (clip.strokes.length === 0 && clip.images.length === 0 && clip.texts.length === 0)) return
    const pg = pageRef.current
    if (!pg) return
    const layer = getActiveLayer(pg)
    if (layer.locked) return
    pushUndo()
    const dx = 16
    const dy = 16
    const newStrokes = clip.strokes.map((s) => ({
      ...s,
      id: newId(),
      points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    }))
    const newImages = clip.images.map((i) => ({ ...i, id: newId(), x: i.x + dx, y: i.y + dy }))
    const newTexts = clip.texts.map((t) => ({ ...t, id: newId(), x: t.x + dx, y: t.y + dy }))
    layer.strokes.push(...newStrokes)
    layer.images.push(...newImages)
    layer.texts.push(...newTexts)
    pg.updatedAt = Date.now()
    selectionRef.current = {
      strokes: new Set(newStrokes.map((s) => s.id)),
      images: new Set(newImages.map((i) => i.id)),
      texts: new Set(newTexts.map((t) => t.id)),
    }
    dirtyRef.current = true
    requestRender()
    void persistNow()
  }

  function duplicateSelection() {
    const snap = snapshotSelected()
    if (snap.strokes.length === 0 && snap.images.length === 0 && snap.texts.length === 0) return
    const pg = pageRef.current
    if (!pg) return
    const layer = getActiveLayer(pg)
    if (layer.locked) return
    pushUndo()
    const dx = 16
    const dy = 16
    const newStrokes = snap.strokes.map((s) => ({
      ...s,
      id: newId(),
      points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    }))
    const newImages = snap.images.map((i) => ({ ...i, id: newId(), x: i.x + dx, y: i.y + dy }))
    const newTexts = snap.texts.map((t) => ({ ...t, id: newId(), x: t.x + dx, y: t.y + dy }))
    layer.strokes.push(...newStrokes)
    layer.images.push(...newImages)
    layer.texts.push(...newTexts)
    pg.updatedAt = Date.now()
    selectionRef.current = {
      strokes: new Set(newStrokes.map((s) => s.id)),
      images: new Set(newImages.map((i) => i.id)),
      texts: new Set(newTexts.map((t) => t.id)),
    }
    dirtyRef.current = true
    requestRender()
    void persistNow()
  }

  function cutSelection() {
    copySelection()
    deleteSelection()
  }

  function deleteSelection() {
    const pg = pageRef.current
    if (!pg) return
    const layer = getActiveLayer(pg)
    if (layer.locked) return
    const sel = selectionRef.current
    if (sel.strokes.size === 0 && sel.images.size === 0 && sel.texts.size === 0) {
      const id = selectedImageIdRef.current
      if (id) {
        const idx = layer.images.findIndex((i) => i.id === id)
        if (idx >= 0) {
          pushUndo()
          layer.images.splice(idx, 1)
          pg.updatedAt = Date.now()
          setSelectedImageId(null)
          dirtyRef.current = true
          requestRender()
          void persistNow()
        }
      }
      return
    }
    pushUndo()
    layer.strokes = layer.strokes.filter((s) => !sel.strokes.has(s.id))
    layer.images = layer.images.filter((i) => !sel.images.has(i.id))
    layer.texts = layer.texts.filter((t) => !sel.texts.has(t.id))
    pg.updatedAt = Date.now()
    selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
    setSelectedImageId(null)
    dirtyRef.current = true
    requestRender()
    void persistNow()
  }

  function applyRegionMove(d: Pt) {
    const engine = engineRef.current
    const pg = pageRef.current
    const drag = selectionDragRef.current
    if (!engine || !pg || !drag) return
    const dx = d.x - drag.startPagePt.x
    const dy = d.y - drag.startPagePt.y
    const sel = selectionRef.current
    const strokeMap = new Map(drag.snapshotStrokes.map((s) => [s.id, s]))
    const imgMap = new Map(drag.snapshotImages.map((i) => [i.id, i]))
    const textMap = new Map(drag.snapshotTexts.map((t) => [t.id, t]))
    const layer = getActiveLayer(pg)
    layer.strokes = layer.strokes.map((s) => {
      const src = strokeMap.get(s.id)
      if (!sel.strokes.has(s.id) || !src) return s
      return { ...src, points: src.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
    })
    layer.images = layer.images.map((i) => {
      const src = imgMap.get(i.id)
      if (!sel.images.has(i.id) || !src) return i
      return { ...src, x: src.x + dx, y: src.y + dy }
    })
    layer.texts = layer.texts.map((t) => {
      const src = textMap.get(t.id)
      if (!sel.texts.has(t.id) || !src) return t
      return { ...src, x: src.x + dx, y: src.y + dy }
    })
    pg.updatedAt = Date.now()
    dirtyRef.current = true
    requestRender()
  }

  function resolveTargetPage(pos: Pt): number {
    const engine = engineRef.current
    if (!engine || viewModeRef.current === 'separate') return currentPageIndexRef.current
    const doc = engine.toDocumentCoords(pos.x, pos.y)
    const hit = pageUnderPoint(pagesRef.current, offsetsRef.current, doc.x, doc.y)
    return hit !== null ? hit : currentPageIndexRef.current
  }

  function transferSelectionTo(targetIdx: number) {
    const pages = pagesRef.current
    const from = pages[currentPageIndexRef.current]
    const to = pages[targetIdx]
    if (!from || !to || from === to) return
    const fromLayer = getActiveLayer(from)
    const toLayer = getActiveLayer(to)
    if (toLayer.locked) return
    const sel = selectionRef.current
    if (sel.strokes.size) {
      const moving = fromLayer.strokes.filter((s) => sel.strokes.has(s.id))
      fromLayer.strokes = fromLayer.strokes.filter((s) => !sel.strokes.has(s.id))
      toLayer.strokes.push(...moving)
    }
    if (sel.images.size) {
      const moving = fromLayer.images.filter((i) => sel.images.has(i.id))
      fromLayer.images = fromLayer.images.filter((i) => !sel.images.has(i.id))
      toLayer.images.push(...moving)
    }
    if (sel.texts.size) {
      const moving = fromLayer.texts.filter((t) => sel.texts.has(t.id))
      fromLayer.texts = fromLayer.texts.filter((t) => !sel.texts.has(t.id))
      toLayer.texts.push(...moving)
    }
    currentPageIndexRef.current = targetIdx
    pageRef.current = to
    suppressPageFocusRef.current = true
    useAppStore.getState().selectPage(targetIdx)
    requestRenderRef.current()
  }

  // ---- Text helpers ----

  function commitDraftAt(x: number, y: number, centered = false) {
    const ts = useTextStore.getState()
    const engine = engineRef.current
    const pg = pageRef.current
    if (!ts.draft.trim() || !pg || !engine) return
    const layer = getActiveLayer(pg)
    if (layer.locked) return
    const st = useAppStore.getState().settings
    pushUndo()
    const el = makeTextElement(ts.draft, x, y, st)
    el.rotation = ts.draftRotation
    if (centered) {
      const layout = engine.textLayout(el)
      el.x = clamp(x - layout.w / 2, 0, Math.max(0, pg.width - 20))
      el.y = clamp(y - layout.h / 2, 0, Math.max(0, pg.height - 20))
    } else {
      el.x = clamp(el.x, 0, Math.max(0, pg.width - 20))
      el.y = clamp(el.y, 0, Math.max(0, pg.height - 20))
    }
    layer.texts.push(el)
    pg.updatedAt = Date.now()
    notebookRef.current!.updatedAt = Date.now()
    ts.setDraft('')
    ts.setDraftRotation(0)
    ts.setDraftPos({ x: el.x, y: el.y })
    dirtyRef.current = true
    requestRender()
    schedulePersist()
  }

  // ---- Inline text editing ----

  function openInlineText(existing: TextElement | null, pagePt?: Pt) {
    const ts = useTextStore.getState()
    const pg = pageRef.current
    if (pg && getActiveLayer(pg).locked) return
    if (inlineTextRef.current) commitInlineText()
    if (existing) {
      pushUndo()
      ts.selectText(existing.id)
      ts.setEditingExisting(true)
      setInlineText({ pageX: existing.x, pageY: existing.y, value: existing.text, targetId: existing.id })
    } else if (pagePt) {
      ts.selectText(null)
      ts.setEditingExisting(false)
      ts.setDraft('')
      ts.setDraftRotation(0)
      setInlineText({ pageX: pagePt.x, pageY: pagePt.y, value: '', targetId: null })
    }
    requestRender()
  }

  function onInlineChange(value: string) {
    const cur = inlineTextRef.current
    if (!cur) return
    setInlineText({ ...cur, value })
    const pg = pageRef.current
    if (cur.targetId && pg) {
      const el = getActiveLayer(pg).texts.find((t) => t.id === cur.targetId)
      if (el) {
        el.text = value
        pg.updatedAt = Date.now()
        notebookRef.current!.updatedAt = Date.now()
        dirtyRef.current = true
        requestRender()
        schedulePersist()
      }
    }
  }

  function commitInlineText() {
    const cur = inlineTextRef.current
    if (!cur) return
    inlineTextRef.current = null
    const ts = useTextStore.getState()
    const pg = pageRef.current
    const { value, pageX, pageY, targetId } = cur
    if (pg) {
      if (targetId) {
        const el = getActiveLayer(pg).texts.find((t) => t.id === targetId)
        if (el && value.trim()) {
          el.text = value
          el.x = pageX
          el.y = pageY
          pg.updatedAt = Date.now()
          notebookRef.current!.updatedAt = Date.now()
          dirtyRef.current = true
          schedulePersist()
        }
      } else if (value.trim()) {
        ts.setDraft(value)
        ts.setDraftPos({ x: pageX, y: pageY })
        commitDraftAt(pageX, pageY)
      }
    }
    ts.selectText(null)
    ts.setEditingExisting(false)
    ts.setDraft('')
    ts.setDraftRotation(0)
    setInlineText(null)
    requestRender()
  }

  function cancelInlineText() {
    inlineTextRef.current = null
    const ts = useTextStore.getState()
    ts.selectText(null)
    ts.setEditingExisting(false)
    ts.setDraft('')
    ts.setDraftRotation(0)
    setInlineText(null)
    requestRender()
  }

  // ---- Drawing / erasing ----

  function eraseAtPage(p: Pt, session: ImageEraseSession | null): boolean {
    const engine = engineRef.current
    const pg = pageRef.current
    if (!engine || !pg) return false
    const radius = useAppStore.getState().settings.lastEraserSize / 2
    const mode = useAppStore.getState().settings.eraserMode
    const wholeStroke = useAppStore.getState().settings.eraserEraseWholeStroke
    let changed = false
    const layer = getActiveLayer(pg)
    if (mode === 'strokes' || mode === 'both') {
      if (wholeStroke) {
        const next: Stroke[] = []
        for (const s of layer.strokes) {
          const er = radius + (s.size ?? 0) / 2
          if (strokeIntersectsCircle(s, p.x, p.y, er)) {
            changed = true
          } else {
            next.push(s)
          }
        }
        if (changed) layer.strokes = next
      } else {
        const next: Stroke[] = []
        for (const s of layer.strokes) {
          const er = radius + (s.size ?? 0) / 2
          if (!strokeIntersectsCircle(s, p.x, p.y, er)) {
            next.push(s)
            continue
          }
          const parts = splitStrokeByCircle(s, p.x, p.y, er)
          if (parts.length === 1 && parts[0].points.length === s.points.length) {
            next.push(s)
          } else {
            changed = true
            next.push(...parts)
          }
        }
        if (changed) layer.strokes = next
      }
    }
    if ((mode === 'images' || mode === 'both') && session) {
      for (const img of [...layer.images]) {
        if (!circleIntersectsImageRect(img, p.x, p.y, radius + 8)) continue
        if (session.erase(img, p.x, p.y, radius)) {
          const canvas = session.canvasFor(img.id)
          if (canvas) engine.setImageOverride(img.id, img.dataUrl, canvas)
          changed = true
        }
      }
    }
    if (changed) {
      pg.updatedAt = Date.now()
      dirtyRef.current = true
    }
    return changed
  }

  function eraseSegment(prev: Pt, cur: Pt, session: ImageEraseSession | null): boolean {
    const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const steps = Math.max(1, Math.ceil(dist / 3))
    let changed = false
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const p = {
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
      }
      if (eraseAtPage(p, session)) changed = true
    }
    return changed
  }

  function scheduleEraseStep() {
    const pending = erasePendingRef.current
    if (pending.scheduled) return
    pending.scheduled = true
    requestAnimationFrame(() => {
      pending.scheduled = false
      const session = eraseSessionRef.current
      if (!session) return
      let changed = false
      if (pending.to) {
        changed = eraseSegment(pending.from, pending.to, session)
        pending.from = pending.to
        pending.to = null
      }
      if (pending.to) {
        scheduleEraseStep()
      }
      if (changed) requestRender()
    })
  }

  // ---- Pointer handlers ----

  function abortForPan() {
    const engine = engineRef.current
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'draw') {
      engine?.endStroke()
    } else if (drag.kind === 'erase') {
      const session = eraseSessionRef.current
      if (session) {
        const changed = session.commit()
        const pg = pageRef.current
        if (pg && changed.length) {
          pushUndo()
          for (const { element, newUrl } of changed) {
            engine?.clearImageCache(element.dataUrl)
            element.dataUrl = newUrl
            const ov = engine?.getOverrideCanvas(element.id)
            if (ov) engine?.setImageOverride(element.id, newUrl, ov)
            engine?.warmImage(element.id, newUrl)
          }
          pg.updatedAt = Date.now()
          notebookRef.current!.updatedAt = Date.now()
          dirtyRef.current = true
        }
      }
      eraseSessionRef.current = null
      erasePendingRef.current.to = null
      erasePendingRef.current.scheduled = false
    } else if (drag.kind === 'region-draw') {
      finalizeRegion()
    }
  }

  const isPanShortcutActive = useCallback((e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const panShortcut = settings.shortcuts.pan
    if (!panShortcut) return false
    if (panShortcut === 'alt') return e.altKey
    if (panShortcut === 'ctrl') return e.ctrlKey || e.metaKey
    if (panShortcut === 'shift') return e.shiftKey
    return pressedKeysRef.current.has(panShortcut)
  }, [settings.shortcuts.pan])

  function onPointerDown(e: React.PointerEvent) {
    const canvas = canvasRef.current
    const engine = engineRef.current
    if (!canvas || !engine || !page) return
    if (e.pointerType === 'mouse') {
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
    if (e.pointerType !== 'mouse') e.preventDefault()
    const pos = getPointerPos(e.nativeEvent)
    trackMouse(e)
    activePointersRef.current.set(e.pointerId, pos)
    pointerDownPosRef.current.set(e.pointerId, pos)

    const multiTouch = activePointersRef.current.size >= 2
    if (multiTouch) {
      const drag = dragRef.current
      if (drag?.kind === 'pan' && drag.multiTouch) {
        pinchRef.current = null
        twoFingerDownAtRef.current = null
        threeFingerDownAtRef.current = null
        pendingTwoFingerRef.current = { id: e.pointerId, start: pos }
        return
      }
      if (
        drag &&
        (drag.kind === 'draw' || drag.kind === 'erase' || drag.kind === 'region-draw')
      ) {
        dragInterruptedByTouchRef.current = true
        if (multiTouchDownAtRef.current === 0) multiTouchDownAtRef.current = Date.now()
      }
      if (activePointersRef.current.size === 2) {
        const otherId = [...activePointersRef.current.keys()].find((id) => id !== e.pointerId)
        const otherPos = otherId !== undefined ? activePointersRef.current.get(otherId) : undefined
        const otherDown = otherId !== undefined ? pointerDownPosRef.current.get(otherId) : undefined
        const otherMoved =
          otherPos && otherDown
            ? Math.hypot(otherPos.x - otherDown.x, otherPos.y - otherDown.y) > TWO_FINGER_THRESHOLD
            : false
        twoFingerDownAtRef.current = otherMoved ? null : Date.now()
        threeFingerDownAtRef.current = null
      } else if (activePointersRef.current.size === 3) {
        twoFingerDownAtRef.current = null
        threeFingerDownAtRef.current = Date.now()
      } else {
        twoFingerDownAtRef.current = null
        threeFingerDownAtRef.current = null
      }
      pendingTwoFingerRef.current = { id: e.pointerId, start: pos }
      return
    }

    dragOwnerIdRef.current = e.pointerId
    dragInterruptedByTouchRef.current = false
    multiTouchDownAtRef.current = 0

    if (isPanShortcutActive(e) || e.button === 1 || tool === 'pan') {
      lastInteractionPanRef.current = { ...panRef.current }
      dragRef.current = {
        kind: 'pan',
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        imageId: null,
        handle: null,
        startPan: { ...panRef.current },
      }
      canvas.style.cursor = 'grabbing'
      return
    }

    if (viewModeRef.current !== 'separate') {
      const doc = engine.toDocumentCoords(pos.x, pos.y)
      const hit = pageUnderPoint(pagesRef.current, offsetsRef.current, doc.x, doc.y)
      if (hit !== null && hit !== currentPageIndexRef.current) {
        autoFollowRef.current = true
        currentPageIndexRef.current = hit
        lastInteractionPanRef.current = { ...panRef.current }
        const pg = pagesRef.current[hit]
        if (pg) {
          pageRef.current = pg
          engine.page = pg
          engine.setDocument(
            pagesRef.current,
            offsetsRef.current,
            viewModeRef.current,
            hit,
          )
        }
        useAppStore.getState().selectPage(hit)
        requestRender()
        if (tool === 'select' || tool === 'text') {
          return
        }
      }
    }

    const pagePt = engine.toPageCoords(pos.x, pos.y)

    const st = useAppStore.getState()
    if (tool === 'select' && st.rotationOpen && st.settings.freeRotate) {
      pageRotateUndoPushedRef.current = false
      dragRef.current = {
        kind: 'page-rotate',
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        imageId: null,
        handle: null,
        startPan: { ...panRef.current },
        startRotation: page.rotation,
      }
      return
    }

    if (
      getActiveLayer(page).locked &&
      (tool === 'pen' ||
        tool === 'highlighter' ||
        tool === 'eraser' ||
        tool === 'text' ||
        tool === 'select')
    ) {
      return
    }

    if (tool === 'text') {
      const ts = useTextStore.getState()
      const activeEl = ts.selectedTextId
        ? getActiveLayer(page).texts.find((t) => t.id === ts.selectedTextId) ?? null
        : null

      if (activeEl) {
        const handle = engine.hitTestTextSelectionHandles(activeEl, pagePt.x, pagePt.y)
        if (handle) {
          pushUndo()
          dragRef.current = {
            kind: handle === 'rotate' ? 'text-rotate' : 'text-resize',
            startX: pos.x,
            startY: pos.y,
            lastX: pos.x,
            lastY: pos.y,
            imageId: null,
            handle,
            startPan: { ...panRef.current },
            textTarget: { type: 'existing', id: activeEl.id },
            snapshotTexts: [{ ...activeEl }],
          }
          canvas.style.cursor = handle === 'rotate' ? ROTATE_CURSOR : imageResizeCursor(handle)
          requestRender()
          return
        }
      }

      const hit = engine.hitTestTexts(getActiveLayer(page).texts, pagePt.x, pagePt.y)
      if (hit) {
        openInlineText(hit)
        return
      }

      e.preventDefault()
      openInlineText(null, pagePt)
      return
    }

    if (tool === 'select') {
      const mode = settings.lastSelectMode
      const transformHit = transformHandleAt(pagePt)
      if (transformHit) {
        pushUndo()
        const cornerCount = selectionRef.current.strokes.size + selectionRef.current.texts.size
        const useGroup = cornerCount > 1
        if (useGroup) {
          const snap = snapshotSelected()
          dragRef.current = {
            kind: transformHit.handle === 'rotate' ? 'group-rotate' : 'group-resize',
            startX: pos.x,
            startY: pos.y,
            lastX: pos.x,
            lastY: pos.y,
            imageId: null,
            handle: transformHit.handle,
            startPan: { ...panRef.current },
            startBox: { ...transformHit.box },
            snapshotStrokes: snap.strokes,
            snapshotImages: snap.images,
            snapshotTexts: snap.texts,
            startAngle:
              (Math.atan2(
                pagePt.y - (transformHit.box.y + transformHit.box.h / 2),
                pagePt.x - (transformHit.box.x + transformHit.box.w / 2),
              ) *
                180) /
              Math.PI,
          }
        } else if (selectionRef.current.strokes.size === 1) {
          const sid = [...selectionRef.current.strokes][0]
          const stroke = getActiveLayer(page).strokes.find((s) => s.id === sid)
          if (!stroke) return
          dragRef.current = {
            kind: transformHit.handle === 'rotate' ? 'group-rotate' : 'group-resize',
            startX: pos.x,
            startY: pos.y,
            lastX: pos.x,
            lastY: pos.y,
            imageId: null,
            handle: transformHit.handle,
            startPan: { ...panRef.current },
            startBox: { ...transformHit.box },
            snapshotStrokes: [{ ...stroke, points: stroke.points.map((p) => ({ ...p })) }],
            snapshotTexts: [],
            startAngle:
              (Math.atan2(
                pagePt.y - (transformHit.box.y + transformHit.box.h / 2),
                pagePt.x - (transformHit.box.x + transformHit.box.w / 2),
              ) *
                180) /
              Math.PI,
          }
        } else {
          const tid = [...selectionRef.current.texts][0]
          const textEl = getActiveLayer(page).texts.find((t) => t.id === tid)
          if (!textEl) return
          dragRef.current = {
            kind: transformHit.handle === 'rotate' ? 'group-rotate' : 'group-resize',
            startX: pos.x,
            startY: pos.y,
            lastX: pos.x,
            lastY: pos.y,
            imageId: null,
            handle: transformHit.handle,
            startPan: { ...panRef.current },
            startBox: { ...transformHit.box },
            snapshotStrokes: [],
            snapshotTexts: [{ ...textEl }],
            startAngle:
              (Math.atan2(
                pagePt.y - (transformHit.box.y + transformHit.box.h / 2),
                pagePt.x - (transformHit.box.x + transformHit.box.w / 2),
              ) *
                180) /
              Math.PI,
          }
        }
        canvas.style.cursor =
          transformHit.handle === 'rotate' ? ROTATE_CURSOR : imageResizeCursor(transformHit.handle)
        requestRender()
        return
      }

      if (mode === 'click') {
        const hit = hitTestTopItem(pagePt)
        if (e.ctrlKey || e.metaKey) {
          if (hit) toggleSelectionItem(hit)
          requestRender()
          return
        }
        const selImg = selectedImageIdRef.current
          ? getActiveLayer(page).images.find((i) => i.id === selectedImageIdRef.current) ?? null
          : null
        if (selImg) {
          const handle = engine.hitTestImageHandles(selImg, pagePt.x, pagePt.y)
          if (handle) {
            pushUndo()
            selectionRef.current.images.add(selImg.id)
            dragRef.current = {
              kind: handle === 'rotate' ? 'select-rotate' : 'select-resize',
              startX: pos.x,
              startY: pos.y,
              lastX: pos.x,
              lastY: pos.y,
              imageId: selImg.id,
              handle,
              startPan: { ...panRef.current },
              startImage: { ...selImg },
            }
            canvas.style.cursor = imageResizeCursor(handle)
            requestRender()
            return
          }
        }
        if (hit) {
          const isDbl = detectDoubleClick(hit, pagePt)
          if (isDbl && hit.type === 'text') {
            const el = getActiveLayer(page).texts.find((t) => t.id === hit.id)
            if (el) {
              setTool('text')
              openInlineText(el)
              requestRender()
              return
            }
          }
          if (isItemSelected(hit) && !isDbl) {
            pushUndo()
            const snap = snapshotSelected()
            const sd = engine.toPageCoords(pos.x, pos.y)
            selectionDragRef.current = {
              kind: 'region-move',
              startX: pos.x,
              startY: pos.y,
              startPagePt: sd,
              snapshotStrokes: snap.strokes,
              snapshotImages: snap.images,
              snapshotTexts: snap.texts,
            }
            dragRef.current = {
              kind: 'region-move',
              startX: pos.x,
              startY: pos.y,
              lastX: pos.x,
              lastY: pos.y,
              imageId: null,
              handle: null,
              startPan: { ...panRef.current },
            }
            canvas.style.cursor = 'grabbing'
            recordClick(hit, pagePt)
            requestRender()
            return
          }
          if (hit.type === 'image') {
            const img = getActiveLayer(page).images.find((i) => i.id === hit.id)
            if (img && img.id === selectedImageIdRef.current) {
              const handle = engine.hitTestImageHandles(img, pagePt.x, pagePt.y)
              if (handle) {
                pushUndo()
                dragRef.current = {
                  kind: handle === 'rotate' ? 'select-rotate' : 'select-resize',
                  startX: pos.x,
                  startY: pos.y,
                  lastX: pos.x,
                  lastY: pos.y,
                  imageId: img.id,
                  handle,
                  startPan: { ...panRef.current },
                  startImage: { ...img },
                }
                canvas.style.cursor = imageResizeCursor(handle)
                requestRender()
                return
              }
            }
          }
          selectionRef.current = singleSelection(hit)
          if (hit.type === 'image') setSelectedImageId(hit.id)
          else setSelectedImageId(null)
          recordClick(hit, pagePt)
          requestRender()
        } else {
          selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
          setSelectedImageId(null)
          requestRender()
        }
        return
      }

      // Region selection modes (free / circle / rect)
      if (e.ctrlKey || e.metaKey) {
        const hit = hitTestTopItem(pagePt)
        if (hit && isItemSelected(hit)) {
          toggleSelectionItem(hit)
          requestRender()
          return
        }
        selectionRegionRef.current = { type: mode as 'free' | 'circle' | 'rect', points: [pagePt] }
        dragRef.current = {
          kind: 'region-draw',
          startX: pos.x,
          startY: pos.y,
          lastX: pos.x,
          lastY: pos.y,
          imageId: null,
          handle: null,
          startPan: { ...panRef.current },
        }
        ctrlSelectRef.current = true
        requestRender()
        return
      }
      const selImg = selectedImageIdRef.current
        ? getActiveLayer(page).images.find((i) => i.id === selectedImageIdRef.current) ?? null
        : null
      if (selImg) {
        const handle = engine.hitTestImageHandles(selImg, pagePt.x, pagePt.y)
        if (handle) {
          pushUndo()
          dragRef.current = {
            kind: handle === 'rotate' ? 'select-rotate' : 'select-resize',
            startX: pos.x,
            startY: pos.y,
            lastX: pos.x,
            lastY: pos.y,
            imageId: selImg.id,
            handle,
            startPan: { ...panRef.current },
            startImage: { ...selImg },
          }
          canvas.style.cursor = imageResizeCursor(handle)
          requestRender()
          return
        }
      }
      if (
        selectionRef.current.strokes.size +
          selectionRef.current.images.size +
          selectionRef.current.texts.size >
          0 &&
        hitTestSelectionBounds(pagePt)
      ) {
        pushUndo()
        const snap = snapshotSelected()
        const sd = engine.toPageCoords(pos.x, pos.y)
        selectionDragRef.current = {
          kind: 'region-move',
          startX: pos.x,
          startY: pos.y,
          startPagePt: sd,
          snapshotStrokes: snap.strokes,
          snapshotImages: snap.images,
          snapshotTexts: snap.texts,
        }
        dragRef.current = {
          kind: 'region-move',
          startX: pos.x,
          startY: pos.y,
          lastX: pos.x,
          lastY: pos.y,
          imageId: null,
          handle: null,
          startPan: { ...panRef.current },
        }
        canvas.style.cursor = 'grabbing'
        requestRender()
        return
      }
      selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
      setSelectedImageId(null)
      selectionRegionRef.current = { type: mode as 'free' | 'circle' | 'rect', points: [pagePt] }
      dragRef.current = {
        kind: 'region-draw',
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        imageId: null,
        handle: null,
        startPan: { ...panRef.current },
      }
      requestRender()
      return
    }

    if (tool === 'eraser') {
      dirtyRef.current = false
      const session = new ImageEraseSession()
      eraseSessionRef.current = session
      dragRef.current = {
        kind: 'erase',
        startX: pos.x,
        startY: pos.y,
        lastX: pos.x,
        lastY: pos.y,
        imageId: null,
        handle: null,
        startPan: { ...panRef.current },
        lastErasePage: { ...pagePt },
      }
      erasePendingRef.current.from = { ...pagePt }
      erasePendingRef.current.to = null
      eraseAtPage({ ...pagePt }, session)
      requestRender()
      return
    }

    const color = tool === 'highlighter' ? settings.lastHighlighterColor : settings.lastPenColor
    const size = tool === 'highlighter' ? settings.lastHighlighterSize : settings.lastPenSize
    dragRef.current = {
      kind: 'draw',
      startX: pos.x,
      startY: pos.y,
      lastX: pos.x,
      lastY: pos.y,
      imageId: null,
      handle: null,
      startPan: { ...panRef.current },
    }
    engine.beginStroke(tool, color, size, pos.x, pos.y)
    requestRender()
  }

  function updateSelectCursor(pagePt: Pt) {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas) return
    const tHit = transformHandleAt(pagePt)
    if (tHit) {
      canvas.style.cursor = tHit.handle === 'rotate' ? ROTATE_CURSOR : imageResizeCursor(tHit.handle)
      return
    }
    if (hitTestSelectionBounds(pagePt)) {
      const pg = pageRef.current
      if (pg && selectedImageIdRef.current) {
        const img = getActiveLayer(pg).images.find((i) => i.id === selectedImageIdRef.current)
        if (img) {
          const handle = engine.hitTestImageHandles(img, pagePt.x, pagePt.y)
          if (handle) {
            canvas.style.cursor = imageResizeCursor(handle)
            return
          }
        }
      }
      canvas.style.cursor = 'move'
      return
    }
    const pg = pageRef.current
    if (pg && selectedImageIdRef.current) {
      const img = getActiveLayer(pg).images.find((i) => i.id === selectedImageIdRef.current)
      if (img) {
        const handle = engine.hitTestImageHandles(img, pagePt.x, pagePt.y)
        if (handle) {
          canvas.style.cursor = imageResizeCursor(handle)
          return
        }
      }
    }
    canvas.style.cursor = 'default'
  }

  function onPointerMove(e: React.PointerEvent) {
    const engine = engineRef.current
    const canvas = canvasRef.current
    if (!engine || !canvas || !page) return
    const pos = getPointerPos(e.nativeEvent)
    mousePosRef.current = { x: e.clientX - canvas.getBoundingClientRect().left, y: e.clientY - canvas.getBoundingClientRect().top }
    if (tool === 'eraser' || tool === 'pen' || tool === 'highlighter') setMousePos({ ...mousePosRef.current })
    activePointersRef.current.set(e.pointerId, pos)

    const pending = pendingTwoFingerRef.current
    if (pending && e.pointerId === pending.id) {
      const moved = Math.hypot(pos.x - pending.start.x, pos.y - pending.start.y)
      if (moved > TWO_FINGER_THRESHOLD) {
        pendingTwoFingerRef.current = null
        twoFingerDownAtRef.current = null
        threeFingerDownAtRef.current = null
        abortForPan()
        setSelectedImageId(null)
        selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
        selectionRegionRef.current = null
        selectionDragRef.current = null
        lastInteractionPanRef.current = { ...panRef.current }
        const pts = [...activePointersRef.current.values()]
        const a = pts[0]
        const b = pts[1]
        const startMid = a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a ?? pos
        const [ra, rb] = rotationPair(pts)
        pinchRotationUndoPushedRef.current = false
        dragRef.current = {
          kind: 'pan',
          multiTouch: true,
          startX: startMid.x,
          startY: startMid.y,
          lastX: pos.x,
          lastY: pos.y,
          imageId: null,
          handle: null,
          startPan: { ...panRef.current },
          startAngle: ra && rb ? angleBetween(ra, rb) : undefined,
          startRotation: pageRef.current?.rotation ?? 0,
        }
        dragOwnerIdRef.current = e.pointerId
        dragInterruptedByTouchRef.current = false
        multiTouchDownAtRef.current = 0
        pinchRef.current = null
        canvas.style.cursor = 'grabbing'
      }
    }

    const drag = dragRef.current
    if (!drag) {
      if (tool === 'select') {
        updateSelectCursor(engine.toPageCoords(pos.x, pos.y))
      } else if (tool === 'eraser' || tool === 'pen' || tool === 'highlighter') {
        requestRender()
      }
      return
    }

    if (drag.kind === 'page-rotate') {
      const pg = pageRef.current
      if (!pg) return
      const rect = canvas.getBoundingClientRect()
      const off = offsetsRef.current[currentPageIndexRef.current] ?? { x: 0, y: 0 }
      const cx = rect.left + panRef.current.x + (off.x + pg.width / 2) * zoomRef.current
      const cy = rect.top + panRef.current.y + (off.y + pg.height / 2) * zoomRef.current
      const a1 = Math.atan2(pos.y - cy, pos.x - cx)
      const a0 = Math.atan2(drag.startY - cy, drag.startX - cx)
      const delta = ((a1 - a0) * 180) / Math.PI
      if (Math.abs(delta) > 1) {
        if (!pageRotateUndoPushedRef.current) {
          pageRotateUndoPushedRef.current = true
          pushUndo()
        }
        const base = drag.startRotation ?? pg.rotation
        pg.rotation = ((((base + delta) % 360) + 360) % 360)
        pg.updatedAt = Date.now()
        notebookRef.current!.updatedAt = Date.now()
        dirtyRef.current = true
        requestRender()
        schedulePersist()
      }
      return
    }

    if (drag.kind === 'pan') {
      if (drag.multiTouch && activePointersRef.current.size >= 2) {
        const pts = [...activePointersRef.current.values()]
        const a = pts[0]
        const b = pts[1]
        if (a && b) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const dist = Math.hypot(a.x - b.x, a.y - b.y)
          const prev = pinchRef.current
          if (prev && prev.prevDist > 0 && dist > 0) {
            const rect = canvas.getBoundingClientRect()
            applyZoomAt(mid.x - rect.left, mid.y - rect.top, dist / prev.prevDist)
            panRef.current.x += mid.x - prev.prevMid.x
            panRef.current.y += mid.y - prev.prevMid.y
          } else {
            const [ra, rb] = rotationPair(pts)
            drag.startAngle = angleBetween(ra, rb)
            drag.startRotation = pageRef.current?.rotation ?? 0
            pinchRotationUndoPushedRef.current = false
            panRef.current = {
              x: drag.startPan.x + (mid.x - drag.startX),
              y: drag.startPan.y + (mid.y - drag.startY),
            }
          }
          if (
            activePointersRef.current.size >= 3 &&
            drag.startAngle !== undefined &&
            drag.startRotation !== undefined
          ) {
            const [ra, rb] = rotationPair(pts)
            const ang = angleBetween(ra, rb)
            let delta = ang - drag.startAngle
            delta = ((delta + 540) % 360) - 180
            const pg = pageRef.current
            if (pg && Math.abs(delta) > 1) {
              if (!pinchRotationUndoPushedRef.current) {
                pinchRotationUndoPushedRef.current = true
                pushUndo()
              }
              pg.rotation = ((((drag.startRotation + delta) % 360) + 360) % 360)
              pg.updatedAt = Date.now()
              notebookRef.current!.updatedAt = Date.now()
              dirtyRef.current = true
              schedulePersist()
            }
          }
          pinchRef.current = { prevDist: dist, prevMid: mid }
          requestRender()
          return
        }
      }
      pinchRef.current = null
      panRef.current = {
        x: drag.startPan.x + (pos.x - drag.startX),
        y: drag.startPan.y + (pos.y - drag.startY),
      }
      requestRender()
      return
    }

    if (drag.kind === 'draw') {
      engine.extendStroke(pos.x, pos.y, e.pressure || (e.pointerType === 'mouse' ? 1 : 0.5))
      return
    }

    if (drag.kind === 'erase') {
      const cur = engine.toPageCoords(pos.x, pos.y)
      const session = eraseSessionRef.current
      if (!session) return
      erasePendingRef.current.to = cur
      scheduleEraseStep()
      return
    }

    if (drag.kind === 'text-rotate') {
      let el: TextElement | null = null
      if (drag.textTarget?.type === 'existing') {
        const tid = drag.textTarget.id
        el = getActiveLayer(page).texts.find((t) => t.id === tid) ?? null
      } else {
        el = draftRef.current
      }
      if (!el) return
      const c = engine.textRotateCenter(el)
      const cur = engine.toPageCoords(pos.x, pos.y)
      const angle = (Math.atan2(cur.y - c.y, cur.x - c.x) * 180) / Math.PI + 90
      const rot = Math.round(((((angle % 360) + 360) % 360) / 5)) * 5
      if (drag.textTarget?.type === 'existing') {
        el.rotation = rot
        page.updatedAt = Date.now()
        dirtyRef.current = true
        schedulePersist()
      } else {
        useTextStore.getState().setDraftRotation(rot)
      }
      requestRender()
      return
    }

    if (drag.kind === 'region-draw') {
      const region = selectionRegionRef.current
      if (!region) return
      const p = engine.toPageCoords(pos.x, pos.y)
      if (region.type === 'free') {
        const last = region.points[region.points.length - 1]
        if (Math.hypot(p.x - last.x, p.y - last.y) > 4) {
          region.points.push(p)
        }
      } else {
        region.points[1] = p
      }
      requestRender()
      return
    }

    if (drag.kind === 'region-move') {
      const targetIdx = resolveTargetPage(pos)
      if (targetIdx !== currentPageIndexRef.current) transferSelectionTo(targetIdx)
      const d = engine.toPageCoordsAt(pos.x, pos.y, targetIdx)
      applyRegionMove(d)
      return
    }

    if (drag.kind === 'select-move' && drag.imageId) {
      const start = drag.startImage
      const startPt = drag.startPagePt
      if (!start || !startPt) return
      const targetIdx = resolveTargetPage(pos)
      if (targetIdx !== currentPageIndexRef.current) {
        const pages = pagesRef.current
        const from = pages[currentPageIndexRef.current]
        const to = pages[targetIdx]
        if (from && to) {
          const fromLayer = getActiveLayer(from)
          const toLayer = getActiveLayer(to)
          const idx = fromLayer.images.findIndex((i) => i.id === drag.imageId)
          if (idx >= 0) {
            const [moved] = fromLayer.images.splice(idx, 1)
            toLayer.images.push(moved)
          }
          currentPageIndexRef.current = targetIdx
          suppressPageFocusRef.current = true
          useAppStore.getState().selectPage(targetIdx)
        }
      }
      const pg = pagesRef.current[currentPageIndexRef.current]
      const img = pg ? getActiveLayer(pg).images.find((i) => i.id === drag.imageId) : undefined
      if (!pg || !img) return
      const d = engine.toPageCoordsAt(pos.x, pos.y, targetIdx)
      img.x = Math.round(start.x + (d.x - startPt.x))
      img.y = Math.round(start.y + (d.y - startPt.y))
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }

    if (drag.kind === 'select-resize' && drag.imageId && drag.handle) {
      const pg = pageRef.current
      const img = pg ? getActiveLayer(pg).images.find((i) => i.id === drag.imageId) : undefined
      if (!pg || !img) return
      const cur = engine.toPageCoords(pos.x, pos.y)
      applyImageResize(img, drag.handle, cur)
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }

    if (drag.kind === 'select-rotate' && drag.imageId) {
      const pg = pageRef.current
      const img = pg ? getActiveLayer(pg).images.find((i) => i.id === drag.imageId) : undefined
      if (!pg || !img) return
      const cx = img.x + img.width / 2
      const cy = img.y + img.height / 2
      const cur = engine.toPageCoords(pos.x, pos.y)
      const angle = (Math.atan2(cur.y - cy, cur.x - cx) * 180) / Math.PI
      img.rotation = Math.round(((angle + 90) % 360) + 360) % 360
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }

    if (drag.kind === 'text-resize' && drag.textTarget?.type === 'existing' && drag.handle) {
      const pg = pageRef.current
      const t = pg ? getActiveLayer(pg).texts.find((e) => e.id === (drag.textTarget as { id: string }).id) : undefined
      const snap = drag.snapshotTexts?.[0]
      if (!pg || !t || !snap) return
      applyTextResize(t, snap, drag.handle, engine.toPageCoords(pos.x, pos.y), engine.textLayout(snap))
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }

    if (drag.kind === 'group-resize' && drag.handle && drag.startBox) {
      const pg = pageRef.current
      if (!pg || !drag.snapshotStrokes || !drag.snapshotTexts) return
      applyGroupResize(
        pg,
        drag.handle,
        drag.startBox,
        drag.snapshotStrokes,
        drag.snapshotImages ?? [],
        drag.snapshotTexts,
        engine.toPageCoords(pos.x, pos.y),
        (t) => engine.textLayout(t),
      )
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }

    if (drag.kind === 'group-rotate' && drag.startBox) {
      const pg = pageRef.current
      if (!pg || !drag.snapshotStrokes || !drag.snapshotTexts) return
      applyGroupRotation(
        pg,
        drag.startBox,
        drag.snapshotStrokes,
        drag.snapshotImages ?? [],
        drag.snapshotTexts,
        engine.toPageCoords(pos.x, pos.y),
        drag.startAngle ?? 0,
        (t) => engine.textLayout(t),
      )
      pg.updatedAt = Date.now()
      dirtyRef.current = true
      requestRender()
      return
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    const engine = engineRef.current
    const canvas = canvasRef.current
    const drag = dragRef.current
    if (!engine || !canvas) return
    if (pendingTwoFingerRef.current?.id === e.pointerId) {
      pendingTwoFingerRef.current = null
    }
    const multiTouch = activePointersRef.current.size >= 2
    activePointersRef.current.delete(e.pointerId)
    pointerDownPosRef.current.delete(e.pointerId)
    const isOwner = dragOwnerIdRef.current === e.pointerId
    const multiTouchTap =
      dragInterruptedByTouchRef.current &&
      (activePointersRef.current.size >= 1 ||
        Date.now() - multiTouchDownAtRef.current <= TWO_FINGER_TAP_MAX_MS)
    if (drag?.kind === 'pan' && multiTouch && activePointersRef.current.size >= 1) {
      const rem = [...activePointersRef.current.values()][0]
      drag.startX = rem.x
      drag.startY = rem.y
      drag.startPan = { ...panRef.current }
      drag.multiTouch = activePointersRef.current.size >= 2
      canvas.style.cursor = 'grabbing'
    }
    if (drag?.kind === 'pan' && activePointersRef.current.size < 2) {
      pinchRef.current = null
    }
    if (drag?.kind === 'draw') {
      if (isOwner) {
        if (multiTouchTap) {
          engine.endStroke()
        } else {
          const stroke = engine.endStroke()
          const drawPage = pageRef.current
          if (stroke && stroke.points.length >= 2 && drawPage) {
            pushUndo()
            getActiveLayer(drawPage).strokes.push(stroke as Stroke)
            drawPage.updatedAt = Date.now()
            dirtyRef.current = true
          }
        }
      }
    }
    if (drag?.kind === 'region-draw') {
      if (isOwner) {
        if (multiTouchTap) {
          selectionRegionRef.current = null
          delimitedSnapshotRef.current = null
        } else {
          finalizeRegion()
        }
      }
    }
    if (drag?.kind === 'erase') {
      if (isOwner) {
        const session = eraseSessionRef.current
        const pending = erasePendingRef.current
        if (session && pending.to) {
          eraseSegment(pending.from, pending.to, session)
          pending.from = pending.to
          pending.to = null
          requestRender()
        }
        if (session) {
          const changed = session.commit()
          const pg = pageRef.current
          if (pg && changed.length) {
            pushUndo()
            for (const { element, newUrl } of changed) {
              engine.clearImageCache(element.dataUrl)
              element.dataUrl = newUrl
              const ov = engine.getOverrideCanvas(element.id)
              if (ov) engine.setImageOverride(element.id, newUrl, ov)
              engine.warmImage(element.id, newUrl)
            }
            pg.updatedAt = Date.now()
            notebookRef.current!.updatedAt = Date.now()
            dirtyRef.current = true
          }
        }
        eraseSessionRef.current = null
        erasePendingRef.current.to = null
        erasePendingRef.current.scheduled = false
      }
    }
    if (drag?.kind === 'pan') {
      dragRef.current = null
    } else if (isOwner) {
      dragRef.current = null
      dragOwnerIdRef.current = null
      dragInterruptedByTouchRef.current = false
      multiTouchDownAtRef.current = 0
    }

    if (dirtyRef.current) {
      dirtyRef.current = false
      if (notebookRef.current) {
        await persistNotebook(notebookRef.current)
      }
    }
    if (activePointersRef.current.size === 0 && twoFingerDownAtRef.current !== null) {
      const downAt = twoFingerDownAtRef.current
      twoFingerDownAtRef.current = null
      if (Date.now() - downAt <= TWO_FINGER_TAP_MAX_MS) {
        const now = Date.now()
        if (
          lastTwoFingerTapAtRef.current > 0 &&
          now - lastTwoFingerTapAtRef.current <= TWO_FINGER_DOUBLE_TAP_GAP_MS
        ) {
          lastTwoFingerTapAtRef.current = 0
          void useAppStore.getState().undo()
        } else {
          lastTwoFingerTapAtRef.current = now
        }
      }
    }
    if (activePointersRef.current.size === 0 && threeFingerDownAtRef.current !== null) {
      const downAt = threeFingerDownAtRef.current
      threeFingerDownAtRef.current = null
      if (Date.now() - downAt <= TWO_FINGER_TAP_MAX_MS) {
        const now = Date.now()
        if (
          lastThreeFingerTapAtRef.current > 0 &&
          now - lastThreeFingerTapAtRef.current <= TWO_FINGER_DOUBLE_TAP_GAP_MS
        ) {
          lastThreeFingerTapAtRef.current = 0
          void useAppStore.getState().redo()
        } else {
          lastThreeFingerTapAtRef.current = now
        }
      }
    }
    if (drag?.kind === 'pan') {
      canvas.style.cursor = 'grab'
    } else {
      canvas.style.cursor = ''
    }
    requestRender()
    scheduleFollowPage()
  }

  function onWheel(e: WheelEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    if (e.ctrlKey) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, -Math.sign(e.deltaY))
    } else {
      panRef.current = {
        x: panRef.current.x - e.deltaX,
        y: panRef.current.y - e.deltaY,
      }
      requestRender()
    }
    scheduleFollowPage()
  }

  // Selection action handlers (called from toolbar or keyboard)
  const copySelectionRef = useRef(copySelection)
  copySelectionRef.current = copySelection
  const pasteSelectionRef = useRef(pasteSelection)
  pasteSelectionRef.current = pasteSelection
  const duplicateSelectionRef = useRef(duplicateSelection)
  duplicateSelectionRef.current = duplicateSelection
  const deleteSelectionRef = useRef(deleteSelection)
  deleteSelectionRef.current = deleteSelection
  const cutSelectionRef = useRef(cutSelection)
  cutSelectionRef.current = cutSelection
  const finalizeRegionRef = useRef(finalizeRegion)
  finalizeRegionRef.current = finalizeRegion

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const handler = (e: WheelEvent) => onWheel(e)
    canvas.addEventListener('wheel', handler, { passive: false })
    return () => canvas.removeEventListener('wheel', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail === 1) zoomBy(1)
      else if (detail === -1) zoomBy(-1)
      else if (detail === 0) {
        const engine = engineRef.current
        if (engine) fitPage()
      }
    }
    const onRecenter = () => {
      fitPage()
    }
    const onAddPage = () => {
      window.dispatchEvent(new CustomEvent('ink:request-add-page'))
    }
    const onSelectionAction = (e: Event) => {
      const action = (e as CustomEvent).detail as string
      if (action === 'copy') copySelectionRef.current()
      else if (action === 'cut') cutSelectionRef.current()
      else if (action === 'paste') pasteSelectionRef.current()
      else if (action === 'duplicate') duplicateSelectionRef.current()
      else if (action === 'delete') deleteSelectionRef.current()
    }
    const onSelectionRotate = (e: Event) => {
      const { delta } = (e as CustomEvent).detail as { delta: number }
      const engine = engineRef.current
      const pg = pageRef.current
      if (!engine || !pg) return
      const sel = selectionRef.current
      const box = engine.selectionBounds(sel)
      if (!box) return
      if (sel.strokes.size + sel.images.size + sel.texts.size === 0) return
      const snap = snapshotSelected()
      pushUndo()
      rotateGroupBy(pg, box, snap.strokes, snap.images, snap.texts, delta, (t) =>
        engine.textLayout(t),
      )
      pg.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      dirtyRef.current = true
      requestRenderRef.current()
      schedulePersist()
    }
    const onTextUpdate = (e: Event) => {
      const { id, patch } = (e as CustomEvent).detail
      const pg = pageRef.current
      const el = pg ? getActiveLayer(pg).texts.find((t) => t.id === id) : undefined
      if (!el || !pg) return
      Object.assign(el, patch)
      el.createdAt = el.createdAt
      pg.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      dirtyRef.current = true
      requestRenderRef.current()
      schedulePersist()
    }
    const onTextRotate = (e: Event) => {
      const { id, degrees } = (e as CustomEvent).detail
      const pg = pageRef.current
      const el = pg ? getActiveLayer(pg).texts.find((t) => t.id === id) : undefined
      if (!el || !pg) return
      el.rotation = (((degrees % 360) + 360) % 360)
      pg.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      dirtyRef.current = true
      requestRenderRef.current()
      schedulePersist()
    }
    const onTextCommitCenter = () => {
      const ts = useTextStore.getState()
      if (ts.editingExisting) {
        ts.selectText(null)
        ts.setEditingExisting(false)
        ts.setDraft('')
        ts.setDraftRotation(0)
        requestRenderRef.current()
        return
      }
      if (!ts.draft.trim()) return
      const engine = engineRef.current
      const canvas = canvasRef.current
      const pg = pageRef.current
      if (!engine || !canvas || !pg) return
      const rect = canvas.getBoundingClientRect()
      const center = engine.toPageCoords(rect.width / 2, rect.height / 2)
      commitDraftAt(center.x, center.y, true)
    }
    const onTextDelete = () => {
      const ts = useTextStore.getState()
      if (!ts.selectedTextId) return
      const pg = pageRef.current
      const layer = pg ? getActiveLayer(pg) : null
      const idx = layer?.texts.findIndex((t) => t.id === ts.selectedTextId) ?? -1
      if (!layer || idx < 0) return
      pushUndo()
      layer.texts.splice(idx, 1)
      pg!.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      ts.selectText(null)
      ts.setEditingExisting(false)
      ts.setDraft('')
      ts.setDraftRotation(0)
      dirtyRef.current = true
      requestRenderRef.current()
      schedulePersist()
    }
    const onImageRotate = (e: Event) => {
      const degrees = (e as CustomEvent).detail as number
      const pg = pageRef.current
      const id = selectedImageIdRef.current
      if (!pg || !id) return
      const img = getActiveLayer(pg).images.find((i) => i.id === id)
      if (!img) return
      pushUndo()
      img.rotation = (((degrees % 360) + 360) % 360)
      pg.updatedAt = Date.now()
      notebookRef.current!.updatedAt = Date.now()
      dirtyRef.current = true
      requestRenderRef.current()
      schedulePersist()
    }
    const onInkEsc = () => {
      const s = useAppStore.getState()
      if (s.tool !== 'select') return
      cropVersionRef.current++
      const pendingSnap = delimitedSnapshotRef.current
      delimitedSnapshotRef.current = null
      if (pendingSnap) {
        const pg = pageRef.current
        if (pg) {
          const liveLayer = getActiveLayer(pg)
          const snapLayer = getActiveLayer(pendingSnap)
          liveLayer.strokes = snapLayer.strokes
          liveLayer.images = snapLayer.images
          liveLayer.texts = snapLayer.texts
          pg.updatedAt = Date.now()
          notebookRef.current!.updatedAt = Date.now()
          dirtyRef.current = true
          schedulePersist()
        }
      }
      selectionRef.current = { strokes: new Set(), images: new Set(), texts: new Set() }
      selectionRegionRef.current = null
      selectionDragRef.current = null
      setSelectedImageId(null)
      requestRenderRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      const normalized = normalizeKey(e)
      if (normalized) pressedKeysRef.current.add(normalized)

      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const s = useAppStore.getState()
      if (e.key === 'Escape' && s.tool === 'select') {
        e.preventDefault()
        onInkEsc()
        return
      }
      if (s.tool === 'text' && (e.key === 'Delete' || e.key === 'Backspace')) {
        const ts = useTextStore.getState()
        if (ts.selectedTextId) {
          e.preventDefault()
          onTextDelete()
        }
        return
      }
      if (s.tool !== 'select') return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'c') {
          e.preventDefault()
          copySelectionRef.current()
        } else if (key === 'x') {
          e.preventDefault()
          cutSelectionRef.current()
        } else if (key === 'v') {
          e.preventDefault()
          pasteSelectionRef.current()
        } else if (key === 'd') {
          e.preventDefault()
          duplicateSelectionRef.current()
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelectionRef.current()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const normalized = normalizeKey(e)
      if (normalized) pressedKeysRef.current.delete(normalized)
    }
    window.addEventListener('ink:zoom', onZoom)
    window.addEventListener('ink:recenter', onRecenter)
    window.addEventListener('ink:add-page', onAddPage)
    window.addEventListener('ink:selection-action', onSelectionAction)
    window.addEventListener('ink:selection-rotate', onSelectionRotate)
    window.addEventListener('ink:image-rotate', onImageRotate)
    window.addEventListener('ink:text-update', onTextUpdate)
    window.addEventListener('ink:text-rotate', onTextRotate)
    window.addEventListener('ink:text-commit-center', onTextCommitCenter)
    window.addEventListener('ink:text-delete', onTextDelete)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('ink:esc', onInkEsc)
    const onResize = () => {
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null
        fitPage()
      }, 150)
    }
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('ink:zoom', onZoom)
      window.removeEventListener('ink:recenter', onRecenter)
      window.removeEventListener('ink:add-page', onAddPage)
      window.removeEventListener('ink:selection-action', onSelectionAction)
      window.removeEventListener('ink:selection-rotate', onSelectionRotate)
      window.removeEventListener('ink:image-rotate', onImageRotate)
      window.removeEventListener('ink:text-update', onTextUpdate)
      window.removeEventListener('ink:text-rotate', onTextRotate)
      window.removeEventListener('ink:text-commit-center', onTextCommitCenter)
      window.removeEventListener('ink:text-delete', onTextDelete)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('ink:esc', onInkEsc)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      if (resizeTimerRef.current) window.clearTimeout(resizeTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const showToolCursor = !settings.hideToolCursor
  const cursorClass =
    !showToolCursor && (tool === 'pen' || tool === 'highlighter' || tool === 'eraser')
      ? 'cursor-tool-hidden'
      : tool === 'pen'
        ? 'cursor-pen'
        : tool === 'highlighter'
          ? 'cursor-highlighter'
          : tool === 'eraser'
            ? 'cursor-eraser'
            : tool === 'text'
              ? 'cursor-text'
              : tool === 'pan'
                ? 'cursor-pan'
                : 'cursor-select'

  return (
    <div ref={editorRef} className={`editor ${cursorClass}`} onMouseMove={trackMouse}>
      {page ? (
        <>
          <canvas
            ref={canvasRef}
            className="editor-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onMouseDown={(e) => e.preventDefault()}
            style={{ touchAction: 'none' }}
          />
          {showToolCursor && (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') && (
            <ToolCursor
              size={cursorSize(tool, settings)}
              pos={mousePos}
              color={cursorColor(tool, settings)}
              translucent={tool === 'highlighter'}
              exactSize={tool === 'eraser'}
            />
          )}
          {tool === 'text' && inlineText && page && (
            <InlineTextInput
              canvas={canvasRef.current}
              editor={editorRef.current}
              page={page}
              panX={panRef.current.x}
              panY={panRef.current.y}
              zoom={zoomRef.current}
              offset={offsets[currentPageIndex] ?? { x: 0, y: 0 }}
              pageX={inlineText.pageX}
              pageY={inlineText.pageY}
              value={inlineText.value}
              targetId={inlineText.targetId}
              settings={settings}
              onChange={onInlineChange}
              onCommit={commitInlineText}
              onCancel={cancelInlineText}
            />
          )}
          <div className="zoom-controls">
            <button onClick={() => zoomBy(-1)} title={t('editor.zoomOut')}>−</button>
            <span onClick={() => { fitPage() }} title={t('editor.zoomReset')}>
              {zoomDisplay}%
            </span>
            <button onClick={() => zoomBy(1)} title={t('editor.zoomIn')}>+</button>
            <button onClick={recenterPage} title={t('editor.recenterPage')} className="zoom-recenter">
              ◎
            </button>
          </div>
          <div className="page-indicator">
            {t('editor.pageIndicator', { current: currentPageIndex + 1, total: notebook?.pages.length ?? 0 })}
          </div>
        </>
      ) : (
        <div className="editor-empty">
          {t('editor.empty')}
        </div>
      )}
    </div>
  )
}

function cursorSize(tool: ToolKind, settings: ReturnType<typeof useAppStore.getState>['settings']): number {
  if (tool === 'pen') return settings.lastPenSize
  if (tool === 'highlighter') return settings.lastHighlighterSize
  if (tool === 'eraser') return settings.lastEraserSize
  return 0
}

function cursorColor(tool: ToolKind, settings: ReturnType<typeof useAppStore.getState>['settings']): string {
  if (tool === 'pen') return settings.lastPenColor
  if (tool === 'highlighter') return settings.lastHighlighterColor
  return '#9a9ab0'
}

function ToolCursor({
  size,
  pos,
  color,
  translucent,
  exactSize = false,
}: {
  size: number
  pos: { x: number; y: number }
  color: string
  translucent?: boolean
  exactSize?: boolean
}) {
  const diameter = exactSize
    ? Math.max(3, size)
    : Math.max(3, Math.min(56, size * 2.5))
  return (
    <div
      className="tool-cursor"
      style={{
        width: diameter,
        height: diameter,
        transform: `translate(${pos.x - diameter / 2}px, ${pos.y - diameter / 2}px)`,
        borderColor: color,
        background: translucent ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.15)',
      }}
    >
      <span
        className="tool-cursor-center"
        style={{ background: color }}
      />
    </div>
  )
}

function InlineTextInput({
  canvas,
  editor,
  page,
  panX,
  panY,
  zoom,
  offset,
  pageX,
  pageY,
  value,
  targetId,
  settings,
  onChange,
  onCommit,
  onCancel,
}: {
  canvas: HTMLCanvasElement | null
  editor: HTMLDivElement | null
  page: Page
  panX: number
  panY: number
  zoom: number
  offset: PageOffset
  pageX: number
  pageY: number
  value: string
  targetId: string | null
  settings: ReturnType<typeof useAppStore.getState>['settings']
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  if (!canvas || !editor) return null
  const rect = canvas.getBoundingClientRect()
  const editorRect = editor.getBoundingClientRect()
  const rot = ((page.rotation % 360) + 360) % 360
  let x = pageX
  let y = pageY
  if (rot !== 0) {
    const cx = page.width / 2
    const cy = page.height / 2
    const rad = (rot * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const dx = pageX - cx
    const dy = pageY - cy
    x = cx + dx * cos - dy * sin
    y = cy + dx * sin + dy * cos
  }
  const sx = rect.left + panX + (x + offset.x) * zoom
  const sy = rect.top + panY + (y + offset.y) * zoom

  return (
    <textarea
      ref={textareaRef}
      className="inline-text-input"
      placeholder={t('editor.textPlaceholder')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onCommit()
        }
      }}
      onBlur={() => {
        if (!targetId && !value.trim()) {
          onCancel()
        } else {
          onCommit()
        }
      }}
      style={{
        left: sx - editorRect.left,
        top: sy - editorRect.top,
        fontSize: Math.max(13, settings.lastTextFontSize * zoom),
        color: settings.lastTextColor,
        fontFamily: settings.lastTextFontFamily,
        fontStyle: settings.lastTextItalic ? 'italic' : 'normal',
        fontWeight: settings.lastTextBold ? 700 : 400,
        background: settings.lastTextBackground ?? 'rgba(20,20,32,0.85)',
        width: Math.max(220, 420 * zoom),
      }}
    />
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M14 4a10 10 0 1 1-9.8 12" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M14 4a10 10 0 1 1-9.8 12" fill="none" stroke="#333" stroke-width="1.8"/><path d="M4 16l-3-5 6 0z" fill="#333"/></svg>',
)}") 14 14, grab`

function imageResizeCursor(handle: string): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'rotate':
      return ROTATE_CURSOR
    default:
      return 'default'
  }
}

function applyImageResize(img: ImageElement, handle: string, cur: Pt) {
  const cx0 = img.x + img.width / 2
  const cy0 = img.y + img.height / 2
  const w0 = img.width
  const h0 = img.height
  const rad = (img.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = cur.x - cx0
  const dy = cur.y - cy0
  const lx = dx * cos + dy * sin
  const ly = -dx * sin + dy * cos
  const MIN = 20
  let nw = w0
  let nh = h0
  let cxLocal = 0
  let cyLocal = 0

  if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
    const fixedLX = handle === 'nw' || handle === 'sw' ? w0 / 2 : -w0 / 2
    const fixedLY = handle === 'nw' || handle === 'ne' ? h0 / 2 : -h0 / 2
    const scaleW = Math.abs(lx - fixedLX) / w0
    const scaleH = Math.abs(ly - fixedLY) / h0
    const scale = Math.max(scaleW, scaleH, MIN / w0, MIN / h0)
    nw = w0 * scale
    nh = h0 * scale
    const signX = handle === 'ne' || handle === 'se' ? 1 : -1
    const signY = handle === 'sw' || handle === 'se' ? 1 : -1
    const draggedLX = fixedLX + signX * nw
    const draggedLY = fixedLY + signY * nh
    cxLocal = (fixedLX + draggedLX) / 2
    cyLocal = (fixedLY + draggedLY) / 2
  } else if (handle === 'e' || handle === 'w') {
    const fixedX = handle === 'e' ? -w0 / 2 : w0 / 2
    const newX = handle === 'e' ? Math.max(lx, fixedX + MIN) : Math.min(lx, fixedX - MIN)
    nw = Math.abs(newX - fixedX)
    cxLocal = (fixedX + newX) / 2
  } else if (handle === 'n' || handle === 's') {
    const fixedY = handle === 's' ? -h0 / 2 : h0 / 2
    const newY = handle === 's' ? Math.max(ly, fixedY + MIN) : Math.min(ly, fixedY - MIN)
    nh = Math.abs(newY - fixedY)
    cyLocal = (fixedY + newY) / 2
  }

  const newCx = cx0 + cxLocal * cos - cyLocal * sin
  const newCy = cy0 + cxLocal * sin + cyLocal * cos
  img.x = Math.round(newCx - nw / 2)
  img.y = Math.round(newCy - nh / 2)
  img.width = Math.round(nw)
  img.height = Math.round(nh)
}

function rotatePointAround(
  p: { x: number; y: number },
  cx: number,
  cy: number,
  deg: number,
): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }
}

function applyTextResize(
  live: TextElement,
  snap: TextElement,
  handle: string,
  cur: Pt,
  layout: TextLayout,
) {
  const corners = textElementCorners(snap, layout)
  const order = ['nw', 'ne', 'se', 'sw']
  const idx = order.indexOf(handle)
  if (idx < 0) return
  const fixed = corners[(idx + 2) % 4]
  const dragged = corners[idx]
  const distFixed = Math.hypot(fixed.x - dragged.x, fixed.y - dragged.y)
  const distCur = Math.hypot(fixed.x - cur.x, fixed.y - cur.y)
  if (distFixed < 1) return
  const ratio = Math.max(0.2, Math.min(4, distCur / distFixed))
  const newSize = Math.max(8, Math.round(snap.fontSize * ratio))
  const scale = newSize / snap.fontSize
  const rad = (snap.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = (fixed.x - (snap.x + layout.w / 2)) * cos + (fixed.y - (snap.y + layout.h / 2)) * sin
  const localY = -(fixed.x - (snap.x + layout.w / 2)) * sin + (fixed.y - (snap.y + layout.h / 2)) * cos
  const newW = layout.w * scale
  const newH = layout.h * scale
  const newCx = fixed.x - localX * scale * cos + localY * scale * sin
  const newCy = fixed.y - localX * scale * sin - localY * scale * cos
  live.fontSize = newSize
  live.width = Math.max(1, Math.round(snap.width * scale))
  live.x = Math.round(newCx - newW / 2)
  live.y = Math.round(newCy - newH / 2)
}

function computeUniformScale(handle: string, box: Rect, cur: Pt): number {
  const MIN = 1
  const sx0 = handle === 'e' || handle === 'w' ? 1 : box.w
  const sy0 = handle === 'n' || handle === 's' ? 1 : box.h
  const fixedX = handle === 'w' || handle === 'nw' || handle === 'sw' ? box.x + box.w : box.x
  const fixedY = handle === 'n' || handle === 'nw' || handle === 'ne' ? box.y + box.h : box.y
  let sx = sx0
  let sy = sy0
  if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
    sx = Math.abs(cur.x - fixedX) / Math.max(MIN, box.w)
    sy = Math.abs(cur.y - fixedY) / Math.max(MIN, box.h)
    return Math.max(Math.max(sx, sy), 0.05)
  }
  if (handle === 'e' || handle === 'w') {
    sx = Math.abs(cur.x - fixedX) / Math.max(MIN, box.w)
    return Math.max(sx, 0.05)
  }
  sy = Math.abs(cur.y - fixedY) / Math.max(MIN, box.h)
  return Math.max(sy, 0.05)
}

function applyGroupResize(
  pg: Page,
  handle: string,
  startBox: Rect,
  strokes: Stroke[],
  images: ImageElement[],
  texts: TextElement[],
  cur: Pt,
  measure: (t: TextElement) => TextLayout,
) {
  const scale = computeUniformScale(handle, startBox, cur)
  const fixedX = handle === 'w' || handle === 'nw' || handle === 'sw' ? startBox.x + startBox.w : startBox.x
  const fixedY = handle === 'n' || handle === 'nw' || handle === 'ne' ? startBox.y + startBox.h : startBox.y
  const liveLayer = getActiveLayer(pg)
  for (const s of strokes) {
    const live = liveLayer.strokes.find((e) => e.id === s.id)
    if (!live) continue
    live.points = s.points.map((p) => ({
      ...p,
      x: fixedX + (p.x - fixedX) * scale,
      y: fixedY + (p.y - fixedY) * scale,
    }))
  }
  for (const img of images) {
    const live = liveLayer.images.find((e) => e.id === img.id)
    if (!live) continue
    const cx = img.x + img.width / 2
    const cy = img.y + img.height / 2
    const nx = fixedX + (cx - fixedX) * scale
    const ny = fixedY + (cy - fixedY) * scale
    live.x = Math.round(nx - (img.width * scale) / 2)
    live.y = Math.round(ny - (img.height * scale) / 2)
    live.width = Math.max(20, Math.round(img.width * scale))
    live.height = Math.max(20, Math.round(img.height * scale))
  }
  for (const t of texts) {
    const live = liveLayer.texts.find((e) => e.id === t.id)
    if (!live) continue
    const layout = measure(t)
    const cx = t.x + layout.w / 2
    const cy = t.y + layout.h / 2
    const nx = fixedX + (cx - fixedX) * scale
    const ny = fixedY + (cy - fixedY) * scale
    live.x = Math.round(nx - (layout.w * scale) / 2)
    live.y = Math.round(ny - (layout.h * scale) / 2)
    live.fontSize = Math.max(8, Math.round(t.fontSize * scale))
    live.width = Math.max(1, Math.round(t.width * scale))
  }
}

function applyGroupRotation(
  pg: Page,
  startBox: Rect,
  strokes: Stroke[],
  images: ImageElement[],
  texts: TextElement[],
  cur: Pt,
  startAngle: number,
  measure: (t: TextElement) => TextLayout,
) {
  const cx = startBox.x + startBox.w / 2
  const cy = startBox.y + startBox.h / 2
  const curAngle = (Math.atan2(cur.y - cy, cur.x - cx) * 180) / Math.PI
  const delta = ((curAngle - startAngle) % 360 + 540) % 360 - 180
  rotateGroupBy(pg, startBox, strokes, images, texts, delta, measure)
}

function rotateGroupBy(
  pg: Page,
  box: Rect,
  strokes: Stroke[],
  images: ImageElement[],
  texts: TextElement[],
  delta: number,
  measure: (t: TextElement) => TextLayout,
) {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (Math.abs(delta) < 0.05) return
  const liveLayer = getActiveLayer(pg)
  for (const s of strokes) {
    const live = liveLayer.strokes.find((e) => e.id === s.id)
    if (!live) continue
    live.points = s.points.map((p) => {
      const r = rotatePointAround(p, cx, cy, delta)
      return { ...p, x: r.x, y: r.y }
    })
  }
  for (const img of images) {
    const live = liveLayer.images.find((e) => e.id === img.id)
    if (!live) continue
    const c = rotatePointAround(
      { x: img.x + img.width / 2, y: img.y + img.height / 2 },
      cx,
      cy,
      delta,
    )
    live.x = Math.round(c.x - img.width / 2)
    live.y = Math.round(c.y - img.height / 2)
    live.rotation = Math.round(((img.rotation + delta) % 360 + 360) % 360)
  }
  for (const t of texts) {
    const live = liveLayer.texts.find((e) => e.id === t.id)
    if (!live) continue
    const layout = measure(t)
    const c = rotatePointAround(
      { x: t.x + layout.w / 2, y: t.y + layout.h / 2 },
      cx,
      cy,
      delta,
    )
    live.x = Math.round(c.x - layout.w / 2)
    live.y = Math.round(c.y - layout.h / 2)
    live.rotation = Math.round(((t.rotation + delta) % 360 + 360) % 360)
  }
}

function splitStrokeByCircle(stroke: Stroke, cx: number, cy: number, r: number): Stroke[] {
  const pts = stroke.points
  if (pts.length === 0) return []
  const inside = (p: { x: number; y: number }) =>
    (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) <= r * r
  const chunks: { x: number; y: number; pressure: number }[][] = []
  let cur: { x: number; y: number; pressure: number }[] = []

  const flush = () => {
    if (cur.length > 0) {
      chunks.push(cur)
      cur = []
    }
  }

  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      if (!inside(pts[0])) cur.push(pts[0])
      continue
    }
    const a = pts[i - 1]
    const b = pts[i]
    const ai = inside(a)
    const bi = inside(b)
    if (ai && bi) continue
    if (!ai && !bi) {
      if (distToSegment(cx, cy, a.x, a.y, b.x, b.y) >= r) {
        cur.push(b)
        continue
      }
      const ips = segmentCircleIntersections(a, b, cx, cy, r)
      if (ips) {
        cur.push(pointAt(a, b, ips.t1))
        flush()
        cur.push(pointAt(a, b, ips.t2))
        cur.push(b)
      } else {
        cur.push(b)
      }
      continue
    }
    const ip = segmentCircleIntersection(a, b, cx, cy, r)
    if (ai && !bi) {
      if (ip) cur.push(ip)
      cur.push(b)
    } else {
      if (ip) cur.push(ip)
      flush()
    }
  }
  flush()

  return chunks.map((chunk) => ({
    ...stroke,
    id: newId(),
    points: chunk,
  }))
}

function segmentCircleIntersection(
  a: { x: number; y: number; pressure: number },
  b: { x: number; y: number; pressure: number },
  cx: number,
  cy: number,
  r: number,
): { x: number; y: number; pressure: number } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - cx
  const fy = a.y - cy
  const A = dx * dx + dy * dy
  if (A === 0) return null
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const sqrt = Math.sqrt(disc)
  let t = (-B + sqrt) / (2 * A)
  if (t < 0 || t > 1) t = (-B - sqrt) / (2 * A)
  t = clamp(t, 0, 1)
  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
    pressure: (a.pressure + b.pressure) / 2,
  }
}

function segmentCircleIntersections(
  a: { x: number; y: number; pressure: number },
  b: { x: number; y: number; pressure: number },
  cx: number,
  cy: number,
  r: number,
): { t1: number; t2: number } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - cx
  const fy = a.y - cy
  const A = dx * dx + dy * dy
  if (A === 0) return null
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return null
  const sqrt = Math.sqrt(disc)
  const t1 = (-B - sqrt) / (2 * A)
  const t2 = (-B + sqrt) / (2 * A)
  if (t1 <= 0 || t2 >= 1) return null
  return { t1, t2 }
}

function pointAt(
  a: { x: number; y: number; pressure: number },
  b: { x: number; y: number; pressure: number },
  t: number,
): { x: number; y: number; pressure: number } {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
  }
}

// ---- Geometry helpers ----

function circleCenterRadius(region: SelectionRegion): { cx: number; cy: number; r: number } | null {
  if (region.type !== 'circle' || region.points.length < 2) return null
  const a = region.points[0]
  const b = region.points[1]
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    r: Math.hypot(b.x - a.x, b.y - a.y) / 2,
  }
}

// ---- Delimited-only selection helpers (split strokes + crop images) ----

function segmentSegmentParam(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const d1x = b.x - a.x
  const d1y = b.y - a.y
  const d2x = d.x - c.x
  const d2y = d.y - c.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((c.x - a.x) * d2y - (c.y - a.y) * d2x) / denom
  const u = ((c.x - a.x) * d1y - (c.y - a.y) * d1x) / denom
  if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) return t
  return null
}

function segmentCircleRoots(a: Pt, b: Pt, cx: number, cy: number, r: number): number[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - cx
  const fy = a.y - cy
  const A = dx * dx + dy * dy
  if (A === 0) return []
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - r * r
  const disc = B * B - 4 * A * C
  if (disc < 0) return []
  const sqrt = Math.sqrt(disc)
  const t1 = (-B - sqrt) / (2 * A)
  const t2 = (-B + sqrt) / (2 * A)
  const out: number[] = []
  if (t1 > 1e-6 && t1 < 1 - 1e-6) out.push(t1)
  if (t2 > 1e-6 && t2 < 1 - 1e-6) out.push(t2)
  return out
}

function segmentRegionCrossings(a: StrokePoint, b: StrokePoint, region: SelectionRegion): number[] {
  if (region.type === 'circle' && region.points.length >= 2) {
    const c = circleCenterRadius(region)
    if (!c) return []
    return segmentCircleRoots(a, b, c.cx, c.cy, c.r)
  }
  const edges = regionEdges(region)
  if (!edges) return []
  const raw: number[] = []
  for (const [c, d] of edges) {
    const t = segmentSegmentParam(a, b, c, d)
    if (t !== null) raw.push(t)
  }
  raw.sort((x, y) => x - y)
  const out: number[] = []
  for (const t of raw) {
    if (out.length === 0 || Math.abs(t - out[out.length - 1]) > 1e-6) out.push(t)
  }
  return out
}

function splitStrokeByRegion(stroke: Stroke, region: SelectionRegion): { inside: Stroke[]; outside: Stroke[] } {
  const pts = stroke.points
  const empty: { inside: Stroke[]; outside: Stroke[] } = { inside: [], outside: [] }
  if (pts.length === 0) return empty
  if (pts.length === 1) {
    if (pointInRegion(pts[0], region)) return { inside: [stroke], outside: [] }
    return { inside: [], outside: [stroke] }
  }

  const poly: StrokePoint[] = [pts[0]]
  const flags: boolean[] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const crossings = segmentRegionCrossings(a, b, region)
    if (crossings.length === 0) {
      const mid = pointAt(a, b, 0.5)
      flags.push(pointInRegion(mid, region))
      poly.push(b)
      continue
    }
    let prevT = 0
    for (const t of crossings) {
      const p = pointAt(a, b, t)
      const mid = pointAt(a, b, (prevT + t) / 2)
      flags.push(pointInRegion(mid, region))
      poly.push(p)
      prevT = t
    }
    const mid = pointAt(a, b, (prevT + 1) / 2)
    flags.push(pointInRegion(mid, region))
    poly.push(b)
  }

  const chunks: StrokePoint[][] = []
  const chunkFlags: boolean[] = []
  let cur: StrokePoint[] = [poly[0]]
  let curFlag = flags[0]
  for (let i = 0; i < flags.length; i++) {
    if (i > 0 && flags[i] !== curFlag) {
      chunks.push(cur)
      chunkFlags.push(curFlag)
      cur = [poly[i]]
      curFlag = flags[i]
    }
    cur.push(poly[i + 1])
  }
  chunks.push(cur)
  chunkFlags.push(curFlag)

  if (chunks.length === 1) {
    if (chunkFlags[0]) return { inside: [stroke], outside: [] }
    return { inside: [], outside: [stroke] }
  }

  const inside: Stroke[] = []
  const outside: Stroke[] = []
  for (let k = 0; k < chunks.length; k++) {
    const s: Stroke = { ...stroke, id: newId(), points: chunks[k] }
    if (chunkFlags[k]) inside.push(s)
    else outside.push(s)
  }
  return { inside, outside }
}

function imageFullyInsideRegion(img: ImageElement, region: SelectionRegion): boolean {
  const corners = imageCorners(img)
  if (!corners.some((c) => pointInRegion(c, region))) return false
  return !regionBoundaryIntersectsImage(corners, region)
}

function loadImageEl(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

type CropResult =
  | { kind: 'whole' }
  | { kind: 'cropped'; inside: ImageElement; outside: ImageElement }
  | { kind: 'none' }

async function cropImageToRegion(img: ImageElement, region: SelectionRegion): Promise<CropResult> {
  if (img.width <= 0 || img.height <= 0) return { kind: 'none' }
  const im = await loadImageEl(img.dataUrl)
  if (!im || im.naturalWidth === 0 || im.naturalHeight === 0) return { kind: 'whole' }
  const natW = im.naturalWidth
  const natH = im.naturalHeight
  const scaleX = natW / img.width
  const scaleY = natH / img.height

  const rad = -((img.rotation * Math.PI) / 180)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = img.x + img.width / 2
  const cy = img.y + img.height / 2

  const toLocal = (p: Pt) => {
    const dx = p.x - cx
    const dy = p.y - cy
    return { x: dx * cos - dy * sin + img.width / 2, y: dx * sin + dy * cos + img.height / 2 }
  }
  const localToPage = (lx: number, ly: number) => {
    const dx = lx - img.width / 2
    const dy = ly - img.height / 2
    return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos }
  }

  let localPts: Pt[]
  if (region.type === 'circle' && region.points.length >= 2) {
    const c = circleCenterRadius(region)
    if (!c) return { kind: 'none' }
    localPts = []
    for (let i = 0; i < 64; i++) {
      const ang = (i / 64) * Math.PI * 2
      localPts.push(toLocal({ x: c.cx + Math.cos(ang) * c.r, y: c.cy + Math.sin(ang) * c.r }))
    }
  } else if (region.type === 'rect' && region.points.length >= 2) {
    const a = toLocal(region.points[0])
    const b = toLocal(region.points[1])
    const x1 = Math.min(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const x2 = Math.max(a.x, b.x)
    const y2 = Math.max(a.y, b.y)
    localPts = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ]
  } else if (region.type === 'free' && region.points.length >= 3) {
    localPts = region.points.map(toLocal)
  } else {
    return { kind: 'none' }
  }

  const natPts = localPts.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of natPts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  minX = Math.max(0, minX)
  minY = Math.max(0, minY)
  maxX = Math.min(natW, maxX)
  maxY = Math.min(natH, maxY)
  const bw = maxX - minX
  const bh = maxY - minY
  if (bw < 1 || bh < 1) return { kind: 'none' }

  if (minX <= 0.5 && minY <= 0.5 && maxX >= natW - 0.5 && maxY >= natH - 0.5) {
    return { kind: 'whole' }
  }

  const work = document.createElement('canvas')
  work.width = natW
  work.height = natH
  const wctx = work.getContext('2d')
  if (!wctx) return { kind: 'whole' }
  wctx.save()
  wctx.beginPath()
  wctx.moveTo(natPts[0].x, natPts[0].y)
  for (let i = 1; i < natPts.length; i++) wctx.lineTo(natPts[i].x, natPts[i].y)
  wctx.closePath()
  wctx.clip()
  wctx.drawImage(im, 0, 0, natW, natH)
  wctx.restore()

  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(bw))
  out.height = Math.max(1, Math.round(bh))
  const octx = out.getContext('2d')
  if (!octx) return { kind: 'whole' }
  octx.drawImage(work, minX, minY, bw, bh, 0, 0, out.width, out.height)

  const dataUrl = out.toDataURL('image/png')

  const outsideCanvas = document.createElement('canvas')
  outsideCanvas.width = natW
  outsideCanvas.height = natH
  const octx2 = outsideCanvas.getContext('2d')
  if (!octx2) return { kind: 'whole' }
  octx2.drawImage(im, 0, 0, natW, natH)
  octx2.save()
  octx2.globalCompositeOperation = 'destination-out'
  octx2.beginPath()
  octx2.moveTo(natPts[0].x, natPts[0].y)
  for (let i = 1; i < natPts.length; i++) octx2.lineTo(natPts[i].x, natPts[i].y)
  octx2.closePath()
  octx2.fill()
  octx2.restore()
  const outsideDataUrl = outsideCanvas.toDataURL('image/png')

  const lminX = minX / scaleX
  const lminY = minY / scaleY
  const lw = bw / scaleX
  const lh = bh / scaleY
  const center = localToPage(lminX + lw / 2, lminY + lh / 2)
  return {
    kind: 'cropped',
    inside: {
      ...img,
      id: newId(),
      dataUrl,
      x: center.x - lw / 2,
      y: center.y - lh / 2,
      width: lw,
      height: lh,
    },
    outside: {
      ...img,
      dataUrl: outsideDataUrl,
    },
  }
}

function pointInRegion(p: Pt, region: SelectionRegion): boolean {
  if (region.type === 'rect' && region.points.length >= 2) {
    const a = region.points[0]
    const b = region.points[1]
    return (
      p.x >= Math.min(a.x, b.x) &&
      p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) &&
      p.y <= Math.max(a.y, b.y)
    )
  }
  if (region.type === 'circle' && region.points.length >= 2) {
    const c = circleCenterRadius(region)
    if (!c) return false
    return Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r
  }
  if (region.type === 'free' && region.points.length >= 3) {
    return pointInPolygon(p.x, p.y, region.points)
  }
  return false
}

function strokeInRegion(stroke: Stroke, region: SelectionRegion): boolean {
  const pts = stroke.points
  for (let i = 0; i < pts.length; i++) {
    if (pointInRegion(pts[i], region)) return true
    if (i > 0) {
      const a = pts[i - 1]
      const b = pts[i]
      const segLen = Math.hypot(b.x - a.x, b.y - a.y)
      const step = Math.max(2, segLen / Math.max(1, Math.ceil(segLen / 4)))
      for (let t = step; t < segLen; t += step) {
        const p = { x: a.x + ((b.x - a.x) * t) / segLen, y: a.y + ((b.y - a.y) * t) / segLen }
        if (pointInRegion(p, region)) return true
      }
    }
  }
  return false
}

function imageInRegion(img: ImageElement, region: SelectionRegion): boolean {
  const center = { x: img.x + img.width / 2, y: img.y + img.height / 2 }
  if (pointInRegion(center, region)) return true
  const corners = imageCorners(img)
  for (const c of corners) {
    if (pointInRegion(c, region)) return true
  }
  return regionBoundaryIntersectsImage(corners, region) || regionPointInsideImage(region, corners)
}

function regionBoundaryIntersectsImage(corners: Pt[], region: SelectionRegion): boolean {
  if (region.type === 'circle' && region.points.length >= 2) {
    const c = circleCenterRadius(region)
    if (!c) return false
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % corners.length]
      if (distToSegment(c.cx, c.cy, a.x, a.y, b.x, b.y) <= c.r) return true
    }
    return false
  }
  const edges = regionEdges(region)
  if (!edges) return false
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % corners.length]
    for (const [c, d] of edges) {
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function regionEdges(region: SelectionRegion): [Pt, Pt][] | null {
  if (region.type === 'rect' && region.points.length >= 2) {
    const a = region.points[0]
    const b = region.points[1]
    const x1 = Math.min(a.x, b.x)
    const y1 = Math.min(a.y, b.y)
    const x2 = Math.max(a.x, b.x)
    const y2 = Math.max(a.y, b.y)
    return [
      [{ x: x1, y: y1 }, { x: x2, y: y1 }],
      [{ x: x2, y: y1 }, { x: x2, y: y2 }],
      [{ x: x2, y: y2 }, { x: x1, y: y2 }],
      [{ x: x1, y: y2 }, { x: x1, y: y1 }],
    ]
  }
  if (region.type === 'free' && region.points.length >= 3) {
    const pts = region.points
    const edges: [Pt, Pt][] = []
    for (let i = 0; i < pts.length; i++) {
      edges.push([pts[i], pts[(i + 1) % pts.length]])
    }
    return edges
  }
  return null
}

function regionPointInsideImage(region: SelectionRegion, corners: Pt[]): boolean {
  const p = regionAnchorPoint(region)
  if (!p) return false
  return pointInPolygon(p.x, p.y, corners)
}

function regionAnchorPoint(region: SelectionRegion): Pt | null {
  if (region.points.length === 0) return null
  if (region.type === 'circle' && region.points.length >= 2) {
    const c = circleCenterRadius(region)
    if (c) return { x: c.cx, y: c.cy }
  }
  if (region.type === 'rect' && region.points.length >= 2) {
    const a = region.points[0]
    const b = region.points[1]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  return region.points[0]
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(a, b, c)) return true
  if (o2 === 0 && onSegment(a, b, d)) return true
  if (o3 === 0 && onSegment(c, d, a)) return true
  if (o4 === 0 && onSegment(c, d, b)) return true
  return false
}

function orient(a: Pt, b: Pt, p: Pt): number {
  const d = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (d > 1e-9) return 1
  if (d < -1e-9) return -1
  return 0
}

function onSegment(a: Pt, b: Pt, p: Pt): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  )
}

let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement('canvas')
    measureCtx = c.getContext('2d')!
  }
  return measureCtx
}

function textCorners(t: TextElement): Pt[] {
  return textElementCorners(t, measureTextElement(getMeasureCtx(), t))
}

function textInRegion(t: TextElement, region: SelectionRegion): boolean {
  if (!t.text || !t.text.trim()) return false
  const corners = textCorners(t)
  if (corners.length < 4) return false
  const center = {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  }
  if (pointInRegion(center, region)) return true
  for (const c of corners) {
    if (pointInRegion(c, region)) return true
  }
  return false
}

function imageCorners(img: ImageElement): Pt[] {
  const cx = img.x + img.width / 2
  const cy = img.y + img.height / 2
  const hw = img.width / 2
  const hh = img.height / 2
  const rad = (img.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rot = (dx: number, dy: number): Pt => ({
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  })
  return [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)]
}

function pointInPolygon(px: number, py: number, polygon: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function circleIntersectsImageRect(img: ImageElement, cx: number, cy: number, r: number): boolean {
  const x = Math.min(img.x, img.x + img.width)
  const y = Math.min(img.y, img.y + img.height)
  const w = Math.abs(img.width)
  const h = Math.abs(img.height)
  const closestX = Math.max(x, Math.min(cx, x + w))
  const closestY = Math.max(y, Math.min(cy, y + h))
  return (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY) <= r * r
}

function strokeIntersectsCircle(stroke: Stroke, cx: number, cy: number, r: number): boolean {
  const pts = stroke.points
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - cx
    const dy = pts[i].y - cy
    if (dx * dx + dy * dy <= r * r) return true
    if (i > 0) {
      const a = pts[i - 1]
      const b = pts[i]
      if (distToSegment(cx, cy, a.x, a.y, b.x, b.y) <= r) return true
    }
  }
  return false
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
