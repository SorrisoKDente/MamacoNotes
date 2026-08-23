import { useEffect } from 'react'
import { useAppStore } from '../store'
import { findShortcutAction, normalizeKey } from '../utils/shortcuts'
import { exportPageAsPng, exportPagesAsPdf } from '../utils/export'
import { toggleFullscreen } from '../utils/fullscreen'

export function initGlobalShortcuts(): () => void {
  const handler = (e: KeyboardEvent) => {
    const settings = useAppStore.getState().settings
    const normalized = normalizeKey(e)
    if (!normalized) return
    const action = findShortcutAction(settings.shortcuts, normalized)
    if (!action) return

    const s = useAppStore.getState()
    const target = e.target as HTMLElement | null
    const isTyping =
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)

    if (isTyping) return

    e.preventDefault()

    switch (action) {
      case 'pen':
        s.setTool('pen')
        break
      case 'eraser':
        s.setTool('eraser')
        break
      case 'highlighter':
        s.setTool('highlighter')
        break
      case 'text':
        s.setTool('text')
        break
      case 'undo':
        s.undo()
        break
      case 'redo':
        s.redo()
        break
      case 'zoomIn':
        window.dispatchEvent(new CustomEvent('ink:zoom', { detail: 1 }))
        break
      case 'zoomOut':
        window.dispatchEvent(new CustomEvent('ink:zoom', { detail: -1 }))
        break
      case 'zoomReset':
        window.dispatchEvent(new CustomEvent('ink:zoom', { detail: 0 }))
        break
      case 'recenter':
        window.dispatchEvent(new CustomEvent('ink:recenter'))
        break
      case 'sizeIncrease':
      case 'sizeDecrease': {
        const delta = action === 'sizeIncrease' ? 1 : -1
        adjustActiveSize(delta)
        break
      }
      case 'rotatePlus':
        s.rotatePageBy(s.currentPageIndex, 15)
        break
      case 'rotateMinus':
        s.rotatePageBy(s.currentPageIndex, -15)
        break
      case 'rotateReset':
        s.updatePage(s.currentPageIndex, { rotation: 0 })
        break
      case 'addPage':
        window.dispatchEvent(new CustomEvent('ink:add-page'))
        break
      case 'deletePage':
        s.deletePage(s.currentPageIndex)
        break
      case 'save':
        window.dispatchEvent(new CustomEvent('ink:save'))
        break
      case 'exportPng':
        void handleExportPng()
        break
      case 'exportPdf':
        void handleExportPdf()
        break
      case 'toggleSidebar':
        s.toggleSidebar()
        break
      case 'togglePageList':
        s.togglePageList()
        break
      case 'searchPages':
        s.toggleSearch()
        break
      case 'toggleFullscreen':
        void toggleFullscreen()
        break
      case 'toggleHideToolbar':
        void s.setSettings({ hideToolbar: !settings.hideToolbar })
        break
      case 'toggleHideTopBar':
        void s.setSettings({ hideTopBar: !settings.hideTopBar })
        break
      case 'toggleFreeRotate':
        void s.setSettings({ freeRotate: !settings.freeRotate })
        break
      case 'selectClick':
        s.setTool('select')
        void s.setSettings({ lastSelectMode: 'click' })
        break
      case 'selectFree':
        s.setTool('select')
        void s.setSettings({ lastSelectMode: 'free' })
        break
      case 'selectCircle':
        s.setTool('select')
        void s.setSettings({ lastSelectMode: 'circle' })
        break
      case 'selectRect':
        s.setTool('select')
        void s.setSettings({ lastSelectMode: 'rect' })
        break
      default:
        break
    }
  }

  window.addEventListener('keydown', handler, { capture: true })
  return () => window.removeEventListener('keydown', handler, { capture: true })
}

async function handleExportPng() {
  const s = useAppStore.getState()
  const notebook = s.notebooks.find((n) => n.id === s.selectedNotebookId)
  const page = notebook?.pages[s.currentPageIndex]
  if (!page) return
  await exportPageAsPng(page)
}

function adjustActiveSize(delta: number) {
  const s = useAppStore.getState()
  const st = s.settings
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
  switch (s.tool) {
    case 'pen':
      void s.setSettings({ lastPenSize: clamp(st.lastPenSize + delta, 1, 100) })
      break
    case 'highlighter':
      void s.setSettings({ lastHighlighterSize: clamp(st.lastHighlighterSize + delta, 1, 100) })
      break
    case 'eraser':
      void s.setSettings({ lastEraserSize: clamp(st.lastEraserSize + delta, 1, 100) })
      break
    case 'text':
      void s.setSettings({ lastTextFontSize: clamp(st.lastTextFontSize + delta, 8, 200) })
      break
    default:
      break
  }
}

async function handleExportPdf() {
  const s = useAppStore.getState()
  const notebook = s.notebooks.find((n) => n.id === s.selectedNotebookId)
  if (!notebook || notebook.pages.length === 0) return
  await exportPagesAsPdf(notebook.pages)
}

export function useEditorShortcuts() {
  useEffect(() => {
    return initGlobalShortcuts()
  }, [])
}
