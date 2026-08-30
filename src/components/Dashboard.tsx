import { useState, useMemo, useRef, useEffect } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { useI18n } from '../i18n'
import { confirmDeleteScope, promptName } from './Modals'

export function Dashboard() {
  const { t } = useI18n()
  const { open } = useUiStore()
  const notebooks = useAppStore((s) => s.notebooks)
  const folders = useAppStore((s) => s.folders)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const selectFolder = useAppStore((s) => s.selectFolder)
  const selectNotebook = useAppStore((s) => s.selectNotebook)
  const duplicateNotebook = useAppStore((s) => s.duplicateNotebook)
  const duplicateFolder = useAppStore((s) => s.duplicateFolder)
  const deleteFolder = useAppStore((s) => s.deleteFolder)
  const updateNotebook = useAppStore((s) => s.updateNotebook)
  const renameFolder = useAppStore((s) => s.renameFolder)
  const addFolder = useAppStore((s) => s.addFolder)
  const selectedIds = useAppStore((s) => s.selectedIds)
  const toggleSelect = useAppStore((s) => s.toggleSelect)
  const setSelectedIds = useAppStore((s) => s.setSelectedIds)
  const clearSelection = useAppStore((s) => s.clearSelection)
  const copySelected = useAppStore((s) => s.copySelected)
  const cutSelected = useAppStore((s) => s.cutSelected)
  const pasteClipboard = useAppStore((s) => s.pasteClipboard)
  const duplicateSelected = useAppStore((s) => s.duplicateSelected)
  const deleteSelected = useAppStore((s) => s.deleteSelected)
  const clipboard = useAppStore((s) => s.clipboard)
  const reorderNotebook = useAppStore((s) => s.reorderNotebook)
  const reorderFolder = useAppStore((s) => s.reorderFolder)

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState<{ type: 'folder' | 'notebook'; id: string } | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  type DragItem = { type: 'folder' | 'notebook'; id: string }
  const dragItemRef = useRef<DragItem | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressClickRef = useRef(false)
  const dropIntoRef = useRef<string | null>(null)
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropIntoFolder, setDropIntoFolder] = useState<string | null>(null)

  const currentFolders = useMemo(() => {
    if (search.trim()) {
      return folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    }
    return folders.filter(f => f.parentId === selectedFolderId)
  }, [folders, selectedFolderId, search])

  const currentNotebooks = useMemo(() => {
    if (search.trim()) {
      return notebooks.filter(nb => nb.name.toLowerCase().includes(search.toLowerCase()))
    }
    return notebooks.filter(nb => nb.folderId === selectedFolderId)
  }, [notebooks, selectedFolderId, search])

  const breadcrumbs = useMemo(() => {
    const list: Array<{ id: string | null; name: string }> = [{ id: null, name: t('sidebar.allNotebooks') }]
    let curId = selectedFolderId
    const path: Array<{ id: string | null; name: string }> = []
    while (curId) {
      const f = folders.find(x => x.id === curId)
      if (!f) break
      path.unshift({ id: f.id, name: f.name })
      curId = f.parentId
    }
    return [...list, ...path]
  }, [folders, selectedFolderId, t])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null)
      }
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().openModal) return
      if (document.activeElement?.tagName === 'INPUT') return

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'a') {
          e.preventDefault()
          setSelectedIds([...currentFolders.map(f => f.id), ...currentNotebooks.map(nb => nb.id)])
        } else if (e.key.toLowerCase() === 'c') {
          if (selectedIds.length) copySelected()
        } else if (e.key.toLowerCase() === 'x') {
          if (selectedIds.length) cutSelected()
        } else if (e.key.toLowerCase() === 'v') {
          if (clipboard) void pasteClipboard()
        } else if (e.key.toLowerCase() === 'd') {
          e.preventDefault()
          if (selectedIds.length) void duplicateSelected()
        }
      } else if (e.key === 'Delete') {
        if (selectedIds.length) void handleDeleteSelected()
      } else if (e.key === 'Escape') {
        clearSelection()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentFolders, currentNotebooks, selectedIds, clipboard, copySelected, cutSelected, pasteClipboard, duplicateSelected, setSelectedIds, clearSelection])

  function handleContextMenu(e: React.MouseEvent, type: 'folder' | 'notebook', id: string) {
    e.preventDefault()
    if (!selectedIds.includes(id)) {
      if (!(e.ctrlKey || e.metaKey)) clearSelection()
      toggleSelect(id)
    }
    setMenuOpen({ type, id })
    setMenuPos({ top: e.clientY, left: e.clientX })
  }

  function handleItemClick(e: React.MouseEvent, type: 'folder' | 'notebook', id: string) {
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(id)
    } else {
      if (type === 'folder') {
        setSearch('')
        clearSelection()
        selectFolder(id)
      } else {
        void selectNotebook(id)
      }
    }
  }

  async function handleRename(type: 'folder' | 'notebook', id: string) {
    if (type === 'notebook') {
      const nb = useAppStore.getState().notebooks.find(n => n.id === id)
      if (!nb) return
      const name = await promptName(t('sidebar.renameNotePrompt'), nb.name)
      if (name && name.trim()) {
        const store = useAppStore.getState()
        const full = store.activeNotebook?.id === id ? store.activeNotebook : await (import('../db').then(m => m.db.getNotebook(id)))
        if (full) {
          updateNotebook({ ...full, name: name.trim() })
        }
      }
    } else {
      const f = folders.find(x => x.id === id)
      if (!f) return
      const name = await promptName(t('sidebar.renameFolderPrompt'), f.name)
      if (name && name.trim()) renameFolder(id, name.trim())
    }
    setMenuOpen(null)
  }

  async function handleDelete(type: 'folder' | 'notebook', id: string) {
    const item = type === 'notebook' ? notebooks.find(n => n.id === id) : folders.find(f => f.id === id)
    if (!item) return
    const scope = await confirmDeleteScope({ kind: type, name: item.name })
    if (scope) {
      if (type === 'notebook') await useAppStore.getState().deleteNotebook(id, scope)
      else await deleteFolder(id, scope)
    }
    setMenuOpen(null)
  }

  async function handleDeleteSelected() {
    if (selectedIds.length === 0) return
    const scope = await confirmDeleteScope({
      kind: 'multi',
      name: t('sidebar.itemsSelectedName', { count: selectedIds.length }),
    })
    if (scope) await deleteSelected(scope)
  }

  async function promptNewFolder() {
    const name = await promptName(t('sidebar.newFolderPrompt'))
    if (name && name.trim()) {
      void addFolder(name.trim(), selectedFolderId)
    }
  }

  function cancelLongPress() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function itemFromPoint(x: number, y: number): { type: DragItem['type']; id: string } | null {
    const els = document.elementsFromPoint(x, y)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue
      const itemEl = el.closest('.dashboard-item')
      if (!(itemEl instanceof HTMLElement)) continue
      const id = (itemEl as HTMLElement).dataset.id
      if (!id) continue
      const type = itemEl.classList.contains('folder') ? 'folder' : 'notebook'
      return { type, id }
    }
    return null
  }

  function updateDropPosition(e: React.PointerEvent) {
    const item = dragItemRef.current
    if (!item) return
    let into: string | null = null
    const target = itemFromPoint(e.clientX, e.clientY)
    if (target && target.type === 'folder' && target.id !== item.id) {
      into = target.id
    }
    dropIntoRef.current = into
    setDropIntoFolder(into)
  }

  function onItemPointerDown(e: React.PointerEvent, _type: DragItem['type'], id: string) {
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
        } catch { /* noop */ }
        dragItemRef.current = { type, id }
        setDragItem({ type, id })
        suppressClickRef.current = true
        updateDropPosition(e)
      }
    } else {
      updateDropPosition(e)
    }
  }

  function finishDrop(item: DragItem) {
    const into = dropIntoRef.current
    if (into) {
      if (item.type === 'notebook') void reorderNotebook(item.id, into, null)
      else void reorderFolder(item.id, into, null)
    }
    suppressClickRef.current = true
  }

  function onItemPointerUp(e: React.PointerEvent) {
    cancelLongPress()
    if (dragItemRef.current) finishDrop(dragItemRef.current)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch { /* noop */ }
    resetDragUi()
  }

  function resetDragUi() {
    dragItemRef.current = null
    pressStartRef.current = null
    setDragItem(null)
    setDropIntoFolder(null)
    dropIntoRef.current = null
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="dashboard-header-left">
          <button className="icon-btn" onClick={() => open('settings')} title={t('topbar.settings')}>
            <span className="icon icon-gear" />
          </button>
          <div className="dashboard-breadcrumbs">
            {breadcrumbs.map((b, i) => (
              <span key={b.id ?? 'root'} className="breadcrumb-item">
                {i > 0 && <span className="breadcrumb-sep">/</span>}
                <button
                  className={`breadcrumb-btn ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
                  onClick={() => {
                    setSearch('')
                    selectFolder(b.id)
                  }}
                >
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className="dashboard-header-center">
          <div className="dashboard-search">
            <span className="icon icon-search" />
            <input
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>
        </div>

        <div className="dashboard-header-right">
          <div className="dashboard-actions">
            <button className="icon-btn" title={t('sidebar.newFolder')} onClick={promptNewFolder}>
              <IconFolderPlus />
            </button>
            <button className="icon-btn" title={t('sidebar.addPdfNote')} onClick={() => open('importPdfNote')}>
              <IconPdfNote />
            </button>
            <button className="icon-btn" title={t('sidebar.trash')} onClick={() => open('trash')}>
              <IconTrash />
            </button>
          </div>
          <div className="view-mode-toggle">
            <button
              className={`icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grade"
            >
              <span className="icon icon-grid" />
            </button>
            <button
              className={`icon-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Lista"
            >
              <span className="icon icon-list" />
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => open('newNotebook', { folderId: selectedFolderId })}>
            <span className="icon icon-plus" /> {t('sidebar.createNote')}
          </button>
        </div>
      </header>

      <div className="dashboard-content" onClick={(e) => {
        if (e.target === e.currentTarget) clearSelection()
      }}>
        {selectedIds.length > 0 && (
          <div className="dashboard-selection-bar">
            <span>{t('sidebar.itemsSelected', { count: selectedIds.length })}</span>
            <div className="bar-actions">
              <button onClick={copySelected}>{t('tool.copy')}</button>
              <button onClick={cutSelected}>{t('tool.cut')}</button>
              <button onClick={() => void duplicateSelected()}>{t('sidebar.duplicate')}</button>
              <button className="danger" onClick={handleDeleteSelected}>{t('tool.delete')}</button>
              <button className="close" onClick={clearSelection}>×</button>
            </div>
          </div>
        )}

        <div className={`dashboard-${viewMode} ${dragItem ? 'dashboard-dragging' : ''}`}>
          {currentFolders.map(f => (
            <div
              key={f.id}
              data-id={f.id}
              className={`dashboard-item folder ${selectedIds.includes(f.id) ? 'selected' : ''} ${dragItem?.id === f.id ? 'dragging' : ''} ${dropIntoFolder === f.id ? 'drop-target' : ''}`}
              onClick={(e) => handleItemClick(e, 'folder', f.id)}
              onContextMenu={(e) => handleContextMenu(e, 'folder', f.id)}
              onPointerDown={(e) => onItemPointerDown(e, 'folder', f.id)}
              onPointerMove={(e) => onItemPointerMove(e, 'folder', f.id)}
              onPointerUp={onItemPointerUp}
              onPointerCancel={onItemPointerUp}
            >
              <div className="item-icon">
                <span className="icon icon-folder" />
              </div>
              <span className="name">{f.name}</span>
            </div>
          ))}
          {currentNotebooks.map(nb => (
            <div
              key={nb.id}
              data-id={nb.id}
              className={`dashboard-item notebook ${selectedIds.includes(nb.id) ? 'selected' : ''} ${dragItem?.id === nb.id ? 'dragging' : ''}`}
              onClick={(e) => handleItemClick(e, 'notebook', nb.id)}
              onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.id)}
              onPointerDown={(e) => onItemPointerDown(e, 'notebook', nb.id)}
              onPointerMove={(e) => onItemPointerMove(e, 'notebook', nb.id)}
              onPointerUp={onItemPointerUp}
              onPointerCancel={onItemPointerUp}
            >
              <div className="item-preview">
                <span className="icon icon-book" />
              </div>
              <div className="item-info">
                <span className="name">{nb.name}</span>
                <span className="meta">{t('pageList.pagesSelected', { count: nb.pageCount })}</span>
              </div>
            </div>
          ))}
          {currentFolders.length === 0 && currentNotebooks.length === 0 && (
            <div className="dashboard-empty">
              {t('sidebar.noFolders')}
            </div>
          )}
        </div>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="row-menu-popup row-menu-popup-fixed"
          style={{ top: menuPos?.top, left: menuPos?.left }}
        >
          <button onClick={() => handleRename(menuOpen.type, menuOpen.id)}>{t('sidebar.rename')}</button>
          <button onClick={() => {
            if (menuOpen.type === 'notebook') open('copyNotebook', { id: menuOpen.id })
            setMenuOpen(null)
          }}>{t('sidebar.copyToFolder')}</button>
          <button onClick={() => {
            if (menuOpen.type === 'notebook') open('moveNotebook', { id: menuOpen.id })
            else open('moveFolder', { id: menuOpen.id })
            setMenuOpen(null)
          }}>{t('sidebar.moveToFolder')}</button>
          <button onClick={() => {
            if (menuOpen.type === 'notebook') void duplicateNotebook(menuOpen.id)
            else void duplicateFolder(menuOpen.id)
            setMenuOpen(null)
          }}>{t('sidebar.duplicate')}</button>
          <button className="danger" onClick={() => handleDelete(menuOpen.type, menuOpen.id)}>{t('tool.delete')}</button>
        </div>
      )}
    </div>
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
