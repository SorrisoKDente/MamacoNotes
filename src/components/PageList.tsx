import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { renderThumbnail } from '../renderer/thumbnail'
import { exportPageAsPng, exportPagesAsPdf } from '../utils/export'
import type { PageViewMode } from '../types'
import { isMobileNow } from '../hooks/useIsMobile'
import { useI18n } from '../i18n'
import { confirmAction } from './Modals'

export function PageList() {
  const { t } = useI18n()
  const notebook = useAppStore((s) =>
    s.notebooks.find((n) => n.id === s.selectedNotebookId),
  )
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const selectPage = useAppStore((s) => s.selectPage)
  const movePage = useAppStore((s) => s.movePage)
  const deletePage = useAppStore((s) => s.deletePage)
  const duplicatePage = useAppStore((s) => s.duplicatePage)
  const addPageAfter = useAppStore((s) => s.addPageAfter)
  const rotatePageBy = useAppStore((s) => s.rotatePageBy)
  const selectedPageIndices = useAppStore((s) => s.selectedPageIndices)
  const toggleSelectPage = useAppStore((s) => s.toggleSelectPage)
  const setPageSelection = useAppStore((s) => s.setPageSelection)
  const clearPageSelection = useAppStore((s) => s.clearPageSelection)
  const duplicateSelectedPages = useAppStore((s) => s.duplicateSelectedPages)
  const deleteSelectedPages = useAppStore((s) => s.deleteSelectedPages)
  const rotateSelectedPagesBy = useAppStore((s) => s.rotateSelectedPagesBy)
  const searchOpen = useAppStore((s) => s.searchOpen)
  const toggleSearch = useAppStore((s) => s.toggleSearch)
  const dataVersion = useAppStore((s) => s.dataVersion)
  const pageViewMode = useAppStore((s) => s.settings.pageViewMode)
  const setSettings = useAppStore((s) => s.setSettings)
  const { open } = useUiStore()

  const [searchTerm, setSearchTerm] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [menuPage, setMenuPage] = useState<number | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  useEffect(() => {
    if (menuPage === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuPage(null)
    }
    const onEsc = () => setMenuPage(null)
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (menuRef.current && menuRef.current.contains(t)) return
      if (t && t.closest('.page-thumb-menu-btn')) return
      setMenuPage(null)
    }
    const onScroll = () => setMenuPage(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('ink:esc', onEsc)
    window.addEventListener('click', onClick)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ink:esc', onEsc)
      window.removeEventListener('click', onClick)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuPage])

  useLayoutEffect(() => {
    if (menuPage === null || !menuPos || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const margin = 8
    let top = menuPos.top
    let left = menuPos.left
    if (rect.bottom > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin)
    }
    if (rect.right > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin)
    }
    if (top < margin) top = margin
    if (left < margin) left = margin
    el.style.top = `${top}px`
    el.style.left = `${left}px`
  }, [menuPage, menuPos])

  const pages = notebook?.pages ?? []

  const thumbTimesRef = useRef<Record<string, number>>({})
  const previousPagesRef = useRef<typeof pages | null>(null)

  useEffect(() => {
    if (previousPagesRef.current !== pages) {
      thumbTimesRef.current = {}
      previousPagesRef.current = pages
    }
    for (const p of pages) {
      const lastTime = thumbTimesRef.current[p.id]
      if (thumbs[p.id] && lastTime === p.updatedAt) continue
      thumbTimesRef.current = { ...thumbTimesRef.current, [p.id]: p.updatedAt }
      void (async () => {
        const thumb = await renderThumbnail(p, 160, 207)
        setThumbs((prev) => ({ ...prev, [p.id]: thumb }))
      })()
    }
  }, [pages, dataVersion])

  const filteredIndices = useMemo(() => {
    if (!searchTerm.trim()) return null
    const target = Number(searchTerm.trim())
    if (Number.isNaN(target)) return null
    if (target < 1 || target > pages.length) return []
    return [target - 1]
  }, [searchTerm, pages.length])

  const visibleIndices = filteredIndices ?? pages.map((_, i) => i)

  function onDrop(from: number, to: number) {
    if (from === to) return
    void movePage(from, to)
    setDragIndex(null)
    setOverIndex(null)
  }

  function safeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_')
  }

  function openMenu(i: number, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenuPage(menuPage === i ? null : i)
    if (menuPage !== i) {
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 12 })
    }
  }

  function handleThumbClick(i: number, e: React.MouseEvent) {
    if (e.shiftKey) {
      const anchor = anchorRef.current
      if (anchor !== null && anchor !== i) {
        const [from, to] = anchor < i ? [anchor, i] : [i, anchor]
        const range: number[] = []
        for (let k = from; k <= to; k += 1) range.push(k)
        setPageSelection(range)
      } else {
        setPageSelection([i])
        anchorRef.current = i
      }
      selectPage(i)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelectPage(i)
      return
    }
    clearPageSelection()
    anchorRef.current = i
    selectPage(i)
    if (isMobileNow()) useAppStore.getState().setPageListOpen(false)
  }

  async function handleDeleteSelectedPages() {
    const count = useAppStore.getState().selectedPageIndices.length
    if (count === 0) return
    if (await confirmAction(t('pageList.deletePagesTitle', { count }), t('pageList.deletePagesConfirm', { count }))) {
      await deleteSelectedPages()
    }
  }

  function handleExportSelectedPdf() {
    const st = useAppStore.getState()
    const nb = st.notebooks.find((n) => n.id === st.selectedNotebookId)
    const selected = st.selectedPageIndices
      .filter((i) => i >= 0 && i < (nb?.pages.length ?? 0))
      .sort((a, b) => a - b)
      .map((i) => nb?.pages[i])
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
    if (selected.length === 0) return
    const first = st.selectedPageIndices.length > 0 ? Math.min(...st.selectedPageIndices) + 1 : 1
    void exportPagesAsPdf(selected, `${safeName(nb?.name ?? 'paginas')}-paginas-${first}.pdf`)
  }

  function handleClearPageSelection() {
    clearPageSelection()
    resetAnchor()
  }

  function resetAnchor() {
    anchorRef.current = null
  }

  if (!notebook) {
    return null
  }

  const menuPageData = menuPage !== null ? pages[menuPage] : null

  return (
    <div className="page-list">
      <div className="page-list-header">
        <span>{t('pageList.title')}</span>
        <button className="icon-btn" onClick={() => open('addPagePicker')} title={t('pageList.addPage')}>
          <span className="icon icon-plus" />
        </button>
      </div>
      <div className="page-search">
        <input
          ref={searchInputRef}
          type="text"
          placeholder={t('pageList.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filteredIndices && filteredIndices.length > 0) {
              selectPage(filteredIndices[0])
            }
            if (e.key === 'Escape') {
              setSearchTerm('')
              toggleSearch()
            }
          }}
        />
      </div>

      <div className="page-view-mode">
        {(
          [
            { id: 'vertical', label: 'V', title: t('pageList.viewVertical') },
            { id: 'horizontal', label: 'H', title: t('pageList.viewHorizontal') },
            { id: 'separate', label: 'S', title: t('pageList.viewSeparate') },
          ] as { id: PageViewMode; label: string; title: string }[]
        ).map((m) => (
          <button
            key={m.id}
            className={`page-view-mode-btn ${pageViewMode === m.id ? 'active' : ''}`}
            onClick={() => setSettings({ pageViewMode: m.id })}
            title={m.title}
          >
            {m.label}
          </button>
        ))}
      </div>

      {selectedPageIndices.length > 0 && (
        <div className="selection-bar">
          <div className="selection-bar-header">
            <span className="selection-count">
              {t('pageList.pagesSelected', { count: selectedPageIndices.length })}
            </span>
            <button className="selection-close" title={t('pageList.clearSelection')} onClick={handleClearPageSelection}>
              ×
            </button>
          </div>
          <div className="selection-actions">
            <button onClick={() => void duplicateSelectedPages()} title={t('pageList.duplicateSelectedTitle')}>
              {t('sidebar.duplicate')}
            </button>
            <button onClick={handleExportSelectedPdf} title={t('pageList.exportPdfTitle')}>
              {t('pageList.downloadPdf')}
            </button>
            <button onClick={() => void rotateSelectedPagesBy(90)} title={t('pageList.rotateCwSelectedTitle')}>
              {t('pageList.rotateCw')}
            </button>
            <button onClick={() => void rotateSelectedPagesBy(-90)} title={t('pageList.rotateCcwSelectedTitle')}>
              {t('pageList.rotateCcw')}
            </button>
            <button className="danger" onClick={() => void handleDeleteSelectedPages()} title={t('pageList.deleteSelectedTitle')}>
              {t('tool.delete')}
            </button>
          </div>
        </div>
      )}

      <div className="page-thumbs">
        {visibleIndices.length === 0 && (
          <div className="page-thumbs-empty">{t('pageList.empty')}</div>
        )}
        {visibleIndices.map((i) => {
          const p = pages[i]
          const isCurrent = i === currentPageIndex
          const isSelected = selectedPageIndices.includes(i)
          return (
            <div
              key={p.id}
              className={`page-thumb-wrap ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''} ${dragIndex === i ? 'dragging' : ''} ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'over' : ''}`}
              onClick={(e) => handleThumbClick(i, e)}
              draggable
              onDragStart={(e) => {
                setDragIndex(i)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (overIndex !== i) setOverIndex(i)
              }}
              onDragLeave={() => setOverIndex(null)}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex !== null) onDrop(dragIndex, i)
              }}
              onDragEnd={() => {
                setDragIndex(null)
                setOverIndex(null)
              }}
            >
              <div className="page-thumb-index">{i + 1}</div>
              {p.rotation % 360 !== 0 && (
                <div className="page-thumb-badge">
                  <span className="icon icon-rotate" /> {p.rotation}°
                </div>
              )}
              <button
                className="page-thumb-menu-btn"
                title={t('pageList.pageOptions')}
                onClick={(e) => {
                  e.stopPropagation()
                  openMenu(i, e)
                }}
              >
                <span className="icon icon-dots" />
              </button>
              {thumbs[p.id] ? (
                <img src={thumbs[p.id]} alt={t('pageList.pageAlt', { index: i + 1 })} className="page-thumb-img" draggable={false} />
              ) : (
                <div className="page-thumb-loading" />
              )}
            </div>
          )
        })}
      </div>

      {menuPageData && menuPos && menuPage !== null && (
        <div
          ref={menuRef}
          className="page-thumb-menu page-thumb-menu-fixed"
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              void addPageAfter(menuPage, menuPageData.template)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-plus" /> {t('pageList.insertAfter')}
          </button>
          <button
            onClick={() => {
              void duplicatePage(menuPage)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-copy" /> {t('pageList.duplicatePage')}
          </button>
          <button
            onClick={() => {
              open('templatePicker', { template: menuPageData.template, index: menuPage })
              setMenuPage(null)
            }}
          >
            <span className="icon icon-grid" /> {t('pageList.pageTemplate')}
          </button>
          <button
            onClick={() => {
              open('backgroundColor', { index: menuPage })
              setMenuPage(null)
            }}
          >
            <span className="icon icon-palette" /> {t('pageList.backgroundColor')}
          </button>
          <div className="page-thumb-menu-sep" />
          <button
            onClick={() => {
              void exportPageAsPng(menuPageData, `${safeName(notebook.name)}-pagina-${menuPage + 1}.png`)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-image" /> {t('pageList.downloadPng')}
          </button>
          <button
            onClick={() => {
              void exportPagesAsPdf([menuPageData], `${safeName(notebook.name)}-pagina-${menuPage + 1}.pdf`)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-pdf" /> {t('pageList.downloadPdf')}
          </button>
          <div className="page-thumb-menu-sep" />
          <button
            onClick={() => {
              void rotatePageBy(menuPage, 90)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-rotate" /> {t('pageList.rotateCw')}
          </button>
          <button
            onClick={() => {
              void rotatePageBy(menuPage, -90)
              setMenuPage(null)
            }}
          >
            <span className="icon icon-rotate-ccw" /> {t('pageList.rotateCcw')}
          </button>
          <div className="page-thumb-menu-sep" />
          <button
            className="danger"
            onClick={() => {
              if (pages.length > 1) {
                void deletePage(menuPage)
              }
              setMenuPage(null)
            }}
          >
            <span className="icon icon-trash" /> {t('pageList.deletePage')}
          </button>
        </div>
      )}
    </div>
  )
}
