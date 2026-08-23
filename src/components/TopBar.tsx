import { useState } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { toggleFullscreen } from '../utils/fullscreen'
import { useI18n } from '../i18n'

export function TopBar() {
  const { t } = useI18n()
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const folders = useAppStore((s) => s.folders)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const pageListOpen = useAppStore((s) => s.pageListOpen)
  const togglePageList = useAppStore((s) => s.togglePageList)
  const setPageListOpen = useAppStore((s) => s.setPageListOpen)
  const layersOpen = useAppStore((s) => s.layersOpen)
  const toggleLayers = useAppStore((s) => s.toggleLayers)
  const updateNotebook = useAppStore((s) => s.updateNotebook)
  const hideTopBar = useAppStore((s) => s.settings.hideTopBar)
  const hideToolbar = useAppStore((s) => s.settings.hideToolbar)
  const hideSidebar = useAppStore((s) => s.settings.hideSidebar)
  const hidePageList = useAppStore((s) => s.settings.hidePageList)
  const setSettings = useAppStore((s) => s.setSettings)
  const { open } = useUiStore()

  const notebook = notebooks.find((n) => n.id === selectedNotebookId)
  const [editingName, setEditingName] = useState<string | null>(null)

  const folder = notebook?.folderId ? folders.find((f) => f.id === notebook.folderId) : null

  function commitName() {
    if (!notebook || editingName === null) return
    const name = editingName.trim() || notebook.name
    if (name !== notebook.name) {
      updateNotebook({ ...notebook, name })
    }
    setEditingName(null)
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="icon-btn"
          title={t('topbar.toggleSidebar')}
          onClick={() => {
            if (hideSidebar) {
              setSettings({ hideSidebar: false })
              setSidebarOpen(true)
              return
            }
            toggleSidebar()
          }}
        >
          <span className={sidebarOpen ? 'icon icon-panel-open' : 'icon icon-panel'} />
        </button>
        <button
          className="icon-btn"
          title={t('topbar.togglePageList')}
          onClick={() => {
            if (hidePageList) {
              setSettings({ hidePageList: false })
              setPageListOpen(true)
              return
            }
            togglePageList()
          }}
        >
          <span className={pageListOpen ? 'icon icon-page-list-open' : 'icon icon-page-list'} />
        </button>
        <button
          className="icon-btn"
          title={t('topbar.toggleLayers')}
          onClick={() => toggleLayers()}
        >
          <span className={layersOpen ? 'icon icon-layers-open' : 'icon icon-layers'} />
        </button>
        <button
          className="icon-btn hide-on-mobile"
          title={t('topbar.hideTopBar')}
          onClick={() => setSettings({ hideTopBar: !hideTopBar })}
        >
          <span className="icon icon-hide-topbar" />
        </button>
        <button
          className="icon-btn hide-on-mobile"
          title={t('topbar.hideToolbar')}
          onClick={() => setSettings({ hideToolbar: !hideToolbar })}
        >
          <span className="icon icon-hide-toolbar" />
        </button>
        <div className="topbar-brand">Mamaco Notes</div>
      </div>

      <div className="topbar-center">
        {notebook ? (
          <div className="notebook-title">
            <span className="notebook-breadcrumb">
              {folder ? `${folder.name} / ` : ''}
            </span>
            {editingName !== null ? (
              <input
                className="title-input"
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  if (e.key === 'Escape') setEditingName(null)
                }}
              />
            ) : (
              <button className="title-button" onClick={() => setEditingName(notebook.name)}>
                {notebook.name}
              </button>
            )}
          </div>
        ) : (
          <div className="notebook-title muted">{t('topbar.emptyTitle')}</div>
        )}
      </div>

      <div className="topbar-right">
        {notebook && (
          <>
            <button className="btn" onClick={() => open('importImage')}>
              <span className="icon icon-image" /> {t('topbar.image')}
            </button>
            <button className="btn" onClick={() => open('importPdf')}>
              <span className="icon icon-pdf" /> {t('topbar.pdf')}
            </button>
            <button className="btn" onClick={() => open('addPagePicker')}>
              <span className="icon icon-plus" /> {t('topbar.page')}
            </button>
            <button className="btn" onClick={() => open('export')}>
              <span className="icon icon-export" /> {t('topbar.export')}
            </button>
          </>
        )}
        <button className="btn" onClick={() => open('cloudSync')}>
          <span className="icon icon-cloud" /> {t('topbar.sync')}
        </button>
        <button className="btn" onClick={() => open('settings')}>
          <span className="icon icon-gear" /> {t('topbar.settings')}
        </button>
        <button className="icon-btn topbar-fullscreen" title={t('topbar.fullscreen')} onClick={toggleFullscreen}>
          <span className="icon icon-fullscreen" />
        </button>
      </div>
    </header>
  )
}
