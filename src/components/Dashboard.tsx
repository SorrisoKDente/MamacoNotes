import { useState, useMemo, useRef, useEffect } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { useI18n } from '../i18n'
import { confirmDeleteScope, promptName } from './Modals'
import { renderThumbnail } from '../renderer/thumbnail'
import { db } from '../db'

function NoteCover({ notebookId, width, height }: { notebookId: string, width: number, height: number }) {
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await db.getFirstPage(notebookId)
      if (cancelled || !page) return
      const data = await renderThumbnail(page, width, height)
      if (!cancelled) setThumb(data)
    })()
    return () => { cancelled = true }
  }, [notebookId, width, height])

  if (!thumb) return <div className="note-cover-placeholder" style={{ pointerEvents: 'none' }}><IconBook /></div>
  return <img src={thumb} className="note-cover-img" draggable={false} alt="Capa" style={{ pointerEvents: 'none' }} />
}

export function Dashboard() {
  const { t } = useI18n()
  const { open } = useUiStore()
  const notebooks = useAppStore((s) => s.notebooks)
  const folders = useAppStore((s) => s.folders)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const selectFolder = useAppStore((s) => s.selectFolder)
  const selectNotebook = useAppStore((s) => s.selectNotebook)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
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
  const favoriteSelected = useAppStore((s) => s.favoriteSelected)
  const duplicateSelected = useAppStore((s) => s.duplicateSelected)
  const deleteSelected = useAppStore((s) => s.deleteSelected)
  const clipboard = useAppStore((s) => s.clipboard)
  const reorderNotebook = useAppStore((s) => s.reorderNotebook)
  const reorderFolder = useAppStore((s) => s.reorderFolder)

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const [search, setSearch] = useState('')
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedFolderId) return
    const toExpand = new Set(expandedFolders)
    let curId: string | null = selectedFolderId
    while (curId) {
      const current: string = curId
      const f = folders.find(x => x.id === current)
      if (!f) break
      if (f.parentId) toExpand.add(f.parentId)
      curId = f.parentId
    }
    if (toExpand.size !== expandedFolders.size) {
      setExpandedFolders(toExpand)
    }
  }, [selectedFolderId, folders])
  const [menuOpen, setMenuOpen] = useState<{ type: 'folder' | 'notebook'; id: string } | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  type DragItem = { type: 'folder' | 'notebook'; id: string }
  const dragItemRef = useRef<DragItem | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; type: 'into' | 'before' | 'after' } | null>(null)

  useEffect(() => {
    if (dragItem) {
      document.body.style.cursor = 'grabbing'
    } else {
      document.body.style.cursor = ''
    }
    return () => { document.body.style.cursor = '' }
  }, [dragItem])

  useEffect(() => {
    const onEsc = () => {
      if (useUiStore.getState().openModal) return
      if (document.activeElement?.tagName === 'INPUT') {
        (document.activeElement as HTMLElement).blur()
        return
      }

      if (search) {
        setSearch('')
        return
      }

      if (selectedFolderId) {
        const folder = folders.find(f => f.id === selectedFolderId)
        selectFolder(folder?.parentId ?? null)
        return
      }
    }
    window.addEventListener('ink:esc', onEsc)
    return () => window.removeEventListener('ink:esc', onEsc)
  }, [search, selectedFolderId, folders, selectFolder])

  const currentFolders = useMemo(() => {
    if (search.trim()) {
      return folders.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    }
    if (filter === 'favorites') return []
    return folders.filter(f => f.parentId === selectedFolderId)
  }, [folders, selectedFolderId, search, filter])

  const currentNotebooks = useMemo(() => {
    let list = notebooks
    if (search.trim()) {
      list = list.filter(nb => nb.name.toLowerCase().includes(search.toLowerCase()))
    } else {
      list = list.filter(nb => nb.folderId === selectedFolderId)
    }
    if (filter === 'favorites') {
      list = list.filter(nb => nb.favorite)
    }
    return list
  }, [notebooks, selectedFolderId, search, filter])

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

    const menuWidth = 180
    const menuHeight = 240
    let left = e.clientX
    let top = e.clientY

    if (left + menuWidth > window.innerWidth) {
      left = window.innerWidth - menuWidth - 10
    }
    if (top + menuHeight > window.innerHeight) {
      top = window.innerHeight - menuHeight - 10
    }

    setMenuOpen({ type, id })
    setMenuPos({ top, left })
  }

  function handleItemClick(e: React.MouseEvent, type: 'folder' | 'notebook', id: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
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
        const full = store.activeNotebook?.id === id ? store.activeNotebook : await db.getNotebook(id)
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

  function handleToggleFavorite(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    void toggleFavorite(id)
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

  function itemFromPoint(x: number, y: number): { type: 'folder' | 'notebook'; id: string; isSidebar?: boolean } | null {
    const els = document.elementsFromPoint(x, y)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue

      const itemEl = el.closest('.dashboard-item')
      if (itemEl instanceof HTMLElement) {
        const id = itemEl.dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id)) {
          const type = itemEl.classList.contains('folder') ? 'folder' : 'notebook'
          return { type, id }
        }
      }

      const treeEl = el.closest('.tree-item-row')
      if (treeEl instanceof HTMLElement) {
        const id = (treeEl as any).dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id)) {
          return { type: 'folder', id, isSidebar: true }
        }
      }
    }
    return null
  }

  function updateDropPosition(e: React.PointerEvent) {
    const item = dragItemRef.current
    if (!item) return

    const target = itemFromPoint(e.clientX, e.clientY)
    if (!target) {
      setDropTarget(null)
      return
    }

    if (target.type === 'folder' || target.isSidebar) {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(target.isSidebar ? '.tree-item-row' : '.dashboard-item')
      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect()
        const relativeY = e.clientY - rect.top
        const relativeX = e.clientX - rect.left

        if (target.isSidebar) {
          if (relativeY < rect.height * 0.25) setDropTarget({ id: target.id, type: 'before' })
          else if (relativeY > rect.height * 0.75) setDropTarget({ id: target.id, type: 'after' })
          else setDropTarget({ id: target.id, type: 'into' })
        } else {
          // In grid, middle is "into", edges are "before/after"
          if (relativeX < rect.width * 0.2) setDropTarget({ id: target.id, type: 'before' })
          else if (relativeX > rect.width * 0.8) setDropTarget({ id: target.id, type: 'after' })
          else if (target.type === 'folder') setDropTarget({ id: target.id, type: 'into' })
          else setDropTarget({ id: target.id, type: 'after' })
        }
      }
    } else {
      // It's a notebook in grid
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dashboard-item')
      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect()
        const relativeX = e.clientX - rect.left
        if (relativeX < rect.width / 2) setDropTarget({ id: target.id, type: 'before' })
        else setDropTarget({ id: target.id, type: 'after' })
      }
    }
  }

  function onItemPointerDown(e: React.PointerEvent, _type: DragItem['type'], id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    suppressClickRef.current = false
    longPressFiredRef.current = false
    pressStartRef.current = { x: e.clientX, y: e.clientY }
    cancelLongPress()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      longPressFiredRef.current = true
      suppressClickRef.current = true
      toggleSelect(id)
    }, 600)
  }

  function onItemPointerMove(e: React.PointerEvent, type: DragItem['type'], id: string) {
    if (longPressFiredRef.current) return
    const start = pressStartRef.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!dragItemRef.current) {
      if (dist > 8) cancelLongPress()
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
    if (!dropTarget) return

    const { id, type } = dropTarget
    if (type === 'into') {
      if (item.type === 'notebook') void reorderNotebook(item.id, id, null)
      else void reorderFolder(item.id, id, null)
    } else {
      // Reordering
      if (item.type === 'notebook') {
        const targetNb = notebooks.find(n => n.id === id)
        const folderId = targetNb ? targetNb.folderId : selectedFolderId
        const siblings = notebooks.filter(n => n.folderId === folderId)
        const idx = siblings.findIndex(n => n.id === id)

        let finalBeforeId: string | null = null
        if (idx !== -1) {
          finalBeforeId = type === 'before' ? id : (siblings[idx + 1]?.id ?? null)
        }
        void reorderNotebook(item.id, folderId, finalBeforeId)
      } else {
        const targetF = folders.find(f => f.id === id)
        const parentId = targetF ? targetF.parentId : null
        const siblings = folders.filter(f => f.parentId === parentId)
        const idx = siblings.findIndex(f => f.id === id)

        let finalBeforeId: string | null = null
        if (idx !== -1) {
          finalBeforeId = type === 'before' ? id : (siblings[idx + 1]?.id ?? null)
        }
        void reorderFolder(item.id, parentId, finalBeforeId)
      }
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
    setDropTarget(null)
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(expandedFolders)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedFolders(next)
  }

  const getNoteCount = (folderId: string | null): number => {
    let count = notebooks.filter(n => n.folderId === folderId).length
    const subfolders = folders.filter(f => f.parentId === folderId)
    for (const f of subfolders) {
      count += getNoteCount(f.id)
    }
    return count
  }

  const renderFolderTree = (parentId: string | null = null, level = 0) => {
    const subs = folders
      .filter(f => f.parentId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    if (subs.length === 0 && parentId !== null) return null

    return (
      <div className="tree-children">
        {subs.map(f => {
          const isExpanded = expandedFolders.has(f.id)
          const hasChildren = folders.some(child => child.parentId === f.id)
          const noteCount = getNoteCount(f.id)
          const isActive = selectedFolderId === f.id

          return (
            <div key={f.id} className="tree-item">
              <div
                className={`tree-item-row ${isActive ? 'active' : ''} ${dropTarget?.id === f.id && dropTarget.type === 'into' ? 'drop-target' : ''}`}
                style={{ paddingLeft: level * 16 + 8 }}
                data-id={f.id}
                onClick={(e) => handleItemClick(e as any, 'folder', f.id)}
                onContextMenu={(e) => handleContextMenu(e as any, 'folder', f.id)}
              >
                {dropTarget?.id === f.id && dropTarget.type === 'before' && <div className="dashboard-drop-indicator horizontal" style={{ top: -1 }} />}
                <div
                  className={`tree-chevron ${isExpanded ? 'expanded' : ''}`}
                  style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                  onClick={(e) => toggleExpand(f.id, e as any)}
                >
                  <IconChevronRight />
                </div>
                <div className="tree-icon">
                  <IconFolder />
                </div>
                <span className="tree-name">{f.name}</span>
                {noteCount > 0 && <span className="tree-count">{noteCount}</span>}
                {dropTarget?.id === f.id && dropTarget.type === 'after' && <div className="dashboard-drop-indicator horizontal" style={{ bottom: -1 }} />}
              </div>
              {isExpanded && renderFolderTree(f.id, level + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={`dashboard ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div
        className="dashboard-backdrop"
        onClick={() => setSidebarCollapsed(true)}
      />
      <nav className="dashboard-sidebar">
        <div className="dashboard-sidebar-header">
          <div className="topbar-brand">Mamaco Notes</div>
        </div>

        <div className="sidebar-scroll">
          <button
            className={`sidebar-btn ${filter === 'all' && !selectedFolderId ? 'active' : ''}`}
            onClick={() => { setFilter('all'); selectFolder(null); setSearch('') }}
          >
            <IconAll />
            <span>{t('sidebar.allNotebooks')}</span>
          </button>
          <button
            className={`sidebar-btn ${filter === 'favorites' ? 'active' : ''}`}
            onClick={() => { setFilter('favorites'); selectFolder(null); setSearch('') }}
          >
            <IconStar fill={filter === 'favorites' ? 'currentColor' : 'none'} />
            <span>Favoritos</span>
          </button>
          <button
            className="sidebar-btn"
            onClick={() => open('trash')}
          >
            <IconTrash />
            <span>{t('sidebar.trash')}</span>
          </button>

          <div className="sidebar-spacer" />

          <div className="sidebar-section-title">Pastas</div>
          <div className="sidebar-tree">
            {renderFolderTree(null)}
          </div>
        </div>

        <button className="sidebar-btn" onClick={() => open('settings')}>
          <IconSettings />
          <span>{t('topbar.settings')}</span>
        </button>
      </nav>

      <div className="dashboard-main">
        <header className="dashboard-header">
          <div className="dashboard-header-left">
            <button
              className="icon-btn sidebar-toggle"
              title="Alternar menu"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <IconMenu />
            </button>
            <button className="icon-btn mobile-search-toggle" onClick={() => setMobileSearchOpen(!mobileSearchOpen)}>
              <IconSearch />
            </button>
          </div>

          <div className="dashboard-header-center">
            <div className={`dashboard-search ${mobileSearchOpen ? 'mobile-open' : ''}`}>
              <input
                type="text"
                placeholder={t('sidebar.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus={mobileSearchOpen}
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
            </div>
            <div className="view-mode-toggle">
              <button
                className={`icon-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grade"
              >
                <IconGrid />
              </button>
              <button
                className={`icon-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="Lista"
              >
                <IconList />
              </button>
            </div>
            <button className="btn btn-primary" onClick={() => open('newNotebook', { folderId: selectedFolderId })}>
              <IconPlus /> {t('sidebar.createNote')}
            </button>
          </div>
        </header>

        <div className="dashboard-subheader">
          <div className="dashboard-breadcrumbs">
            {breadcrumbs.map((b, i) => (
              <span key={b.id ?? 'root'} className="breadcrumb-item">
                {i > 0 && <span className="breadcrumb-sep">/</span>}
                <button
                  className={`btn small breadcrumb-btn ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
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

        <div className="dashboard-content" onClick={(e) => {
          if (e.target === e.currentTarget) clearSelection()
        }}>
          {selectedIds.length > 0 && (
            <div className="dashboard-selection-bar">
              <span>{t('sidebar.itemsSelectedName', { count: selectedIds.length })}</span>
              <div className="bar-actions">
                <button className="btn small" onClick={() => void favoriteSelected()}>{t('tool.favorite') || 'Favoritar'}</button>
                <button className="btn small" onClick={() => open('moveSelected', { ids: selectedIds })}>{t('sidebar.moveToFolder')}</button>
                <button className="btn small" onClick={copySelected}>{t('tool.copy')}</button>
                <button className="btn small" onClick={cutSelected}>{t('tool.cut')}</button>
                <button className="btn small" onClick={() => void duplicateSelected()}>{t('sidebar.duplicate')}</button>
                <button className="btn small danger" onClick={handleDeleteSelected}>{t('tool.delete')}</button>
                <button className="close" onClick={clearSelection}>×</button>
              </div>
            </div>
          )}

          <div className={`dashboard-${viewMode} ${dragItem ? 'dashboard-dragging' : ''}`}>
            {currentFolders.map(f => {
              const noteCount = getNoteCount(f.id)
              const isTarget = dropTarget?.id === f.id
              return (
                <div
                  key={f.id}
                  data-id={f.id}
                  className={`dashboard-item folder ${selectedIds.includes(f.id) ? 'selected' : ''} ${dragItem?.id === f.id ? 'dragging' : ''} ${isTarget && dropTarget.type === 'into' ? 'drop-target' : ''}`}
                  onClick={(e) => handleItemClick(e, 'folder', f.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'folder', f.id)}
                  onPointerDown={(e) => onItemPointerDown(e, 'folder', f.id)}
                  onPointerMove={(e) => onItemPointerMove(e, 'folder', f.id)}
                  onPointerUp={onItemPointerUp}
                  onPointerCancel={onItemPointerUp}
                  onPointerLeave={onItemPointerUp}
                >
                  {isTarget && dropTarget.type === 'before' && <div className="dashboard-drop-indicator vertical" style={{ left: -12 }} />}
                  <button
                    className={`item-favorite-btn ${f.favorite ? 'favorited' : ''}`}
                    onClick={(e) => handleToggleFavorite(f.id, e)}
                    title={t('tool.favorite')}
                  >
                    <IconStar fill={f.favorite ? '#f1c40f' : 'none'} color={f.favorite ? '#f1c40f' : 'currentColor'} />
                  </button>
                  <div className="item-icon">
                    <IconFolder />
                  </div>
                  <div className="item-info">
                    <span className="name">{f.name}</span>
                    <span className="meta">{noteCount} {noteCount === 1 ? t('sidebar.itemSingular') || 'item' : t('sidebar.itemPlural') || 'itens'}</span>
                  </div>
                  {isTarget && dropTarget.type === 'after' && <div className="dashboard-drop-indicator vertical" style={{ right: -12 }} />}
                </div>
              )
            })}
            {currentNotebooks.map(nb => {
              const isTarget = dropTarget?.id === nb.id
              return (
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
                  onPointerLeave={onItemPointerUp}
                >
                  {isTarget && dropTarget.type === 'before' && <div className="dashboard-drop-indicator vertical" style={{ left: -12 }} />}
                  <button
                    className={`item-favorite-btn ${nb.favorite ? 'favorited' : ''}`}
                    onClick={(e) => handleToggleFavorite(nb.id, e)}
                    title={t('tool.favorite')}
                  >
                    <IconStar fill={nb.favorite ? '#f1c40f' : 'none'} color={nb.favorite ? '#f1c40f' : 'currentColor'} />
                  </button>
                  <div className="item-preview">
                    {viewMode === 'grid' ? (
                      <NoteCover notebookId={nb.id} width={180} height={230} />
                    ) : (
                      <IconBook />
                    )}
                  </div>
                  <div className="item-info">
                    <span className="name">{nb.name}</span>
                    <span className="meta">{nb.pageCount} {nb.pageCount === 1 ? t('sidebar.pageSingular') || 'página' : t('sidebar.pagePlural') || 'páginas'}</span>
                  </div>
                  {isTarget && dropTarget.type === 'after' && <div className="dashboard-drop-indicator vertical" style={{ right: -12 }} />}
                </div>
              )
            })}
            {currentFolders.length === 0 && currentNotebooks.length === 0 && (
              <div className="dashboard-empty">
                {search ? t('sidebar.searchNoResults') : t('sidebar.noFolders')}
              </div>
            )}
          </div>
        </div>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="row-menu-popup row-menu-popup-fixed"
          style={{ top: menuPos?.top, left: menuPos?.left }}
        >
          <button onClick={() => handleRename(menuOpen.type, menuOpen.id)}>{t('sidebar.rename')}</button>
          {menuOpen.type === 'notebook' && (
            <button onClick={() => { toggleFavorite(menuOpen.id); setMenuOpen(null) }}>
              {notebooks.find(n => n.id === menuOpen.id)?.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            </button>
          )}
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

function IconFolder() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function IconFolderPlus() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  )
}

function IconPdfNote() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function IconStar({ fill = 'none', color = 'currentColor' }: { fill?: string, color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function IconAll() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function IconGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

function IconList() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function IconPlus() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconSearch() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
