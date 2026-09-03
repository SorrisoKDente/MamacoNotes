import { useState, useMemo, useRef, useEffect } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { useI18n } from '../i18n'
import { toggleFullscreen } from '../utils/fullscreen'
import { shouldShowFullscreen } from '../utils/platform'
import { confirmDeleteScope, promptName } from '../utils/dialogs'
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
  const moveSelected = useAppStore((s) => s.moveSelected)
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
    let list = folders
    if (search.trim()) {
      list = list.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    } else if (filter !== 'favorites') {
      list = list.filter(f => f.parentId === selectedFolderId)
    }

    if (filter === 'favorites') {
      list = list.filter(f => f.favorite)
    }
    return list
  }, [folders, selectedFolderId, search, filter])

  const currentNotebooks = useMemo(() => {
    let list = notebooks
    if (search.trim()) {
      list = list.filter(nb => nb.name.toLowerCase().includes(search.toLowerCase()))
    } else if (filter !== 'favorites') {
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
        setFilter('all')
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
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.blur()
    }
  }

  function handleToggleSelect(id: string, e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation()
    toggleSelect(id)
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

  function itemFromPoint(x: number, y: number): { type: 'folder' | 'notebook'; id: string; isSidebar?: boolean } | null {
    const els = document.elementsFromPoint(x, y)

    // First pass: Prioritize containers (root button or folders)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue

      const rootEl = el.closest('[data-is-root="true"]')
      if (rootEl instanceof HTMLElement) return { type: 'folder', id: 'root', isSidebar: true }

      const treeEl = el.closest('.tree-item-row')
      if (treeEl instanceof HTMLElement && treeEl.classList.contains('folder')) {
        const id = (treeEl as any).dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id) && !selectedIds.includes(id)) {
          return { type: 'folder', id, isSidebar: true }
        }
      }

      const itemEl = el.closest('.dashboard-item')
      if (itemEl instanceof HTMLElement && itemEl.classList.contains('folder')) {
        const id = itemEl.dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id) && !selectedIds.includes(id)) {
          return { type: 'folder', id }
        }
      }
    }

    // Second pass: Any item (for reordering)
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue

      const treeEl = el.closest('.tree-item-row')
      if (treeEl instanceof HTMLElement) {
        const id = (treeEl as any).dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id) && !selectedIds.includes(id)) {
          return { type: treeEl.classList.contains('folder') ? 'folder' : 'notebook', id, isSidebar: true }
        }
      }

      const itemEl = el.closest('.dashboard-item')
      if (itemEl instanceof HTMLElement) {
        const id = itemEl.dataset.id
        if (id && (!dragItemRef.current || id !== dragItemRef.current.id) && !selectedIds.includes(id)) {
          return { type: itemEl.classList.contains('folder') ? 'folder' : 'notebook', id }
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

    if (target.id === 'root') {
      setDropTarget({ id: 'root', type: 'into' })
      return
    }

    const els = document.elementsFromPoint(e.clientX, e.clientY)
    const targetEl = els.find(el => {
      if (!(el instanceof HTMLElement)) return false
      if (target.id === 'root') return !!el.closest('[data-is-root="true"]')
      const id = target.isSidebar ? (el.closest('.tree-item-row') as any)?.dataset?.id : el.closest('.dashboard-item')?.getAttribute('data-id')
      return id === target.id
    }) as HTMLElement | undefined

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const relativeY = e.clientY - rect.top
      const relativeX = e.clientX - rect.left

      if (target.isSidebar) {
        if (target.type === 'notebook') {
          // Sidebar notebook: only before/after
          if (relativeY < rect.height / 2) setDropTarget({ id: target.id, type: 'before' })
          else setDropTarget({ id: target.id, type: 'after' })
        } else {
          // Sidebar folder: before, after or into
          if (relativeY < rect.height * 0.25) setDropTarget({ id: target.id, type: 'before' })
          else if (relativeY > rect.height * 0.75) setDropTarget({ id: target.id, type: 'after' })
          else setDropTarget({ id: target.id, type: 'into' })
        }
      } else {
        // Grid/List: only folders accept "into"
        // Refined: larger "into" zone (center 80% of the item)
        if (relativeX < rect.width * 0.1) setDropTarget({ id: target.id, type: 'before' })
        else if (relativeX > rect.width * 0.9) setDropTarget({ id: target.id, type: 'after' })
        else if (target.type === 'folder') setDropTarget({ id: target.id, type: 'into' })
        else setDropTarget({ id: target.id, type: 'after' })
      }
    }
  }

  function onItemPointerDown(e: React.PointerEvent, _type: DragItem['type'], _id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    suppressClickRef.current = false
    pressStartRef.current = { x: e.clientX, y: e.clientY }
  }

  function onItemPointerMove(e: React.PointerEvent, type: DragItem['type'], id: string) {
    const start = pressStartRef.current
    if (!start) return
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!dragItemRef.current) {
      const threshold = e.pointerType === 'mouse' ? 6 : 12
      if (dist > threshold) {
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
    const isMultiDrag = selectedIds.includes(item.id)

    if (id === 'root' || type === 'into') {
      const targetFolderId = id === 'root' ? null : id
      if (isMultiDrag) {
        void moveSelected(targetFolderId)
      } else {
        if (item.type === 'notebook') void reorderNotebook(item.id, targetFolderId, null)
        else void reorderFolder(item.id, targetFolderId, null)
      }
    } else {
      // Reordering (always single item for now as reorder expects specific order)
      if (item.type === 'notebook') {
        const targetNb = notebooks.find(n => n.id === id)
        const folderId = targetNb ? targetNb.folderId : selectedFolderId
        const siblings = notebooks.filter(n => n.folderId === folderId)
        const idx = siblings.findIndex(n => n.id === id)

        let finalBeforeId: string | null = null
        if (idx !== -1) {
          finalBeforeId = type === 'before' ? id : (siblings[idx + 1]?.id ?? null)
        }

        if (isMultiDrag) {
          // Move all selected to this folder, then reorder the specific one
          void moveSelected(folderId).then(() => {
            void reorderNotebook(item.id, folderId, finalBeforeId)
          })
        } else {
          void reorderNotebook(item.id, folderId, finalBeforeId)
        }
      } else {
        const targetF = folders.find(f => f.id === id)
        const parentId = targetF ? targetF.parentId : null
        const siblings = folders.filter(f => f.parentId === parentId)
        const idx = siblings.findIndex(f => f.id === id)

        let finalBeforeId: string | null = null
        if (idx !== -1) {
          finalBeforeId = type === 'before' ? id : (siblings[idx + 1]?.id ?? null)
        }

        if (isMultiDrag) {
          void moveSelected(parentId).then(() => {
            void reorderFolder(item.id, parentId, finalBeforeId)
          })
        } else {
          void reorderFolder(item.id, parentId, finalBeforeId)
        }
      }
    }
    suppressClickRef.current = true
  }

  function onItemPointerUp(e: React.PointerEvent) {
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

    const childNotebooks = notebooks
      .filter(nb => nb.folderId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    if (subs.length === 0 && childNotebooks.length === 0 && parentId !== null) return null

    return (
      <div className="tree-children">
        {subs.map(f => {
          const isExpanded = expandedFolders.has(f.id)
          const hasChildren = folders.some(child => child.parentId === f.id) || notebooks.some(nb => nb.folderId === f.id)
          const noteCount = getNoteCount(f.id)
          const isActive = selectedFolderId === f.id
          const isSelected = selectedIds.includes(f.id)

          return (
            <div key={f.id} className="tree-item">
              <div
                className={`tree-item-row folder ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${dropTarget?.id === f.id && dropTarget.type === 'into' ? 'drop-target' : ''} ${dragItem?.id === f.id ? 'dragging' : ''}`}
                style={{ paddingLeft: level * 16 + 8, ...(dragItem?.id === f.id ? { pointerEvents: 'none' } : {}) }}
                data-id={f.id}
                onClick={(e) => handleItemClick(e as any, 'folder', f.id)}
                onContextMenu={(e) => handleContextMenu(e as any, 'folder', f.id)}
                onPointerDown={(e) => onItemPointerDown(e as any, 'folder', f.id)}
                onPointerMove={(e) => onItemPointerMove(e as any, 'folder', f.id)}
                onPointerUp={onItemPointerUp}
                onPointerCancel={onItemPointerUp}
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

        {childNotebooks.map(nb => {
          const isSelected = selectedIds.includes(nb.id)
          return (
            <div
              key={nb.id}
              className={`tree-item-row notebook ${isSelected ? 'selected' : ''} ${dragItem?.id === nb.id ? 'dragging' : ''}`}
              style={{ paddingLeft: level * 16 + 8, ...(dragItem?.id === nb.id ? { pointerEvents: 'none' } : {}) }}
              data-id={nb.id}
              onClick={(e) => handleItemClick(e as any, 'notebook', nb.id)}
              onContextMenu={(e) => handleContextMenu(e as any, 'notebook', nb.id)}
              onPointerDown={(e) => onItemPointerDown(e as any, 'notebook', nb.id)}
              onPointerMove={(e) => onItemPointerMove(e as any, 'notebook', nb.id)}
              onPointerUp={onItemPointerUp}
              onPointerCancel={onItemPointerUp}
            >
              {dropTarget?.id === nb.id && dropTarget.type === 'before' && <div className="dashboard-drop-indicator horizontal" style={{ top: -1 }} />}
              <div className="tree-chevron-placeholder" />
              <div className="tree-icon">
                <IconBook />
              </div>
              <span className="tree-name">{nb.name}</span>
              {dropTarget?.id === nb.id && dropTarget.type === 'after' && <div className="dashboard-drop-indicator horizontal" style={{ bottom: -1 }} />}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={`dashboard ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${dragItem ? 'dashboard-dragging-active' : ''}`}>
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
            className={`sidebar-btn ${filter === 'all' && !selectedFolderId ? 'active' : ''} ${dropTarget?.id === 'root' ? 'drop-target' : ''}`}
            data-is-root="true"
            onClick={() => { setFilter('all'); selectFolder(null); setSearch('') }}
          >
            <IconAll />
            <span>{t('sidebar.allNotebooks')}</span>
          </button>
          <button
            className={`sidebar-btn ${filter === 'favorites' ? 'active' : ''}`}
            onClick={() => { setFilter('favorites'); selectFolder(null); setSearch('') }}
          >
            <IconBanana fill={filter === 'favorites' ? 'currentColor' : 'none'} />
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

          <div className="sidebar-section-title">{t('sidebar.files')}</div>
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
            {shouldShowFullscreen() && (
              <button
                className="icon-btn topbar-fullscreen"
                title={t('topbar.fullscreen')}
                onClick={toggleFullscreen}
              >
                <span className="icon icon-fullscreen" style={{ width: 20, height: 20, fontSize: 18 }} />
              </button>
            )}
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
                  style={dragItem?.id === f.id ? { pointerEvents: 'none' } : undefined}
                  onClick={(e) => handleItemClick(e, 'folder', f.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'folder', f.id)}
                  onPointerDown={(e) => onItemPointerDown(e, 'folder', f.id)}
                  onPointerMove={(e) => onItemPointerMove(e, 'folder', f.id)}
                  onPointerUp={onItemPointerUp}
                  onPointerCancel={onItemPointerUp}
                >
                  {isTarget && dropTarget.type === 'before' && <div className="dashboard-drop-indicator vertical" style={{ left: -12 }} />}
                  <button
                    className={`item-selection-btn ${selectedIds.includes(f.id) ? 'selected' : ''}`}
                    onClick={(e) => handleToggleSelect(f.id, e)}
                    title={t('tool.select')}
                  >
                    <IconCheckCircle />
                  </button>
                  <button
                    className={`item-favorite-btn ${f.favorite ? 'favorited' : ''}`}
                    onClick={(e) => handleToggleFavorite(f.id, e)}
                    title={t('tool.favorite')}
                  >
                    <IconBanana fill={f.favorite ? '#f1c40f' : 'none'} color={f.favorite ? '#f1c40f' : 'currentColor'} />
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
                  style={dragItem?.id === nb.id ? { pointerEvents: 'none' } : undefined}
                  onClick={(e) => handleItemClick(e, 'notebook', nb.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'notebook', nb.id)}
                  onPointerDown={(e) => onItemPointerDown(e, 'notebook', nb.id)}
                  onPointerMove={(e) => onItemPointerMove(e, 'notebook', nb.id)}
                  onPointerUp={onItemPointerUp}
                  onPointerCancel={onItemPointerUp}
                >
                  {isTarget && dropTarget.type === 'before' && <div className="dashboard-drop-indicator vertical" style={{ left: -12 }} />}
                  <button
                    className={`item-selection-btn ${selectedIds.includes(nb.id) ? 'selected' : ''}`}
                    onClick={(e) => handleToggleSelect(nb.id, e)}
                    title={t('tool.select')}
                  >
                    <IconCheckCircle />
                  </button>
                  <button
                    className={`item-favorite-btn ${nb.favorite ? 'favorited' : ''}`}
                    onClick={(e) => handleToggleFavorite(nb.id, e)}
                    title={t('tool.favorite')}
                  >
                    <IconBanana fill={nb.favorite ? '#f1c40f' : 'none'} color={nb.favorite ? '#f1c40f' : 'currentColor'} />
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
          <button onClick={() => { toggleFavorite(menuOpen.id); setMenuOpen(null) }}>
            {menuOpen.type === 'notebook'
              ? (notebooks.find(n => n.id === menuOpen.id)?.favorite ? t('sidebar.removeFavorite') : t('sidebar.addFavorite'))
              : (folders.find(f => f.id === menuOpen.id)?.favorite ? t('sidebar.removeFavorite') : t('sidebar.addFavorite'))
            }
          </button>
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

function IconBanana({ fill = 'none', color = 'currentColor' }: { fill?: string, color?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 1024 1024" fill={fill} stroke={color} strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      <path d="M 540.50 828.54 C519.46,831.07 495.61,830.02 464.00,825.19 C456.58,824.05 446.39,822.68 441.37,822.14 C427.93,820.70 421.18,816.42 415.97,806.03 C411.06,796.22 404.56,768.04 405.47,760.50 C406.82,749.37 413.69,740.65 427.83,732.10 C428.24,731.85 428.64,731.61 429.03,731.38 C433.81,728.50 436.59,726.82 436.36,725.85 C436.05,724.49 429.93,724.48 415.33,724.45 C414.47,724.45 413.59,724.45 412.68,724.45 C383.84,724.39 371.08,722.98 348.93,717.41 C331.62,713.06 320.10,708.89 303.96,701.13 C297.06,697.82 287.61,693.70 282.96,691.99 C268.67,686.74 263.04,682.68 258.65,674.50 C256.63,670.74 256.50,669.12 256.50,647.50 C256.50,621.41 256.93,619.20 263.34,612.25 C267.76,607.45 271.51,605.25 280.00,602.48 C283.02,601.49 287.04,600.04 288.93,599.25 L 292.36 597.82 L 284.83 594.55 C257.16,582.52 238.04,569.65 215.13,547.63 C206.47,539.31 196.22,529.57 192.35,525.98 C186.77,520.81 184.87,518.26 183.16,513.69 C180.58,506.81 180.49,503.78 182.59,495.64 C184.80,487.07 191.44,468.01 193.88,463.23 C196.81,457.48 203.96,451.62 210.73,449.39 C215.30,447.90 218.96,447.55 228.28,447.73 C236.58,447.89 242.94,447.40 249.78,446.06 C271.18,441.89 274.98,441.58 298.00,442.02 C349.89,443.03 376.52,442.49 392.00,440.12 C420.58,435.75 448.90,427.55 468.51,417.97 C481.22,411.76 499.89,399.55 511.59,389.80 C516.59,385.63 529.65,373.51 540.61,362.86 C560.50,343.54 569.28,336.58 582.50,329.64 C591.24,325.06 596.93,318.90 602.05,308.50 C605.68,301.13 613.00,278.13 613.00,274.11 C613.00,272.96 610.62,271.25 605.81,268.94 C590.61,261.66 584.03,253.53 584.01,242.00 C584.00,230.38 590.14,203.18 594.65,194.89 C598.41,188.00 606.70,180.63 613.63,178.04 C624.59,173.94 631.86,173.49 648.00,175.93 C672.53,179.63 684.99,180.89 713.00,182.48 C735.01,183.74 740.97,184.39 745.39,186.04 C756.59,190.23 764.27,198.67 768.06,210.93 C770.49,218.79 773.08,239.77 773.32,253.50 C773.48,262.10 773.17,264.23 771.14,268.73 C769.84,271.60 766.76,275.81 764.29,278.09 C759.94,282.09 759.83,282.36 760.47,286.67 C761.80,295.54 770.12,322.69 773.91,330.50 C777.14,337.18 779.99,340.82 791.14,352.53 C798.49,360.25 806.80,369.70 809.62,373.53 C825.93,395.73 836.81,424.66 841.17,457.50 C842.94,470.82 842.94,517.15 841.18,530.50 C834.85,578.26 818.01,624.19 792.61,662.97 C776.71,687.23 762.77,704.05 740.35,726.03 C716.77,749.13 699.09,763.18 673.00,779.54 C629.69,806.70 585.08,823.19 540.50,828.54 ZM 492.00 796.95 C504.07,798.46 533.75,797.41 547.00,795.01 C593.26,786.64 635.65,768.26 676.74,738.78 C722.21,706.15 762.28,658.69 785.04,610.50 C803.10,572.27 811.31,536.07 811.35,494.50 C811.37,473.52 810.15,461.27 806.34,444.04 C802.13,425.01 797.35,413.48 787.44,398.50 C782.04,390.34 780.05,387.92 760.10,365.38 C744.73,348.02 742.18,342.35 731.57,302.00 L 728.28 289.50 L 718.98 289.75 C713.86,289.88 709.44,290.23 709.15,290.52 C708.86,290.81 709.86,295.65 711.37,301.27 C716.57,320.66 719.06,334.35 719.67,347.06 C720.49,363.88 718.97,370.48 710.12,388.61 C700.35,408.62 701.32,404.86 692.02,459.00 C682.32,515.51 670.84,547.95 648.48,582.00 C626.29,615.78 602.32,641.89 570.00,667.48 C560.81,674.76 531.79,694.22 512.50,706.05 C494.75,716.94 483.08,725.88 469.05,739.33 C456.29,751.56 447.40,758.73 440.86,762.07 L 437.23 763.93 L 438.64 771.43 C439.42,775.55 440.85,781.53 441.82,784.71 L 443.58 790.50 L 452.04 791.17 C456.69,791.54 465.90,792.78 472.50,793.93 C479.10,795.08 487.88,796.44 492.00,796.95 ZM 388.00 691.85 C415.79,694.41 447.69,691.59 477.71,683.92 C492.18,680.22 498.28,677.38 516.32,665.91 C553.82,642.08 580.17,619.10 604.49,589.00 C624.06,564.79 641.51,531.93 650.16,503.00 C651.23,499.43 652.30,495.94 652.52,495.25 C653.40,492.62 650.97,494.16 649.37,497.25 C645.95,503.89 628.53,529.22 620.45,539.31 C587.20,580.80 540.20,616.23 491.51,636.49 C455.32,651.54 411.60,661.36 374.76,662.71 C357.58,663.34 351.66,662.20 348.50,657.69 C346.12,654.30 346.55,646.75 349.25,644.37 C353.49,640.63 357.53,639.77 377.50,638.37 C416.60,635.63 447.74,628.47 480.00,614.78 C545.33,587.07 595.73,542.29 631.07,480.54 C639.02,466.64 646.33,451.15 654.60,430.65 C659.64,418.17 661.99,413.59 664.98,410.50 C668.03,407.34 669.59,404.25 672.41,395.76 C674.38,389.85 678.65,379.92 681.90,373.70 C691.11,356.06 691.14,348.53 682.08,315.50 C676.90,296.57 674.99,290.85 674.41,292.50 C674.22,293.05 673.16,300.92 672.06,310.00 C668.02,343.10 664.09,351.77 644.23,371.39 C636.94,378.60 628.54,387.88 625.57,392.00 C620.92,398.46 609.93,417.17 596.71,441.11 C575.82,478.94 540.85,516.05 501.00,542.68 C467.48,565.08 433.80,579.83 382.50,594.56 C356.26,602.10 342.95,607.05 331.50,613.53 C317.28,621.58 301.88,628.81 295.11,630.62 C291.47,631.58 288.21,632.81 287.85,633.33 C287.50,633.86 287.14,640.03 287.06,647.05 L 286.91 659.81 L 293.71 662.05 C297.44,663.28 309.08,668.24 319.56,673.08 C344.00,684.35 362.91,689.54 388.00,691.85 ZM 320.00 573.06 C326.33,575.16 331.95,576.91 332.50,576.94 C333.05,576.97 336.92,575.66 341.10,574.03 C345.28,572.41 359.01,568.11 371.60,564.48 C396.59,557.29 411.41,552.47 423.00,547.76 C435.97,542.49 434.99,542.18 414.50,545.02 C401.87,546.76 372.21,547.33 357.60,546.10 C339.20,544.54 318.57,540.98 298.72,535.91 C281.13,531.43 270.84,527.07 267.64,522.75 C264.61,518.65 265.09,513.45 268.86,509.68 C273.57,504.97 280.42,504.87 294.50,509.32 C336.66,522.63 383.88,526.11 425.66,518.98 C471.43,511.16 514.86,491.40 538.56,467.60 C549.58,456.53 559.81,441.26 576.47,411.00 C594.79,377.74 600.93,369.12 619.42,350.74 C633.43,336.81 636.30,332.16 639.00,319.02 C641.15,308.52 642.52,294.00 641.35,294.00 C640.88,294.00 638.58,299.97 636.24,307.25 C631.03,323.47 625.51,335.00 619.93,341.34 C617.46,344.15 609.66,350.11 601.10,355.71 C581.45,368.60 576.31,372.78 556.75,391.72 C547.54,400.65 535.84,411.41 530.75,415.65 C490.67,449.02 438.26,468.71 375.50,473.97 C359.52,475.31 336.99,475.27 312.05,473.85 C289.91,472.59 279.22,473.21 255.50,477.16 C248.90,478.26 238.55,479.24 232.51,479.33 L 221.52 479.50 L 217.38 491.00 L 213.24 502.50 L 218.37 506.95 C221.19,509.40 228.90,516.86 235.50,523.53 C258.78,547.07 280.98,560.08 320.00,573.06 ZM 510.22 774.94 C503.56,776.63 497.75,778.00 497.31,778.00 C496.86,778.00 494.63,777.07 492.33,775.94 C483.46,771.54 482.91,761.48 491.28,756.58 C493.60,755.22 503.59,751.80 513.48,748.98 C583.78,728.92 645.34,687.16 688.13,630.50 C712.35,598.44 731.93,556.44 740.58,518.03 C745.63,495.56 747.13,482.13 747.67,454.50 C747.95,440.20 748.59,426.85 749.10,424.82 C751.21,416.51 760.91,413.22 766.99,418.75 C771.14,422.53 772.00,428.14 772.00,451.53 C772.00,480.24 769.37,501.76 762.33,530.49 C749.62,582.43 720.16,635.73 682.52,674.88 C636.32,722.93 574.85,758.63 510.22,774.94 ZM 671.00 257.29 C679.05,258.70 727.64,257.37 739.87,255.41 L 743.25 254.86 L 742.53 246.68 C741.63,236.32 739.50,223.31 738.14,219.80 C736.68,216.06 733.20,215.35 709.50,214.02 C684.94,212.64 672.35,211.48 655.50,209.05 C632.03,205.67 628.84,205.55 625.82,207.93 C622.25,210.74 619.45,216.94 617.56,226.21 L 617.47 226.68 C616.12,233.32 615.54,236.18 616.65,238.01 C617.51,239.44 619.40,240.25 622.75,241.74 C637.82,248.46 658.33,255.07 671.00,257.29 Z" />
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

function IconCheckCircle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="16 10 11 14 8 11" className="check-mark" />
    </svg>
  )
}
