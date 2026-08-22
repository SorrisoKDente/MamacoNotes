import { useEffect } from 'react'
import { useAppStore } from './store'
import { useUiStore } from './uiStore'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Editor } from './components/Editor'
import { Toolbar } from './components/Toolbar'
import { PageList } from './components/PageList'
import { LayersPanel } from './components/LayersPanel'
import { ModalsHost } from './components/Modals'
import { initGlobalShortcuts } from './hooks/useShortcuts'
import { useIsMobile } from './hooks/useIsMobile'
import { useI18n } from './i18n'
import { checkForUpdates } from './utils/updateCheck'

export default function App() {
  const { t } = useI18n()
  const loaded = useAppStore((s) => s.loaded)
  const init = useAppStore((s) => s.init)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const pageListOpen = useAppStore((s) => s.pageListOpen)
  const layersOpen = useAppStore((s) => s.layersOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const setPageListOpen = useAppStore((s) => s.setPageListOpen)
  const setLayersOpen = useAppStore((s) => s.setLayersOpen)
  const setSettings = useAppStore((s) => s.setSettings)
  const isMobile = useIsMobile()
  const hideTopBar = useAppStore((s) => s.settings.hideTopBar)
  const hideToolbar = useAppStore((s) => s.settings.hideToolbar)
  const hideSidebar = useAppStore((s) => s.settings.hideSidebar)
  const hidePageList = useAppStore((s) => s.settings.hidePageList)

  const anyBarHidden = hideTopBar || hideToolbar || hideSidebar || hidePageList
  const bothLeftHidden = hideSidebar && hidePageList

  useEffect(() => {
    init().then(() => {
      const s = useAppStore.getState()
      const cloud = s.settings.cloud
      if (cloud.enabled && cloud.autoSync && cloud.webdavUrl) {
        void s.syncNow()
      }

      // Check for updates
      void checkForUpdates().then((res) => {
        if (res && res.available && res.latestVersion !== s.settings.ignoreVersion) {
          useUiStore.getState().open('update', { info: res })
        }
      })
    })
    const cleanup = initGlobalShortcuts()
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('ink:esc'))
      }
    }
    const onSave = () => {
      const s = useAppStore.getState()
      const nb = s.notebooks.find((n) => n.id === s.selectedNotebookId)
      if (nb) void s.persistNotebook(nb)
    }
    const onRequestAddPage = () => {
      useUiStore.getState().open('addPagePicker')
    }
    window.addEventListener('keydown', onEsc)
    window.addEventListener('ink:save', onSave)
    window.addEventListener('ink:request-add-page', onRequestAddPage)
    return () => {
      cleanup()
      window.removeEventListener('keydown', onEsc)
      window.removeEventListener('ink:save', onSave)
      window.removeEventListener('ink:request-add-page', onRequestAddPage)
    }
  }, [init])

  useEffect(() => {
    const capacitorGlobal = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean }
    }
    if (!capacitorGlobal.Capacitor?.isNativePlatform?.()) return
    let removeBackButton: (() => void) | null = null
    let cancelled = false
    const initBackButton = async () => {
      try {
        const { App } = await import('@capacitor/app')
        const handle = await App.addListener('backButton', () => {
          window.dispatchEvent(new CustomEvent('ink:esc'))
        })
        if (cancelled) {
          void handle.remove()
        } else {
          removeBackButton = () => {
            void handle.remove()
          }
        }
      } catch {
        // noop
      }
    }
    void initBackButton()
    return () => {
      cancelled = true
      removeBackButton?.()
    }
  }, [])

  if (!loaded) {
    return <div className="app-loading">{t('app.loading')}</div>
  }

  return (
    <div className="app">
      {!hideTopBar && <TopBar />}
      <div className="app-body">
        {!hideSidebar && sidebarOpen && <Sidebar />}
        <div className="workspace">
          {!hidePageList && pageListOpen && <PageList />}
          <div className="editor-area">
            <Editor />
          </div>
          {layersOpen && <LayersPanel />}
          {!hideToolbar && <Toolbar />}
        </div>
      </div>
      {isMobile && (sidebarOpen || pageListOpen || layersOpen) && (
        <div
          className="drawer-backdrop"
          onClick={() => {
            if (sidebarOpen) setSidebarOpen(false)
            if (pageListOpen) setPageListOpen(false)
            if (layersOpen) setLayersOpen(false)
          }}
        />
      )}
      {anyBarHidden && (
        <>
          {hideTopBar && (
            <button
              className="ui-restore-btn top-center"
              title={t('topbar.restoreTopBar')}
              onClick={() => setSettings({ hideTopBar: false })}
            >
              <span className="icon icon-restore-bars" />
            </button>
          )}
          {hideToolbar && (
            <button
              className="ui-restore-btn right-center"
              title={t('topbar.restoreToolbar')}
              onClick={() => setSettings({ hideToolbar: false })}
            >
              <span className="icon icon-hide-toolbar" />
            </button>
          )}
          {hideSidebar && (
            <button
              className={`ui-restore-btn ${bothLeftHidden ? 'left-center-top' : 'left-center'}`}
              title={t('topbar.restoreSidebar')}
              onClick={() => setSettings({ hideSidebar: false })}
            >
              <span className="icon icon-panel" />
            </button>
          )}
          {hidePageList && (
            <button
              className={`ui-restore-btn ${bothLeftHidden ? 'left-center-bottom' : 'left-center'}`}
              title={t('topbar.restorePageList')}
              onClick={() => setSettings({ hidePageList: false })}
            >
              <span className="icon icon-page-list" />
            </button>
          )}
        </>
      )}
      <ModalsHost />
    </div>
  )
}
