import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { getActiveLayer } from '../types'
import type { Layer } from '../types'
import { useI18n } from '../i18n'

const DEFAULT_NAME_RE = /^Camada (\d+)$/

export function LayersPanel() {
  const { t } = useI18n()
  const notebook = useAppStore((s) =>
    s.notebooks.find((n) => n.id === s.selectedNotebookId),
  )
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const addLayer = useAppStore((s) => s.addLayer)
  const renameLayer = useAppStore((s) => s.renameLayer)
  const duplicateLayer = useAppStore((s) => s.duplicateLayer)
  const deleteLayer = useAppStore((s) => s.deleteLayer)
  const moveLayer = useAppStore((s) => s.moveLayer)
  const setLayerVisible = useAppStore((s) => s.setLayerVisible)
  const setLayerOpacity = useAppStore((s) => s.setLayerOpacity)
  const setLayerLocked = useAppStore((s) => s.setLayerLocked)
  const setActiveLayer = useAppStore((s) => s.setActiveLayer)
  const mergeSelectedLayers = useAppStore((s) => s.mergeSelectedLayers)

  const page = notebook?.pages[currentPageIndex]
  const layers = page?.layers ?? []
  const activeLayer = page ? getActiveLayer(page) : null
  const activeIndex = activeLayer ? layers.findIndex((l) => l.id === activeLayer.id) : -1

  const display: Layer[] = [...layers].reverse()

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null)

  const anchorIdRef = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressClickRef = useRef(false)
  const dragLayerIdRef = useRef<string | null>(null)
  const dropBeforeRef = useRef<string | null>(null)
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dropIndicatorY, setDropIndicatorY] = useState<number | null>(null)

  useEffect(() => {
    setSelectedIds([])
    setRenamingId(null)
    anchorIdRef.current = null
  }, [currentPageIndex, notebook?.id])

  function displayName(layer: Layer): string {
    const m = DEFAULT_NAME_RE.exec(layer.name)
    if (m) return t('layers.layerN', { n: m[1] })
    return layer.name
  }

  function isModifier(e: React.MouseEvent): boolean {
    return e.ctrlKey || e.metaKey
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectRange(clickedId: string) {
    const order = display.map((l) => l.id)
    const clickedPos = order.indexOf(clickedId)
    const anchorPos = anchorIdRef.current !== null ? order.indexOf(anchorIdRef.current) : -1
    if (clickedPos === -1 || anchorPos === -1) {
      setSelectedIds([clickedId])
      anchorIdRef.current = clickedId
      return
    }
    const [from, to] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos]
    setSelectedIds(order.slice(from, to + 1))
  }

  function onItemClick(e: React.MouseEvent, layer: Layer) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    void setActiveLayer(layer.id)
    if (e.shiftKey) {
      selectRange(layer.id)
      return
    }
    if (isModifier(e)) {
      toggleSelect(layer.id)
      return
    }
    setSelectedIds([layer.id])
    anchorIdRef.current = layer.id
  }

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function onItemPointerDown(e: React.PointerEvent, layer: Layer) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    suppressClickRef.current = false
    longPressFiredRef.current = false
    pressStartRef.current = { x: e.clientX, y: e.clientY }
    if (e.pointerType === 'touch') {
      cancelLongPress()
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        longPressFiredRef.current = true
        suppressClickRef.current = true
        toggleSelect(layer.id)
      }, 500)
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function computeSlot(clientY: number): { before: string | null; y: number } {
    const scroller = scrollerRef.current
    if (!scroller) return { before: null, y: clientY }
    const sr = scroller.getBoundingClientRect()
    const rows: HTMLElement[] = []
    for (const el of Array.from(scroller.querySelectorAll('[data-layer-id]'))) {
      const rowEl = el as HTMLElement
      if (dragLayerIdRef.current && rowEl.dataset.layerId === dragLayerIdRef.current) continue
      rows.push(rowEl)
    }
    const slots: Array<{ before: string | null; y: number }> = []
    for (const el of rows) {
      slots.push({ before: el.dataset.layerId ?? null, y: el.getBoundingClientRect().top })
    }
    if (rows.length > 0) {
      slots.push({ before: null, y: rows[rows.length - 1].getBoundingClientRect().bottom })
    }
    let best: { before: string | null; y: number } = slots[0] ?? { before: null, y: clientY }
    let bestDist = Infinity
    for (const s of slots) {
      const d = Math.abs(clientY - s.y)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return { before: best.before, y: best.y - sr.top + scroller.scrollTop }
  }

  function updateDropPosition(e: React.PointerEvent) {
    const scroller = scrollerRef.current
    if (scroller) {
      const sr = scroller.getBoundingClientRect()
      const zone = 36
      if (e.clientY < sr.top + zone) scroller.scrollTop -= 12
      else if (e.clientY > sr.bottom - zone) scroller.scrollTop += 12
    }
    const slot = computeSlot(e.clientY)
    dropBeforeRef.current = slot.before
    setDropIndicatorY(slot.y)
  }

  function onItemPointerMove(e: React.PointerEvent, layer: Layer) {
    if (longPressFiredRef.current) return
    const start = pressStartRef.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!dragLayerIdRef.current) {
      if (e.pointerType === 'touch' && dist > 8) cancelLongPress()
      const threshold = e.pointerType === 'mouse' ? 6 : 12
      if (dist > threshold) {
        cancelLongPress()
        dragLayerIdRef.current = layer.id
        setDragLayerId(layer.id)
        suppressClickRef.current = true
        updateDropPosition(e)
      }
    } else {
      updateDropPosition(e)
    }
  }

  function finishDrop(draggedId: string) {
    const before = dropBeforeRef.current
    const from = layers.findIndex((l) => l.id === draggedId)
    if (from === -1) return
    let to: number
    if (before !== null) {
      const belowIdx = layers.findIndex((l) => l.id === before)
      to = belowIdx >= 0 ? belowIdx + 1 : layers.length
    } else {
      to = 0
    }
    if (to !== from) void moveLayer(from, to)
  }

  function onItemPointerUp(e: React.PointerEvent) {
    cancelLongPress()
    if (dragLayerIdRef.current) finishDrop(dragLayerIdRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    resetDragUi()
  }

  function resetDragUi() {
    dragLayerIdRef.current = null
    pressStartRef.current = null
    dropBeforeRef.current = null
    setDragLayerId(null)
    setDropIndicatorY(null)
  }

  function startRename(layer: Layer) {
    setRenamingId(layer.id)
    setRenameValue(layer.name)
  }

  function commitRename() {
    const id = renamingId
    setRenamingId(null)
    if (id === null) return
    const idx = layers.findIndex((l) => l.id === id)
    if (idx === -1) return
    const name = renameValue.trim()
    if (!name) return
    void renameLayer(idx, name)
  }

  const activeOpacity = activeIndex >= 0 ? (layers[activeIndex]?.opacity ?? 1) : 1
  const displayOpacity = opacityDraft ?? Math.round(activeOpacity * 100)

  function commitOpacity() {
    if (opacityDraft === null || activeIndex < 0) return
    void setLayerOpacity(activeIndex, opacityDraft / 100)
    setOpacityDraft(null)
  }

  async function handleMerge() {
    if (selectedIds.length < 2) return
    const indices = selectedIds
      .map((id) => layers.findIndex((l) => l.id === id))
      .filter((i) => i >= 0)
    if (indices.length < 2) return
    await mergeSelectedLayers(indices)
    setSelectedIds([])
  }

  if (!page) return null

  const mergeDisabled = selectedIds.length < 2
  const selectedCount = selectedIds.length

  return (
    <aside className="layers-panel" data-version={dataVersion}>
      <div className="layer-panel-header">
        <span>{t('layers.panelTitle')}</span>
        <button className="icon-btn" title={t('layers.add')} onClick={() => void addLayer()}>
          <PlusIcon />
        </button>
      </div>

      <div className="layer-actions">
        <button
          className="icon-btn"
          title={t('layers.add')}
          onClick={() => void addLayer()}
        >
          <PlusIcon />
        </button>
        <button
          className="icon-btn"
          title={t('layers.duplicate')}
          disabled={activeIndex < 0}
          onClick={() => activeIndex >= 0 && void duplicateLayer(activeIndex)}
        >
          <CopyIcon />
        </button>
        <button
          className="icon-btn"
          title={t('layers.delete')}
          disabled={layers.length <= 1}
          onClick={() => activeIndex >= 0 && void deleteLayer(activeIndex)}
        >
          <TrashIcon />
        </button>
        <button
          className="layer-merge-btn"
          disabled={mergeDisabled}
          onClick={() => void handleMerge()}
        >
          {selectedCount >= 2
            ? t('layers.mergeCount', { count: selectedCount })
            : t('layers.merge')}
        </button>
      </div>

      <div className="layer-opacity-row">
        <label className="layer-opacity-label" htmlFor="layer-opacity">
          {t('layers.opacity')}
        </label>
        <input
          id="layer-opacity"
          className="layer-opacity-input"
          type="range"
          min={0}
          max={100}
          value={displayOpacity}
          disabled={activeIndex < 0}
          onChange={(e) => setOpacityDraft(Number(e.target.value))}
          onPointerUp={commitOpacity}
          onPointerCancel={commitOpacity}
          onBlur={commitOpacity}
          onKeyUp={commitOpacity}
        />
        <span className="layer-opacity-value">{displayOpacity}%</span>
      </div>

      <div ref={scrollerRef} className="layer-scroll">
        {display.length === 0 && <div className="layer-empty">{t('layers.add')}</div>}
        {display.map((layer) => {
          const isActive = layer.id === activeLayer?.id
          const isSelected = selectedIds.includes(layer.id)
          const isDragging = dragLayerId === layer.id
          return (
            <div
              key={layer.id}
              data-layer-id={layer.id}
              className={`layer-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${layer.locked ? 'locked' : ''} ${isDragging ? 'dragging' : ''}`}
              onPointerDown={(e) => onItemPointerDown(e, layer)}
              onPointerMove={(e) => onItemPointerMove(e, layer)}
              onPointerUp={onItemPointerUp}
              onPointerCancel={onItemPointerUp}
              onClick={(e) => onItemClick(e, layer)}
            >
              <button
                className="layer-icon-btn"
                title={t('layers.toggleVisible')}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  const idx = layers.findIndex((l) => l.id === layer.id)
                  if (idx >= 0) void setLayerVisible(idx, !layer.visible)
                }}
              >
                {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                className="layer-icon-btn"
                title={layer.locked ? t('layers.unlock') : t('layers.lock')}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  const idx = layers.findIndex((l) => l.id === layer.id)
                  if (idx >= 0) void setLayerLocked(idx, !layer.locked)
                }}
              >
                {layer.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              {renamingId === layer.id ? (
                <input
                  className="layer-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span
                  className="layer-name"
                  title={layer.name}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startRename(layer)
                  }}
                >
                  {displayName(layer)}
                </span>
              )}
            </div>
          )
        })}
        {dragLayerId !== null && dropIndicatorY !== null && (
          <div className="layer-drop-indicator" style={{ top: dropIndicatorY }} />
        )}
      </div>

      <div className="layer-footer" title={t('layers.backgroundHint')}>
        <span
          className="layer-bg-swatch"
          style={{ background: page.backgroundColor }}
        />
        <span>{t('layers.background')}</span>
      </div>
    </aside>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function UnlockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )
}
