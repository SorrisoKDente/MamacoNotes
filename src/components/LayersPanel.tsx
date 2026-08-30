import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { getActiveLayer } from '../types'
import type { Layer, LayerFolder } from '../types'
import { useI18n } from '../i18n'
import { confirmAction, promptName } from './Modals'

const DEFAULT_NAME_RE = /^Camada (\d+)$/

export function LayersPanel() {
  const { t } = useI18n()
  const notebook = useAppStore((s) => s.activeNotebook)
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const layersWidth = useAppStore((s) => s.settings.layersWidth)
  const setSettings = useAppStore((s) => s.setSettings)
  const addLayer = useAppStore((s) => s.addLayer)
  const renameLayer = useAppStore((s) => s.renameLayer)
  const duplicateLayer = useAppStore((s) => s.duplicateLayer)
  const deleteLayer = useAppStore((s) => s.deleteLayer)
  const setLayerVisible = useAppStore((s) => s.setLayerVisible)
  const setLayerOpacity = useAppStore((s) => s.setLayerOpacity)
  const setLayerLocked = useAppStore((s) => s.setLayerLocked)
  const setActiveLayer = useAppStore((s) => s.setActiveLayer)
  const mergeSelectedLayers = useAppStore((s) => s.mergeSelectedLayers)
  const moveLayerToFolder = useAppStore((s) => s.moveLayerToFolder)
  const addLayerFolder = useAppStore((s) => s.addLayerFolder)
  const renameLayerFolder = useAppStore((s) => s.renameLayerFolder)
  const deleteLayerFolder = useAppStore((s) => s.deleteLayerFolder)
  const reorderLayerFolder = useAppStore((s) => s.reorderLayerFolder)
  const setLastClicked = useAppStore((s) => s.setLastClicked)

  const page = notebook?.pages[currentPageIndex]
  const layers = page?.layers ?? []
  const folders = page?.layerFolders ?? []
  const activeLayer = page ? getActiveLayer(page) : null
  const activeIndex = activeLayer ? layers.findIndex((l: Layer) => l.id === activeLayer.id) : -1
  const sortedFolders = [...folders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [opacityDraft, setOpacityDraft] = useState<number | null>(null)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)

  const anchorIdRef = useRef<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressClickRef = useRef(false)
  const dragLayerIdRef = useRef<string | null>(null)
  const dragFolderIdRef = useRef<string | null>(null)
  const dropBeforeRef = useRef<string | null>(null)
  const dropIntoFolderRef = useRef<string | null>(null)
  const selectedFolderIdRef = useRef<string | null>(null)
  const [dragLayerId, setDragLayerId] = useState<string | null>(null)
  const [dragFolderId, setDragFolderId] = useState<string | null>(null)
  const [dropIndicatorY, setDropIndicatorY] = useState<number | null>(null)
  const [dropIntoFolder, setDropIntoFolder] = useState<string | null>(null)
  const [dropRootActive, setDropRootActive] = useState(false)
  selectedFolderIdRef.current = selectedFolderId
  const selectedFolder = folders.find((f: LayerFolder) => f.id === selectedFolderId) ?? null

  useEffect(() => {
    setSelectedIds([])
    setRenamingId(null)
    setSelectedFolderId(null)
    setRenamingFolderId(null)
    setCollapsedFolderIds(new Set())
    setMenuOpen(null)
    anchorIdRef.current = null
  }, [currentPageIndex, notebook?.id])

  useEffect(() => {
    const onRename = () => {
      const s = useAppStore.getState()
      if (!s.layersOpen) return
      const last = s.lastClicked
      const nb = s.activeNotebook
      const page = nb?.pages[s.currentPageIndex]
      if (last) {
        if (last.type === 'layerFolder') {
          const folder = (page?.layerFolders ?? []).find((f: LayerFolder) => f.id === last.id)
          if (folder) {
            setRenamingFolderId(folder.id)
            setFolderRenameValue(folder.name)
          }
          return
        }
        if (last.type === 'layer') {
          const layer = page?.layers.find((l: Layer) => l.id === last.id)
          if (layer) {
            setRenamingId(layer.id)
            setRenameValue(layer.name)
          }
          return
        }
        return
      }
      if (
        s.selectedIds.length > 0 || s.selectedFolderId || s.selectedNotebookId
      ) {
        return
      }
      if (!page) return
      const folderId = selectedFolderIdRef.current
      if (folderId) {
        const folder = (page.layerFolders ?? []).find((f: LayerFolder) => f.id === folderId)
        if (folder) {
          setRenamingFolderId(folder.id)
          setFolderRenameValue(folder.name)
          return
        }
      }
      if (page.layers.length === 0) return
      const target = getActiveLayer(page)
      setRenamingId(target.id)
      setRenameValue(target.name)
    }
    window.addEventListener('ink:rename', onRename)
    return () => window.removeEventListener('ink:rename', onRename)
  }, [])

  useEffect(() => {
    const onEsc = () => {
      setMenuOpen(null)
      setMenuPos(null)
    }
    window.addEventListener('ink:esc', onEsc)
    return () => window.removeEventListener('ink:esc', onEsc)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onScroll = () => {
      setMenuOpen(null)
      setMenuPos(null)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (menuRef.current && menuRef.current.contains(target)) return
      if (menuAnchorRef.current && menuAnchorRef.current.contains(target)) return
      setMenuOpen(null)
      setMenuPos(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [menuOpen])

  useLayoutEffect(() => {
    if (!menuOpen || !menuPos || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const margin = 8
    let top = menuPos.top
    let left = menuPos.left
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    if (rect.left < margin) {
      left = el.offsetWidth + margin
    } else if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top < margin) top = margin
    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }, [menuOpen, menuPos])

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
    const order = [...layers].reverse().map((l) => l.id)
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
    setSelectedFolderId(null)
    if (e.shiftKey) {
      setLastClicked(null)
      selectRange(layer.id)
      return
    }
    if (isModifier(e)) {
      setLastClicked(null)
      toggleSelect(layer.id)
      return
    }
    setSelectedIds([layer.id])
    anchorIdRef.current = layer.id
    setLastClicked({ type: 'layer', id: layer.id })
  }

  function onFolderClick(folder: LayerFolder) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    toggleFolderCollapsed(folder.id)
    setSelectedFolderId(folder.id)
    setLastClicked({ type: 'layerFolder', id: folder.id })
  }

  function toggleFolderCollapsed(id: string) {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
        setLastClicked(null)
        toggleSelect(layer.id)
      }, 500)
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function onFolderPointerDown(e: React.PointerEvent, folder: LayerFolder) {
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
        setLastClicked({ type: 'layerFolder', id: folder.id })
        setSelectedFolderId(folder.id)
      }, 500)
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  function rowFromPoint(
    x: number,
    y: number,
  ): { type: 'layer' | 'folder' | 'root'; id: string | null } | null {
    const els = document.elementsFromPoint(x, y)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue
      if (el.closest('[data-root-zone]')) return { type: 'root', id: null }
      const rowEl = el.closest('.layer-folder-row, .layer-item')
      if (!(rowEl instanceof HTMLElement)) continue
      if (rowEl.classList.contains('layer-folder-row')) {
        const id = rowEl.dataset.folderId ?? null
        if (id) return { type: 'folder', id }
      } else {
        const id = rowEl.dataset.layerId ?? null
        if (id) return { type: 'layer', id }
      }
    }
    return null
  }

  function computeLayerSlot(clientY: number): { before: string | null; y: number } {
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

  function computeFolderSlot(clientY: number): { before: string | null; y: number } {
    const scroller = scrollerRef.current
    if (!scroller) return { before: null, y: clientY }
    const sr = scroller.getBoundingClientRect()
    const rows: HTMLElement[] = []
    for (const el of Array.from(scroller.querySelectorAll('[data-folder-id]'))) {
      const rowEl = el as HTMLElement
      if (dragFolderIdRef.current && rowEl.dataset.folderId === dragFolderIdRef.current) continue
      rows.push(rowEl)
    }
    const slots: Array<{ before: string | null; y: number }> = []
    for (const el of rows) {
      slots.push({ before: el.dataset.folderId ?? null, y: el.getBoundingClientRect().top })
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

  function autoscroll(e: React.PointerEvent) {
    const scroller = scrollerRef.current
    if (scroller) {
      const sr = scroller.getBoundingClientRect()
      const zone = 36
      if (e.clientY < sr.top + zone) scroller.scrollTop -= 12
      else if (e.clientY > sr.bottom - zone) scroller.scrollTop += 12
    }
  }

  function updateLayerDropPosition(e: React.PointerEvent) {
    autoscroll(e)
    const row = rowFromPoint(e.clientX, e.clientY)
    if (row && row.type === 'folder') {
      dropIntoFolderRef.current = row.id
      dropBeforeRef.current = null
      setDropIntoFolder(row.id)
      setDropRootActive(false)
      setDropIndicatorY(null)
      return
    }
    if (row && row.type === 'root') {
      dropIntoFolderRef.current = null
      dropBeforeRef.current = null
      setDropIntoFolder(null)
      setDropRootActive(true)
      setDropIndicatorY(null)
      return
    }
    if (row && row.type === 'layer' && row.id !== dragLayerIdRef.current) {
      dropIntoFolderRef.current = null
      dropBeforeRef.current = row.id
      setDropIntoFolder(null)
      setDropRootActive(false)
      const scroller = scrollerRef.current
      const el = scroller?.querySelector(`[data-layer-id="${row.id}"]`)
      if (el instanceof HTMLElement && scroller) {
        const sr = scroller.getBoundingClientRect()
        setDropIndicatorY(el.getBoundingClientRect().top - sr.top + scroller.scrollTop)
      }
      return
    }
    const slot = computeLayerSlot(e.clientY)
    dropIntoFolderRef.current = null
    dropBeforeRef.current = slot.before
    setDropIntoFolder(null)
    setDropRootActive(false)
    setDropIndicatorY(slot.y)
  }

  function updateFolderDropPosition(e: React.PointerEvent) {
    autoscroll(e)
    const slot = computeFolderSlot(e.clientY)
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
        updateLayerDropPosition(e)
      }
    } else {
      updateLayerDropPosition(e)
    }
  }

  function onFolderPointerMove(e: React.PointerEvent, folder: LayerFolder) {
    if (longPressFiredRef.current) return
    const start = pressStartRef.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!dragFolderIdRef.current) {
      if (e.pointerType === 'touch' && dist > 8) cancelLongPress()
      const threshold = e.pointerType === 'mouse' ? 6 : 12
      if (dist > threshold) {
        cancelLongPress()
        dragFolderIdRef.current = folder.id
        setDragFolderId(folder.id)
        suppressClickRef.current = true
        updateFolderDropPosition(e)
      }
    } else {
      updateFolderDropPosition(e)
    }
  }

  function finishLayerDrop(draggedId: string) {
    const before = dropBeforeRef.current
    const intoFolder = dropIntoFolderRef.current
    const from = layers.findIndex((l: Layer) => l.id === draggedId)
    if (from === -1) return
    if (intoFolder !== null) {
      void moveLayerToFolder(from, intoFolder, null)
    } else {
      const beforeLayer = before ? layers.find((l: Layer) => l.id === before) : undefined
      const targetFolder = beforeLayer ? (beforeLayer.folderId ?? null) : null
      void moveLayerToFolder(from, targetFolder, before)
    }
  }

  function finishFolderDrop(folderId: string) {
    const before = dropBeforeRef.current
    void reorderLayerFolder(folderId, before)
  }

  function onPointerUp(e: React.PointerEvent) {
    cancelLongPress()
    if (dragLayerIdRef.current) finishLayerDrop(dragLayerIdRef.current)
    else if (dragFolderIdRef.current) finishFolderDrop(dragFolderIdRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    resetDragUi()
  }

  function resetDragUi() {
    dragLayerIdRef.current = null
    dragFolderIdRef.current = null
    pressStartRef.current = null
    dropBeforeRef.current = null
    dropIntoFolderRef.current = null
    setDragLayerId(null)
    setDragFolderId(null)
    setDropIndicatorY(null)
    setDropIntoFolder(null)
    setDropRootActive(false)
  }

  function startRename(layer: Layer) {
    setRenamingId(layer.id)
    setRenameValue(layer.name)
  }

  function commitRename() {
    const id = renamingId
    setRenamingId(null)
    if (id === null) return
    const idx = layers.findIndex((l: Layer) => l.id === id)
    if (idx === -1) return
    const name = renameValue.trim()
    if (!name) return
    void renameLayer(idx, name)
  }

  function startFolderRename(folder: LayerFolder) {
    setRenamingFolderId(folder.id)
    setFolderRenameValue(folder.name)
  }

  function commitFolderRename() {
    const id = renamingFolderId
    setRenamingFolderId(null)
    if (id === null) return
    const name = folderRenameValue.trim()
    if (!name) return
    void renameLayerFolder(id, name)
  }

  async function handleNewFolder() {
    const name = await promptName(t('layers.newFolderPrompt'))
    if (name && name.trim()) await addLayerFolder(name.trim())
  }

  async function handleDeleteFolder(folder: LayerFolder) {
    const ok = await confirmAction(
      t('layers.deleteFolderConfirm', { name: folder.name }),
    )
    if (!ok) return
    void deleteLayerFolder(folder.id)
    if (selectedFolderId === folder.id) setSelectedFolderId(null)
  }

  function openFolderMenu(folderId: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (menuOpen === folderId) {
      setMenuOpen(null)
      setMenuPos(null)
      return
    }
    const btn = e.currentTarget as HTMLElement
    menuAnchorRef.current = btn
    const rect = btn.getBoundingClientRect()
    setMenuOpen(folderId)
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 4 })
  }

  function onResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    setResizing(true)
  }

  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing || !asideRef.current) return
    const rect = asideRef.current.getBoundingClientRect()
    const maxAllowed = Math.min(420, Math.round(window.innerWidth * 0.5))
    const next = Math.min(maxAllowed, Math.max(180, Math.round(rect.right - e.clientX)))
    setDragWidth(next)
  }

  function onResizeEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    setResizing(false)
    const final = dragWidth
    setDragWidth(null)
    if (final !== null) void setSettings({ layersWidth: final })
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
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
      .map((id) => layers.findIndex((l: Layer) => l.id === id))
      .filter((i) => i >= 0)
    if (indices.length < 2) return
    await mergeSelectedLayers(indices)
    setSelectedIds([])
  }

  if (!page) return null

  const mergeDisabled = selectedIds.length < 2
  const selectedCount = selectedIds.length
  const hasLayers = layers.length > 0
  const rootLayers = layers.filter((l: Layer) => (l.folderId ?? null) === null)
  const addTarget = selectedFolder ? selectedFolder.id : undefined

  function renderLayerRow(layer: Layer) {
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
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => onItemClick(e, layer)}
      >
        <button
          className="layer-icon-btn"
          title={t('layers.toggleVisible')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const idx = layers.findIndex((l: Layer) => l.id === layer.id)
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
            const idx = layers.findIndex((l: Layer) => l.id === layer.id)
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
  }

  function renderFolderRow(folder: LayerFolder) {
    const isCollapsed = collapsedFolderIds.has(folder.id)
    const isSelected = selectedFolderId === folder.id
    const isDragging = dragFolderId === folder.id
    const isDropTarget = dropIntoFolder === folder.id
    const folderLayerRows = layers
      .filter((l: Layer) => (l.folderId ?? null) === folder.id)
      .reverse()
      .map((layer: Layer) => renderLayerRow(layer))
    return (
      <Fragment key={folder.id}>
        <div
          data-folder-id={folder.id}
          className={`layer-folder-row ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
          onPointerDown={(e) => onFolderPointerDown(e, folder)}
          onPointerMove={(e) => onFolderPointerMove(e, folder)}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={() => onFolderClick(folder)}
          onContextMenu={(e) => {
            if (dragFolderIdRef.current) e.preventDefault()
          }}
        >
          <span className={`chevron ${isCollapsed ? '' : 'open'}`} />
          <FolderIcon />
          {renamingFolderId === folder.id ? (
            <input
              className="layer-folder-rename-input"
              autoFocus
              value={folderRenameValue}
              onChange={(e) => setFolderRenameValue(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitFolderRename()
                if (e.key === 'Escape') setRenamingFolderId(null)
              }}
              onBlur={commitFolderRename}
            />
          ) : (
            <span
              className="layer-folder-name"
              title={folder.name}
              onDoubleClick={(e) => {
                e.stopPropagation()
                startFolderRename(folder)
              }}
            >
              {folder.name}
            </span>
          )}
          <button
            className="row-menu"
            title={t('layers.renameFolder')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => openFolderMenu(folder.id, e)}
          >
            <span className="icon icon-dots" />
          </button>
        </div>
        {menuOpen === folder.id && (
          <div
            ref={menuRef}
            className="row-menu-popup row-menu-popup-fixed"
            style={{ top: menuPos?.top ?? 0, left: menuPos?.left ?? 0 }}
          >
            <button
              onClick={() => {
                startFolderRename(folder)
                setMenuOpen(null)
                setMenuPos(null)
              }}
            >
              {t('layers.renameFolder')}
            </button>
            <button
              onClick={() => {
                void handleDeleteFolder(folder)
                setMenuOpen(null)
                setMenuPos(null)
              }}
            >
              {t('layers.deleteFolder')}
            </button>
          </div>
        )}
        {!isCollapsed && (
          <div className="layer-folder-children">
            {folderLayerRows.length === 0 && (
              <div className="layer-folder-empty">{t('layers.folderEmpty')}</div>
            )}
            {folderLayerRows}
          </div>
        )}
      </Fragment>
    )
  }

  return (
    <aside
      ref={asideRef}
      className="layers-panel"
      data-version={dataVersion}
      style={{ '--layers-w': `${dragWidth ?? layersWidth}px` } as React.CSSProperties}
    >
      <div className="layer-panel-header">
        <span>{t('layers.panelTitle')}</span>
        <div className="layer-header-btns">
          <button className="icon-btn" title={t('layers.newFolder')} onClick={() => void handleNewFolder()}>
            <IconFolderPlus />
          </button>
          <button className="icon-btn" title={t('layers.add')} onClick={() => void addLayer(addTarget)}>
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="layer-actions">
        <button
          className="icon-btn"
          title={t('layers.add')}
          onClick={() => void addLayer(addTarget)}
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
        {!hasLayers && <div className="layer-empty">{t('layers.add')}</div>}
        {sortedFolders.map((folder) => renderFolderRow(folder))}
        {hasLayers &&
          rootLayers
            .slice()
            .reverse()
            .map((layer: Layer) => renderLayerRow(layer))}
        {dragLayerId !== null && (
          <div className={`layer-root-zone ${dropRootActive ? 'drop-target' : ''}`} data-root-zone>
            <span className="layer-root-zone-line" />
          </div>
        )}
        {(dragLayerId !== null || dragFolderId !== null) && dropIndicatorY !== null && (
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

      <div
        className={`layers-resizer ${resizing ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        title={t('layers.resizePanel')}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
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

function IconFolderPlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <circle cx="18" cy="6" r="3.4" fill="currentColor" stroke="none" />
      <path d="M18 4.4v3.2M16.4 6h3.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="layer-folder-icon">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}
