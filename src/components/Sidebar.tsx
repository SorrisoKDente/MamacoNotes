import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppStore, sortFoldersByOrder, sortNotebooksByOrder } from '../store'
import { useUiStore } from '../uiStore'
import type { Folder } from '../types'
import { confirmDeleteScope, promptName } from './Modals'
import { isMobileNow } from '../hooks/useIsMobile'
import { useI18n } from '../i18n'

export function Sidebar() {
  const { t } = useI18n()
  const folders = useAppStore((s) => s.folders)
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const clipboard = useAppStore((s) => s.clipboard)
  const selectFolder = useAppStore((s) => s.selectFolder)
  const selectNotebook = useAppStore((s) => s.selectNotebook)
  const toggleSelect = useAppStore((s) => s.toggleSelect)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const setSelectedIds = useAppStore((s) => s.setSelectedIds)
  const copySelected = useAppStore((s) => s.copySelected)
  const cutSelected = useAppStore((s) => s.cutSelected)
  const pasteClipboard = useAppStore((s) => s.pasteClipboard)
  const duplicateSelected = useAppStore((s) => s.duplicateSelected)
  const deleteSelected = useAppStore((s) => s.deleteSelected)
  const deleteFolder = useAppStore((s) => s.deleteFolder)
  const deleteNotebook = useAppStore((s) => s.deleteNotebook)
  const duplicateNotebook = useAppStore((s) => s.duplicateNotebook)
  const duplicateFolder = useAppStore((s) => s.duplicateFolder)
  const renameFolder = useAppStore((s) => s.renameFolder)
  const reorderNotebook = useAppStore((s) => s.reorderNotebook)
  const reorderFolder = useAppStore((s) => s.reorderFolder)
  const hidePageCount = useAppStore((s) => s.settings.hidePageCount)
  const sidebarWidth = useAppStore((s) => s.settings.sidebarWidth)
  const setSettings = useAppStore((s) => s.setSettings)
  const { open } = useUiStore()

  const [expanded, setExpanded] = useState<Set<string | null>>(new Set([null]))
  const [menuOpen, setMenuOpen] = useState<{ type: 'folder' | 'notebook'; id: string } | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const anchorRef = useRef<string | null>(null)
  const [nameTip, setNameTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const nameTipRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const [resizing, setResizing] = useState(false)
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  type DragItem = { type: 'folder' | 'notebook'; id: string }
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragItemRef = useRef<DragItem | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressClickRef = useRef(false)
  const dropBeforeRef = useRef<string | null>(null)
  const dropIntoRef = useRef<string | null>(null)
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropIntoFolder, setDropIntoFolder] = useState<string | null>(null)
  const [dropIndicatorY, setDropIndicatorY] = useState<number | null>(null)

  function showNameTooltip(e: React.MouseEvent, text: string) {
    if (dragItemRef.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setNameTip({ text, x: rect.right + 8, y: rect.top + rect.height / 2 })
  }

  function hideNameTooltip() {
    setNameTip(null)
  }

  useLayoutEffect(() => {
    if (!nameTip || !nameTipRef.current) return
    const el = nameTipRef.current
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left = nameTip.x
    let top = nameTip.y
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, nameTip.x - rect.width - 16)
    }
    if (top + rect.height / 2 > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - margin - rect.height / 2)
    }
    if (top - rect.height / 2 < margin) {
      top = Math.max(margin, rect.height / 2 + margin)
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [nameTip])

  function openRowMenu(type: 'folder' | 'notebook', id: string, e: React.MouseEvent) {
    if (menuOpen?.id === id) {
      setMenuOpen(null)
      setMenuPos(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    menuAnchorRef.current = e.currentTarget as HTMLElement
    setMenuOpen({ type, id })
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
    const maxAllowed = Math.min(520, Math.round(window.innerWidth * 0.5))
    const next = Math.min(maxAllowed, Math.max(160, Math.round(e.clientX - rect.left)))
    setDragWidth(next)
  }

  function onResizeEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    setResizing(false)
    const final = dragWidth
    setDragWidth(null)
    if (final !== null) void setSettings({ sidebarWidth: final })
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    const onEsc = () => setMenuOpen(null)
    window.addEventListener('ink:esc', onEsc)
    return () => window.removeEventListener('ink:esc', onEsc)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onScroll = () => setMenuOpen(null)
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

  function toggleExpand(id: string | null) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function isModifier(e: React.MouseEvent): boolean {
    return e.ctrlKey || e.metaKey
  }

  function orderedVisibleIds(): string[] {
    const result: string[] = []
    const visitFolder = (folder: Folder) => {
      result.push(folder.id)
      if (expanded.has(folder.id)) {
        for (const child of folders.filter((f) => f.parentId === folder.id)) visitFolder(child)
        for (const childNb of notebooks.filter((n) => n.folderId === folder.id)) {
          result.push(childNb.id)
        }
      }
    }
    const rootFolders = folders.filter((f) => f.parentId === null)
    const rootNotebooks = notebooks.filter((n) => n.folderId === null)
    for (const folder of rootFolders) visitFolder(folder)
    for (const nb of rootNotebooks) result.push(nb.id)
    return result
  }

  function selectRange(clickedId: string) {
    const ordered = orderedVisibleIds()
    const clickedPos = ordered.indexOf(clickedId)
    const anchorPos = anchorRef.current !== null ? ordered.indexOf(anchorRef.current) : -1
    if (clickedPos === -1 || anchorPos === -1) {
      setSelectedIds([clickedId])
      anchorRef.current = clickedId
      return
    }
    const [from, to] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos]
    setSelectedIds(ordered.slice(from, to + 1))
  }

  function resetAnchor() {
    anchorRef.current = null
  }

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function groupKey(item: DragItem): string | null {
    return item.type === 'notebook'
      ? notebooks.find((n) => n.id === item.id)?.folderId ?? null
      : folders.find((f) => f.id === item.id)?.parentId ?? null
  }

  function siblingIds(item: DragItem): string[] {
    const gk = groupKey(item)
    const list =
      item.type === 'notebook'
        ? sortNotebooksByOrder(notebooks.filter((n) => (n.folderId ?? null) === gk))
        : sortFoldersByOrder(folders.filter((f) => (f.parentId ?? null) === gk))
    return list.map((x) => x.id)
  }

  function isDescendant(folderId: string, ancestorId: string): boolean {
    let cur = folders.find((f) => f.id === folderId)?.parentId ?? null
    while (cur) {
      if (cur === ancestorId) return true
      cur = folders.find((f) => f.id === cur)?.parentId ?? null
    }
    return false
  }

  function rowFromPoint(x: number, y: number): { type: DragItem['type']; id: string } | null {
    const els = document.elementsFromPoint(x, y)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue
      const rowEl = el.closest('.sidebar-folder-row, .sidebar-notebook-row')
      if (!(rowEl instanceof HTMLElement)) continue
      const itemEl = rowEl.querySelector('.sidebar-item')
      const id = (itemEl as HTMLElement | null)?.dataset.id
      if (!id) continue
      const type = rowEl.classList.contains('sidebar-folder-row') ? 'folder' : 'notebook'
      return { type, id }
    }
    return null
  }

  function computeSlot(item: DragItem, clientY: number): { nextId: string | null; y: number } {
    const scroller = scrollerRef.current
    if (!scroller) return { nextId: null, y: clientY }
    const sr = scroller.getBoundingClientRect()
    const groupIds = siblingIds(item)
    const slots: Array<{ nextId: string | null; y: number }> = []
    for (const sid of groupIds) {
      const el = scroller.querySelector(`[data-row-id="${sid}"]`)
      if (el instanceof HTMLElement) slots.push({ nextId: sid, y: el.getBoundingClientRect().top })
    }
    if (slots.length > 0) {
      const lastEl = scroller.querySelector(`[data-row-id="${groupIds[groupIds.length - 1]}"]`)
      if (lastEl instanceof HTMLElement) {
        slots.push({ nextId: null, y: lastEl.getBoundingClientRect().bottom })
      }
    }
    let best: { nextId: string | null; y: number } = { nextId: null, y: clientY }
    let bestDist = Infinity
    for (const s of slots) {
      const d = Math.abs(clientY - s.y)
      if (d < bestDist) {
        bestDist = d
        best = s
      }
    }
    return { nextId: best.nextId, y: best.y - sr.top + scroller.scrollTop }
  }

  function updateDropPosition(e: React.PointerEvent) {
    const item = dragItemRef.current
    if (!item) return
    const scroller = scrollerRef.current
    if (scroller) {
      const sr = scroller.getBoundingClientRect()
      const zone = 36
      if (e.clientY < sr.top + zone) scroller.scrollTop -= 12
      else if (e.clientY > sr.bottom - zone) scroller.scrollTop += 12
    }
    let into: string | null = null
    let before: string | null = null
    let y: number | null = null
    let allowed = false
    const row = rowFromPoint(e.clientX, e.clientY)
    if (row && row.id !== item.id) {
      if (row.type === 'folder') {
        if (item.type === 'folder') {
          const rowParent = folders.find((f) => f.id === row.id)?.parentId ?? null
          if (isDescendant(row.id, item.id)) {
            allowed = false
          } else if (rowParent === groupKey(item)) {
            const slot = computeSlot(item, e.clientY)
            before = slot.nextId
            y = slot.y
            allowed = true
          } else {
            into = row.id
            allowed = true
          }
        } else {
          into = row.id
          allowed = true
        }
      } else if (item.type === 'notebook') {
        const rowFolder = notebooks.find((n) => n.id === row.id)?.folderId ?? null
        if (rowFolder === groupKey(item)) {
          const slot = computeSlot(item, e.clientY)
          before = slot.nextId
          y = slot.y
          allowed = true
        }
      }
    } else if (!row || row.id === item.id) {
      const slot = computeSlot(item, e.clientY)
      before = slot.nextId
      y = slot.y
      allowed = true
    }
    dropBeforeRef.current = allowed ? before : null
    dropIntoRef.current = allowed ? into : null
    setDropIntoFolder(allowed ? into : null)
    setDropIndicatorY(allowed ? y : null)
  }

  function onItemPointerDown(e: React.PointerEvent, id: string) {
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
        toggleSelect(id)
      }, 500)
    }
  }

  function onItemPointerMove(e: React.PointerEvent, type: DragItem['type'], id: string) {
    if (longPressFiredRef.current) return
    const start = pressStartRef.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!dragItemRef.current) {
      if (e.pointerType === 'touch' && dist > 8) cancelLongPress()
      const threshold = e.pointerType === 'mouse' ? 6 : 12
      if (dist > threshold) {
        cancelLongPress()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
        dragItemRef.current = { type, id }
        setDragItem({ type, id })
        suppressClickRef.current = true
        updateDropPosition(e)
      }
    } else {
      updateDropPosition(e)
    }
  }

  function resetDragUi() {
    dragItemRef.current = null
    pressStartRef.current = null
    setDragItem(null)
    setDropIntoFolder(null)
    setDropIndicatorY(null)
    dropBeforeRef.current = null
    dropIntoRef.current = null
  }

  function finishDrop(item: DragItem) {
    const into = dropIntoRef.current
    const before = dropBeforeRef.current
    if (into) {
      if (item.type === 'notebook') void reorderNotebook(item.id, into, null)
      else void reorderFolder(item.id, into, null)
    } else if (before !== null && before !== item.id) {
      const gk = groupKey(item)
      if (item.type === 'notebook') void reorderNotebook(item.id, gk, before)
      else void reorderFolder(item.id, gk, before)
    }
    suppressClickRef.current = true
  }

  function onItemPointerUp(e: React.PointerEvent) {
    cancelLongPress()
    if (dragItemRef.current) finishDrop(dragItemRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    resetDragUi()
  }

  function onItemClick(e: React.MouseEvent, type: DragItem['type'], id: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (type === 'notebook') {
      if (e.shiftKey) {
        selectRange(id)
        return
      }
      if (isModifier(e)) {
        toggleSelect(id)
        return
      }
      clearSelection()
      anchorRef.current = id
      const nb = notebooks.find((n) => n.id === id)
      if (nb?.folderId) selectFolder(nb.folderId)
      selectNotebook(id)
      if (isMobileNow()) useAppStore.getState().setSidebarOpen(false)
    } else {
      if (e.shiftKey) {
        selectRange(id)
        return
      }
      if (isModifier(e)) {
        toggleSelect(id)
        return
      }
      clearSelection()
      anchorRef.current = id
      toggleExpand(id)
    }
  }

  async function renameNotebook(id: string) {
    const nb = notebooks.find((n) => n.id === id)
    if (!nb) return
    const name = await promptName(t('sidebar.renameNotePrompt'), nb.name)
    if (name && name.trim()) {
      useAppStore.getState().updateNotebook({ ...nb, name: name.trim() })
    }
  }

  async function handleDeleteNotebook(id: string, name: string) {
    const scope = await confirmDeleteScope({ kind: 'notebook', name })
    if (!scope) return
    await deleteNotebook(id, scope)
  }

  async function handleDeleteFolder(folder: Folder) {
    const scope = await confirmDeleteScope({ kind: 'folder', name: folder.name })
    if (!scope) return
    await deleteFolder(folder.id, scope)
  }

  async function handleDeleteSelected() {
    const ids = useAppStore.getState().selectedIds
    if (ids.length === 0) return
    const scope = await confirmDeleteScope({
      kind: 'multi',
      name: t('sidebar.itemsSelectedName', { count: ids.length }),
    })
    if (!scope) return
    await deleteSelected(scope)
  }

  async function promptNewFolder(parentId: string | null) {
    const name = await promptName(t('sidebar.newFolderPrompt'))
    if (name && name.trim()) {
      void useAppStore.getState().addFolder(name.trim(), parentId)
    }
  }

  async function renameFolderName(id: string) {
    const folder = folders.find((f) => f.id === id)
    if (!folder) return
    const name = await promptName(t('sidebar.renameFolderPrompt'), folder.name)
    if (name && name.trim()) {
      void renameFolder(id, name.trim())
    }
  }

  function renderNotebookRow(nb: { id: string; name: string; folderId: string | null; pages: { length: number } }) {
    const isSelected = selectedIds.includes(nb.id)
    return (
      <div
        key={nb.id}
        data-row-id={nb.id}
        className={`sidebar-notebook-row ${dragItem?.id === nb.id ? 'dragging' : ''}`}
      >
        <button
          className={`sidebar-item notebook ${selectedNotebookId === nb.id ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
          data-id={nb.id}
          title={t('sidebar.dragHint')}
          onMouseEnter={(e) => showNameTooltip(e, nb.name)}
          onMouseLeave={hideNameTooltip}
          onPointerDown={(e) => onItemPointerDown(e, nb.id)}
          onPointerMove={(e) => onItemPointerMove(e, 'notebook', nb.id)}
          onPointerUp={onItemPointerUp}
          onPointerCancel={onItemPointerUp}
          onContextMenu={(e) => {
            if (longPressFiredRef.current || dragItemRef.current) e.preventDefault()
          }}
          onClick={(e) => onItemClick(e, 'notebook', nb.id)}
        >
          <span className="icon icon-book" />
          <span className="notebook-name">{nb.name}</span>
          {!hidePageCount && <span className="page-count">{nb.pages.length}</span>}
        </button>
        <button
          className="row-menu"
          title={t('sidebar.options')}
          onClick={(e) => openRowMenu('notebook', nb.id, e)}
        >
          <span className="icon icon-dots" />
        </button>
        {menuOpen?.type === 'notebook' && menuOpen.id === nb.id && (
          <div ref={menuRef} className="row-menu-popup row-menu-popup-fixed" style={{ top: menuPos?.top ?? 0, left: menuPos?.left ?? 0 }}>
            <button onClick={() => { renameNotebook(nb.id); setMenuOpen(null) }}>{t('sidebar.rename')}</button>
            <button onClick={() => { open('copyNotebook', { id: nb.id }); setMenuOpen(null) }}>{t('sidebar.copyToFolder')}</button>
            <button onClick={() => { open('moveNotebook', { id: nb.id }); setMenuOpen(null) }}>{t('sidebar.moveToFolder')}</button>
            <button onClick={() => { void duplicateNotebook(nb.id); setMenuOpen(null) }}>{t('sidebar.duplicate')}</button>
            <button
              onClick={() => {
                void handleDeleteNotebook(nb.id, nb.name)
                setMenuOpen(null)
              }}
            >
              {t('sidebar.deleteNotebook')}
            </button>
          </div>
        )}
      </div>
    )
  }

  function renderFolder(folder: Folder) {
    const childFolders = folders.filter((f) => f.parentId === folder.id)
    const childNotebooks = notebooks.filter((n) => n.folderId === folder.id)
    const isSelected = selectedIds.includes(folder.id)
    return (
      <div key={folder.id} className="sidebar-folder-block">
        <div
          data-row-id={folder.id}
          className={`sidebar-folder-row ${dragItem?.id === folder.id ? 'dragging' : ''} ${dropIntoFolder === folder.id ? 'drop-target' : ''}`}
        >
          <button
            className={`sidebar-item folder ${isSelected ? 'selected' : ''}`}
            data-id={folder.id}
            title={t('sidebar.dragHint')}
            onMouseEnter={(e) => showNameTooltip(e, folder.name)}
            onMouseLeave={hideNameTooltip}
            onPointerDown={(e) => onItemPointerDown(e, folder.id)}
            onPointerMove={(e) => onItemPointerMove(e, 'folder', folder.id)}
            onPointerUp={onItemPointerUp}
            onPointerCancel={onItemPointerUp}
            onContextMenu={(e) => {
              if (longPressFiredRef.current || dragItemRef.current) e.preventDefault()
            }}
            onClick={(e) => onItemClick(e, 'folder', folder.id)}
          >
            <span className={`chevron ${expanded.has(folder.id) ? 'open' : ''}`} />
            <span className="icon icon-folder" />
            <span className="folder-name">{folder.name}</span>
          </button>
          <button
            className="row-menu"
            title={t('sidebar.folderOptions')}
            onClick={(e) => openRowMenu('folder', folder.id, e)}
          >
            <span className="icon icon-dots" />
          </button>
          {menuOpen?.type === 'folder' && menuOpen.id === folder.id && (
            <div ref={menuRef} className="row-menu-popup row-menu-popup-fixed" style={{ top: menuPos?.top ?? 0, left: menuPos?.left ?? 0 }}>
              <button onClick={() => { open('newNotebook', { folderId: folder.id }); setMenuOpen(null) }}>{t('sidebar.createNote')}</button>
              <button onClick={() => { promptNewFolder(folder.id); setMenuOpen(null) }}>{t('sidebar.createFolderInside')}</button>
              <button onClick={() => { renameFolderName(folder.id); setMenuOpen(null) }}>{t('sidebar.rename')}</button>
              <button onClick={() => { open('moveFolder', { id: folder.id }); setMenuOpen(null) }}>{t('sidebar.moveToFolder')}</button>
              <button onClick={() => { void duplicateFolder(folder.id); setMenuOpen(null) }}>{t('sidebar.duplicate')}</button>
              <button
                onClick={() => {
                  void handleDeleteFolder(folder)
                  setMenuOpen(null)
                }}
              >
                {t('sidebar.deleteFolder')}
              </button>
            </div>
          )}
        </div>

        {expanded.has(folder.id) && (
          <div className="sidebar-folder-children">
            {childFolders.map((f) => renderFolder(f))}
            {childNotebooks.map((n) => renderNotebookRow(n))}
          </div>
        )}
      </div>
    )
  }

  const rootFolders = folders.filter((f) => f.parentId === null)
  const rootNotebooks = notebooks.filter((n) => n.folderId === null)

  return (
    <aside
      ref={asideRef}
      className={`sidebar ${dragItem ? 'sidebar-dragging' : ''}`}
      style={{ '--sidebar-w': `${dragWidth ?? sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="sidebar-header">
        <span>{t('sidebar.myNotebooks')}</span>
        <button className="icon-btn" title={t('sidebar.newFolder')} onClick={() => promptNewFolder(null)}>
          <IconFolderPlus />
        </button>
        <button className="icon-btn" title={t('sidebar.addPdfNote')} onClick={() => open('importPdfNote')}>
          <IconPdfNote />
        </button>
        <button className="icon-btn" title={t('sidebar.newNote')} onClick={() => open('newNotebook')}>
          <IconNotePlus />
        </button>
        <button className="icon-btn" title={t('sidebar.trash')} onClick={() => open('trash')}>
          <IconTrash />
        </button>
      </div>

      {selectedIds.length > 0 && (
        <div className="selection-bar">
          <div className="selection-bar-header">
            <span className="selection-count">{t('sidebar.itemsSelected', { count: selectedIds.length })}</span>
            <button className="selection-close" title={t('sidebar.clearSelection')} onClick={() => { clearSelection(); resetAnchor() }}>
              ×
            </button>
          </div>
          <div className="selection-actions">
            <button onClick={copySelected} title={t('sidebar.copySelectedTitle')}>{t('tool.copy')}</button>
            <button onClick={cutSelected} title={t('sidebar.cutSelectedTitle')}>{t('tool.cut')}</button>
            <button
              onClick={() => void pasteClipboard()}
              disabled={!clipboard}
              title={t('sidebar.pasteSelectedTitle')}
            >
              {t('tool.paste')}
            </button>
            <button onClick={() => void duplicateSelected()} title={t('sidebar.duplicateSelectedTitle')}>{t('sidebar.duplicate')}</button>
            <button className="danger" onClick={() => void handleDeleteSelected()} title={t('sidebar.deleteSelectedTitle')}>
              {t('tool.delete')}
            </button>
          </div>
        </div>
      )}

      <div ref={scrollerRef} className={`sidebar-scroll ${dragItem ? 'sidebar-scroll-dragging' : ''}`}>
        <button
          className={`sidebar-item ${selectedFolderId === null && selectedNotebookId === null && selectedIds.length === 0 ? 'active' : ''}`}
          onClick={() => {
            clearSelection()
            resetAnchor()
            selectFolder(null)
          }}
        >
          <span className="icon icon-all" /> {t('sidebar.allNotebooks')}
        </button>

        {rootFolders.map((f) => renderFolder(f))}

        <div className="sidebar-notebooks">
          {rootNotebooks.length === 0 && rootFolders.length === 0 && (
            <div className="sidebar-notebooks-title">{t('sidebar.noFolders')}</div>
          )}
          {rootNotebooks.map((n) => renderNotebookRow(n))}
        </div>

        {dragItem && dropIndicatorY !== null && (
          <div className="sidebar-drop-indicator" style={{ top: dropIndicatorY }} />
        )}
      </div>

      <div
        className={`sidebar-resizer ${resizing ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        title={t('sidebar.resizeSidebar')}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />

      {nameTip && (
        <div ref={nameTipRef} className="sidebar-name-tooltip">
          {nameTip.text}
        </div>
      )}
    </aside>
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

function IconNotePlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
      <path d="M14 2v4h4" />
      <path d="M8 13h6M8 17h6" />
      <circle cx="18" cy="18" r="3.4" fill="currentColor" stroke="none" />
      <path d="M18 16.4v3.2M16.4 18h3.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function IconPdfNote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h11l4 4v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M15 3v4h4" />
      <path d="M8 12h8M8 15h5M8 9h2" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
