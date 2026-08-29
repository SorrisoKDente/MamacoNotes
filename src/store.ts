import { create } from 'zustand'
import type {
  AppSettings,
  CloudSettings,
  CloudSyncState,
  ConflictChoice,
  DeleteScope,
  Folder,
  ImageElement,
  Layer,
  LayerFolder,
  Notebook,
  Page,
  PageTemplate,
  Stroke,
  SyncManifest,
  SyncResult,
  TemplateId,
  TextElement,
  ToolKind,
  TrashItem,
} from './types'
import {
  DEFAULT_SETTINGS,
  getActiveLayer,
  makeFolder,
  makeLayer,
  makeNotebook,
  makePage,
  newId,
  normalizePage,
  uid,
} from './types'
import { db } from './db'
import { isMobileNow } from './hooks/useIsMobile'
import { makeTransport } from './utils/webdav'
import {
  applyConflictChoices,
  FOLDERS_PATH,
  hashFolders,
  NOTEBOOKS_DIR,
  runSync,
  TOMBSTONE_RETENTION_MS,
} from './utils/sync'
import { useUiStore } from './uiStore'
import type { RenderedPdfPage } from './utils/pdf'
import { setLanguage, t } from './i18n'
import { detectLanguage } from './i18n/languages'

export interface UndoEntry {
  notebookId: string
  pageIndex: number
  pageSnapshot: Page
}

export function clonePage(page: Page): Page {
  return {
    ...page,
    layers: page.layers.map((l) => ({
      ...l,
      strokes: l.strokes.map((s) => ({ ...s, points: s.points.slice() })),
      images: l.images.map((i) => ({ ...i })),
      texts: l.texts.map((t) => ({ ...t })),
    })),
  }
}

export function cloneStrokeIds(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => ({ ...s, id: uid(), points: s.points.slice() }))
}

export function cloneImageIds(images: ImageElement[]): ImageElement[] {
  return images.map((i) => ({ ...i, id: uid() }))
}

export function cloneTextIds(texts: TextElement[]): TextElement[] {
  return texts.map((t) => ({ ...t, id: uid() }))
}

export function cloneLayerWithNewIds(layer: Layer): Layer {
  return {
    ...layer,
    id: uid(),
    strokes: cloneStrokeIds(layer.strokes),
    images: cloneImageIds(layer.images),
    texts: cloneTextIds(layer.texts),
  }
}

export function cloneNotebookForCopy(nb: Notebook, folderId: string | null): Notebook {
  const now = Date.now()
  return {
    ...nb,
    id: uid(),
    name: nb.name,
    folderId,
    createdAt: now,
    updatedAt: now,
    pages: nb.pages.map((p) => ({
      ...p,
      id: uid(),
      layers: p.layers.map((l) => cloneLayerWithNewIds(l)),
      activeLayerId: p.activeLayerId,
    })),
  }
}

export function cloneTemplatePages(pages: Page[]): Page[] {
  return pages.map((p) => ({
    ...p,
    id: uid(),
    layers: p.layers.map((l) => cloneLayerWithNewIds(l)),
    activeLayerId: p.activeLayerId,
  }))
}

export function sortNotebooksByOrder(notebooks: Notebook[]): Notebook[] {
  return notebooks.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function sortFoldersByOrder(folders: Folder[]): Folder[] {
  return folders.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function sortTrash(items: TrashItem[]): TrashItem[] {
  return items.slice().sort((a, b) => b.deletedAt - a.deletedAt)
}

/**
 * Resolves a notebook's `folderId` against the folders that actually exist.
 * A notebook whose folder never synced/imported (e.g. a blank `folders.json`
 * on the cloud) would otherwise be invisible in the sidebar — it is neither a
 * root notebook (`folderId === null`) nor listed under a known folder.
 * Returns `null` (root) for such orphaned references.
 */
export function normalizeNotebookFolder(
  nb: { folderId: string | null | undefined },
  folderIds: ReadonlySet<string>,
): string | null {
  const fid = nb.folderId ?? null
  if (fid === null) return null
  return folderIds.has(fid) ? fid : null
}

function nextOrder(orders: Array<number | undefined>): number {
  let max = -1
  for (const o of orders) {
    if (typeof o === 'number' && o > max) max = o
  }
  return max + 1
}

function topOfGroupInsertIndex(layers: Layer[], folderId: string | null): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    if ((layers[i].folderId ?? null) === folderId) return i + 1
  }
  return layers.length
}

function fillNotebookOrder(
  notebooks: Notebook[],
): { notebooks: Notebook[]; changed: Notebook[] } {
  const groups = new Map<string, Notebook[]>()
  for (const n of notebooks) {
    const k = n.folderId ?? ''
    const arr = groups.get(k)
    if (arr) arr.push(n)
    else groups.set(k, [n])
  }
  const out: Notebook[] = []
  const changed: Notebook[] = []
  for (const arr of groups.values()) {
    const anyOrder = arr.some((n) => typeof n.order === 'number')
    if (!anyOrder) {
      arr.forEach((n, i) => {
        const filled = { ...n, order: i }
        out.push(filled)
        changed.push(filled)
      })
    } else {
      const max = arr.reduce(
        (m, n) => (typeof n.order === 'number' ? Math.max(m, n.order) : m),
        -1,
      )
      let next = max + 1
      for (const n of arr) {
        if (typeof n.order === 'number') out.push(n)
        else {
          const filled = { ...n, order: next++ }
          out.push(filled)
          changed.push(filled)
        }
      }
    }
  }
  return { notebooks: sortNotebooksByOrder(out), changed }
}

function fillFolderOrder(
  folders: Folder[],
): { folders: Folder[]; changed: Folder[] } {
  const groups = new Map<string, Folder[]>()
  for (const f of folders) {
    const k = f.parentId ?? ''
    const arr = groups.get(k)
    if (arr) arr.push(f)
    else groups.set(k, [f])
  }
  const out: Folder[] = []
  const changed: Folder[] = []
  for (const arr of groups.values()) {
    const anyOrder = arr.some((f) => typeof f.order === 'number')
    if (!anyOrder) {
      arr.forEach((f, i) => {
        const filled = { ...f, order: i }
        out.push(filled)
        changed.push(filled)
      })
    } else {
      const max = arr.reduce(
        (m, f) => (typeof f.order === 'number' ? Math.max(m, f.order) : m),
        -1,
      )
      let next = max + 1
      for (const f of arr) {
        if (typeof f.order === 'number') out.push(f)
        else {
          const filled = { ...f, order: next++ }
          out.push(filled)
          changed.push(filled)
        }
      }
    }
  }
  return { folders: sortFoldersByOrder(out), changed }
}

interface PendingResume {
  cloud: CloudSettings
  state: CloudSyncState
  manifest: SyncManifest
}

const LAST_SESSION_KEY = 'mamaco-notes.last-session'

interface LastSession {
  notebookId: string | null
  pageId: string | null
}

function readLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastSession>
    return { notebookId: parsed.notebookId ?? null, pageId: parsed.pageId ?? null }
  } catch {
    return null
  }
}

function saveLastSession(notebookId: string, pageId: string | null): void {
  try {
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ notebookId, pageId }))
  } catch {
    /* noop */
  }
}

const LAST_PAGE_KEY = 'mamaco-notes.last-page'

function readLastPageMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LAST_PAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [id, pageId] of Object.entries(parsed)) {
      if (typeof pageId === 'string') out[id] = pageId
    }
    return out
  } catch {
    return {}
  }
}

function saveLastPage(notebookId: string, pageId: string | null): void {
  try {
    const map = readLastPageMap()
    if (pageId) map[notebookId] = pageId
    else delete map[notebookId]
    localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(map))
  } catch {
    /* noop */
  }
}

let syncRunning = false
let syncQueued = false
let syncDebounceTimer: ReturnType<typeof setTimeout> | undefined
let pendingResume: PendingResume | null = null

export type LastClickedTarget =
  | { type: 'folder'; id: string }
  | { type: 'notebook'; id: string }
  | { type: 'layer'; id: string }
  | { type: 'layerFolder'; id: string }
  | { type: 'notebookTitle' }
  | null

interface AppState {
  loaded: boolean
  folders: Folder[]
  notebooks: Notebook[]
  templates: PageTemplate[]
  trash: TrashItem[]
  settings: AppSettings
  dataVersion: number

  selectedFolderId: string | null
  selectedNotebookId: string | null
  selectedIds: string[]
  selectedPageIndices: number[]
  clipboard: { ids: string[]; cut: boolean } | null
  lastClicked: LastClickedTarget
  currentPageIndex: number
  tool: ToolKind
  sidebarOpen: boolean
  pageListOpen: boolean
  layersOpen: boolean
  searchOpen: boolean
  rotationOpen: boolean

  init: () => Promise<void>
  selectFolder: (id: string | null) => void
  selectNotebook: (id: string | null) => void
  selectPage: (index: number) => void
  setTool: (tool: ToolKind) => void
  setRotationOpen: (open: boolean) => void
  toggleSidebar: () => void
  togglePageList: () => void
  toggleLayers: () => void
  setSidebarOpen: (open: boolean) => void
  setPageListOpen: (open: boolean) => void
  setLayersOpen: (open: boolean) => void
  toggleSearch: () => void

  toggleSelect: (id: string) => void
  clearSelection: () => void
  setSelectedIds: (ids: string[]) => void
  setLastClicked: (target: LastClickedTarget) => void
  copySelected: () => void
  cutSelected: () => void
  pasteClipboard: () => Promise<void>
  duplicateSelected: () => Promise<void>
  deleteSelected: (scope?: DeleteScope) => Promise<void>

  toggleSelectPage: (index: number) => void
  setPageSelection: (indices: number[]) => void
  clearPageSelection: () => void
  duplicateSelectedPages: () => Promise<void>
  deleteSelectedPages: () => Promise<void>
  rotateSelectedPagesBy: (delta: number) => Promise<void>

  addFolder: (name: string, parentId?: string | null) => Promise<Folder>
  deleteFolder: (id: string, scope?: DeleteScope) => Promise<void>
  renameFolder: (id: string, name: string) => Promise<void>
  moveFolder: (id: string, newParentId: string | null) => Promise<void>
  reorderFolder: (id: string, parentId: string | null, beforeId: string | null) => Promise<void>
  duplicateFolder: (id: string) => Promise<void>
  copyFolder: (id: string, targetParentId: string | null) => Promise<string | null>
  createNotebook: (name: string, folderId: string | null, template: TemplateId) => Promise<Notebook>
  createNotebookFromTemplate: (
    name: string,
    folderId: string | null,
    template: PageTemplate,
  ) => Promise<Notebook>
  addTemplate: (name: string, pages: Page[]) => Promise<PageTemplate>
  deleteTemplate: (id: string) => Promise<void>
  addPagesFromTemplate: (template: PageTemplate) => Promise<void>
  applyTemplateToPage: (index: number, template: PageTemplate) => Promise<void>
  deleteNotebook: (id: string, scope?: DeleteScope) => Promise<void>
  moveNotebook: (id: string, folderId: string | null) => Promise<void>
  reorderNotebook: (id: string, folderId: string | null, beforeId: string | null) => Promise<void>
  copyNotebook: (id: string, folderId: string | null) => Promise<Notebook | null>
  duplicateNotebook: (id: string) => Promise<Notebook | null>
  updateNotebook: (notebook: Notebook) => Promise<void>

  addPage: (template: TemplateId) => Promise<void>
  addPageAfter: (index: number, template: TemplateId) => Promise<void>
  duplicatePage: (index: number) => Promise<void>
  deletePage: (index: number) => Promise<void>
  movePage: (from: number, to: number) => Promise<void>
  rotatePage: (index: number) => Promise<void>
  rotatePageBy: (index: number, delta: number) => Promise<void>
  updatePage: (index: number, patch: Partial<Page>) => Promise<void>

  addLayer: (folderId?: string | null) => Promise<void>
  renameLayer: (index: number, name: string) => Promise<void>
  duplicateLayer: (index: number) => Promise<void>
  deleteLayer: (index: number) => Promise<void>
  moveLayer: (from: number, to: number) => Promise<void>
  moveLayerToFolder: (
    from: number,
    folderId: string | null,
    beforeId: string | null,
  ) => Promise<void>
  setLayerVisible: (index: number, visible: boolean) => Promise<void>
  setLayerOpacity: (index: number, opacity: number) => Promise<void>
  setLayerLocked: (index: number, locked: boolean) => Promise<void>
  setActiveLayer: (id: string) => Promise<void>
  mergeSelectedLayers: (indices: number[]) => Promise<void>
  addLayerFolder: (name: string) => Promise<void>
  renameLayerFolder: (id: string, name: string) => Promise<void>
  deleteLayerFolder: (id: string) => Promise<void>
  reorderLayerFolder: (id: string, beforeId: string | null) => Promise<void>

  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  setShortcut: (action: keyof AppSettings['shortcuts'], value: string) => Promise<void>
  setCloud: (patch: Partial<AppSettings['cloud']>) => Promise<void>

  syncNow: () => Promise<SyncResult | null>
  resolveConflicts: (choices: Record<string, ConflictChoice>) => Promise<void>

  persistNotebook: (notebook: Notebook) => Promise<void>
  pushUndo: () => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  canUndo: boolean
  canRedo: boolean
  addImageToPage: (dataUrl: string, name: string, center?: { x: number; y: number }) => Promise<void>
  addPdfToPage: (dataUrl: string, name: string) => Promise<void>
  importPdfNotebook: (
    name: string,
    folderId: string | null,
    rendered: RenderedPdfPage[],
  ) => Promise<Notebook | null>
  restoreFromTrash: (id: string) => Promise<void>
  restoreFromCloud: (id: string) => Promise<void>
  purgeTrashItem: (id: string) => Promise<void>
  runTrashPurge: () => Promise<void>
  replaceAllData: (
    folders: Folder[],
    notebooks: Notebook[],
    settings?: AppSettings | null,
  ) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => {
  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []

  interface SyncChanges {
    pulledNotebooks: Notebook[]
    newNotebooks: Notebook[]
    removedLocalNotebookIds: string[]
    pulledFolders: Folder[] | null
  }

  async function applySyncChanges(changes: SyncChanges) {
    const prev = get()
    const foldersChanged =
      changes.pulledFolders !== null &&
      hashFolders(changes.pulledFolders) !== hashFolders(prev.folders)
    if (
      changes.pulledNotebooks.length === 0 &&
      changes.newNotebooks.length === 0 &&
      changes.removedLocalNotebookIds.length === 0 &&
      !foldersChanged
    ) {
      return
    }
    const removed = new Set(changes.removedLocalNotebookIds)
    let notebooks = prev.notebooks.filter((n) => !removed.has(n.id))

    // Effective folders after this change (pulled folders may create the folder
    // a notebook references). Notebooks whose folder is missing are placed at
    // root so they are never invisible.
    const effectiveFolderIds = new Set(
      (changes.pulledFolders ?? prev.folders).map((f) => f.id),
    )

    for (const nb of changes.pulledNotebooks) {
      const idx = notebooks.findIndex((n) => n.id === nb.id)
      const existing = idx >= 0 ? notebooks[idx] : undefined
      const norm: Notebook = {
        ...nb,
        folderId: normalizeNotebookFolder(nb, effectiveFolderIds),
        order: typeof nb.order === 'number' ? nb.order : existing?.order,
        pages: nb.pages.map((p) => normalizePage(p)),
      }
      if (norm.order === undefined) {
        norm.order = nextOrder(
          notebooks
            .filter((n) => (n.folderId ?? null) === (norm.folderId ?? null))
            .map((n) => n.order),
        )
      }
      if (idx >= 0) notebooks[idx] = norm
      else notebooks.push(norm)
      await db.putNotebook(norm)
    }
    for (const nb of changes.newNotebooks) {
      const resolvedFolderId = normalizeNotebookFolder(nb, effectiveFolderIds)
      const added: Notebook =
        typeof nb.order === 'number'
          ? { ...nb, folderId: resolvedFolderId }
          : {
              ...nb,
              folderId: resolvedFolderId,
              order: nextOrder(
                notebooks
                  .filter((n) => (n.folderId ?? null) === resolvedFolderId)
                  .map((n) => n.order),
              ),
            }
      notebooks.push(added)
      await db.putNotebook(added)
    }
    for (const id of changes.removedLocalNotebookIds) {
      await db.deleteNotebook(id)
    }
    notebooks = sortNotebooksByOrder(notebooks)

    let folders = changes.pulledFolders ?? prev.folders
    if (changes.pulledFolders) {
      const filled = fillFolderOrder(changes.pulledFolders)
      folders = filled.folders
      for (const f of filled.folders) await db.putFolder(f)
    }

    if (prev.selectedNotebookId && removed.has(prev.selectedNotebookId)) {
      set({
        folders,
        notebooks,
        selectedNotebookId: null,
        currentPageIndex: 0,
        lastClicked: null,
        dataVersion: get().dataVersion + 1,
      })
    } else {
      set({ folders, notebooks, dataVersion: get().dataVersion + 1 })
    }
  }

  function normalizeRestoredNotebook(nb: Notebook): Notebook {
    const folderIds = new Set(get().folders.map((f) => f.id))
    const norm: Notebook = {
      ...nb,
      folderId: normalizeNotebookFolder(nb, folderIds),
      order:
        typeof nb.order === 'number'
          ? nb.order
          : nextOrder(get().notebooks.map((n) => n.order)),
      pages: nb.pages.map((p) => normalizePage(p)),
    }
    return norm
  }

  async function removeTrashEntry(id: string): Promise<void> {
    await db.deleteTrashItem(id)
    set({ trash: get().trash.filter((x) => x.id !== id) })
  }

  async function updateNotebookStorage(notebook: Notebook) {
    notebook.updatedAt = Date.now()
    const notebooks = get().notebooks.map((n) => (n.id === notebook.id ? notebook : n))
    set({ notebooks, dataVersion: get().dataVersion + 1 })
    await db.putNotebook(notebook)
  }

  async function saveSettings(next: AppSettings) {
    set({ settings: next })
    await db.putSettings(next)
  }

  return {
    loaded: false,
    folders: [],
    notebooks: [],
    templates: [],
    trash: [],
    settings: DEFAULT_SETTINGS,
    dataVersion: 0,
    selectedFolderId: null,
    selectedNotebookId: null,
    selectedIds: [],
    selectedPageIndices: [],
    clipboard: null,
    lastClicked: null,
    currentPageIndex: 0,
    tool: 'pen',
    sidebarOpen: !isMobileNow(),
    pageListOpen: !isMobileNow(),
    searchOpen: false,
    rotationOpen: false,
    layersOpen: false,
    canUndo: false,
    canRedo: false,

    async init() {
      const [rawFolders, rawNotebooks, settings, templates, trashItems] = await Promise.all([
        db.getFolders(),
        db.getNotebooks(),
        db.getSettings(),
        db.getTemplates(),
        db.getTrash(),
      ])
      const folderIds = new Set(rawFolders.map((f) => f.id))
      const notebooks = rawNotebooks.map((nb) => ({
        ...nb,
        folderId: normalizeNotebookFolder(nb, folderIds),
        pages: nb.pages.map((p) => normalizePage(p)),
      }))
      const rawSettings: AppSettings =
        (settings as { lastSelectMode?: unknown }).lastSelectMode === 'image'
          ? { ...settings, lastSelectMode: 'click' as const }
          : settings
      const safeSettings: AppSettings = {
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        cloud: { ...DEFAULT_SETTINGS.cloud, ...(rawSettings.cloud ?? {}) },
        shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(rawSettings.shortcuts ?? {}) },
      }
      let selectedNotebookId: string | null = null
      let currentPageIndex = 0
      if (notebooks.length === 0) {
        const initial = makeNotebook('Eu vim ver o macaco', null)
        initial.order = 0
        initial.pages.push(makePage('blank'))
        notebooks.push(initial)
        await db.putNotebook(initial)
        selectedNotebookId = initial.id
      }
      const { notebooks: orderedNotebooks } = fillNotebookOrder(notebooks)
      const { folders: orderedFolders } = fillFolderOrder(rawFolders)
      if (selectedNotebookId === null) {
        const last = readLastSession()
        const nb = last?.notebookId
          ? orderedNotebooks.find((n) => n.id === last.notebookId)
          : undefined
        if (nb) {
          selectedNotebookId = nb.id
          if (last?.pageId) {
            const idx = nb.pages.findIndex((p) => p.id === last.pageId)
            if (idx >= 0) currentPageIndex = idx
          }
        }
      }
      set({
        folders: orderedFolders,
        notebooks: orderedNotebooks,
        templates,
        trash: trashItems,
        settings: safeSettings,
        selectedNotebookId,
        currentPageIndex,
        loaded: true,
      })
      setLanguage(settings.language === 'en' ? 'en' : 'pt-BR')
      if (settings.language === 'pt-BR' && detectLanguage() === 'en') {
        void get().setSettings({ language: 'en' })
      }
      void get().runTrashPurge()
    },

    selectFolder: (id) =>
      set({
        selectedFolderId: id,
        selectedNotebookId: null,
        currentPageIndex: 0,
        selectedIds: [],
        selectedPageIndices: [],
      }),
    selectNotebook: (id) => {
      let currentPageIndex = 0
      let folderId: string | null = null
      if (id) {
        const nb = get().notebooks.find((n) => n.id === id)
        folderId = nb?.folderId ?? null
        const pages = nb?.pages ?? []
        const pageId = readLastPageMap()[id]
        if (pageId) {
          const idx = pages.findIndex((p) => p.id === pageId)
          if (idx >= 0) currentPageIndex = idx
        }
      }
      set({
        selectedNotebookId: id,
        selectedFolderId: folderId,
        currentPageIndex,
        selectedIds: [],
        selectedPageIndices: [],
      })
    },
    selectPage: (index) => set({ currentPageIndex: index }),
    setTool: (tool) => set({ tool }),
    setRotationOpen: (open) => set({ rotationOpen: open }),
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    togglePageList: () => set((s) => ({ pageListOpen: !s.pageListOpen })),
    toggleLayers: () => set((s) => ({ layersOpen: !s.layersOpen })),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setPageListOpen: (open) => set({ pageListOpen: open }),
    setLayersOpen: (open) => set({ layersOpen: open }),
    toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

    toggleSelect: (id) => {
      const selectedIds = get().selectedIds
      if (selectedIds.includes(id)) {
        set({ selectedIds: selectedIds.filter((x) => x !== id) })
      } else {
        set({ selectedIds: [...selectedIds, id] })
      }
    },

    clearSelection: () => set({ selectedIds: [] }),

    setSelectedIds: (ids) => set({ selectedIds: ids }),

    setLastClicked: (target) => set({ lastClicked: target }),

    toggleSelectPage: (index) => {
      const selectedPageIndices = get().selectedPageIndices
      if (selectedPageIndices.includes(index)) {
        set({ selectedPageIndices: selectedPageIndices.filter((x) => x !== index) })
      } else {
        set({ selectedPageIndices: [...selectedPageIndices, index] })
      }
    },

    setPageSelection: (indices) => set({ selectedPageIndices: indices }),

    clearPageSelection: () => set({ selectedPageIndices: [] }),

    async duplicateSelectedPages() {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const selected = [...get().selectedPageIndices]
        .filter((i) => i >= 0 && i < notebook.pages.length)
        .sort((a, b) => b - a)
      if (selected.length === 0) return
      const cloneIndices: number[] = []
      for (const i of selected) {
        const src = notebook.pages[i]
        const clone: Page = {
          ...src,
          id: uid(),
          layers: src.layers.map((l) => cloneLayerWithNewIds(l)),
          activeLayerId: src.activeLayerId,
        }
        notebook.pages.splice(i + 1, 0, clone)
        cloneIndices.push(i + 1)
      }
      notebook.updatedAt = Date.now()
      const newSel = cloneIndices.sort((a, b) => a - b)
      set({ currentPageIndex: newSel[newSel.length - 1], selectedPageIndices: newSel })
      await updateNotebookStorage(notebook)
    },

    async deleteSelectedPages() {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook || notebook.pages.length <= 1) return
      const toDelete = [...get().selectedPageIndices]
        .filter((i) => i >= 0 && i < notebook.pages.length)
        .sort((a, b) => b - a)
      if (toDelete.length === 0) {
        set({ selectedPageIndices: [] })
        return
      }
      while (toDelete.length >= notebook.pages.length) toDelete.pop()
      if (toDelete.length === 0) {
        set({ selectedPageIndices: [] })
        return
      }
      const cur = get().currentPageIndex
      let newCur = cur
      for (const i of toDelete) {
        notebook.pages.splice(i, 1)
        if (i < cur) newCur -= 1
      }
      newCur = Math.max(0, Math.min(newCur, notebook.pages.length - 1))
      notebook.updatedAt = Date.now()
      set({ currentPageIndex: newCur, selectedPageIndices: [] })
      await updateNotebookStorage(notebook)
    },

    async rotateSelectedPagesBy(delta) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const selected = [...get().selectedPageIndices].filter(
        (i) => i >= 0 && i < notebook.pages.length,
      )
      if (selected.length === 0) return
      for (const i of selected) {
        const page = notebook.pages[i]
        page.rotation = (((page.rotation + delta) % 360) + 360) % 360
        page.updatedAt = Date.now()
      }
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    copySelected: () => {
      const ids = get().selectedIds
      if (ids.length === 0) return
      set({ clipboard: { ids: [...ids], cut: false } })
    },

    cutSelected: () => {
      const ids = get().selectedIds
      if (ids.length === 0) return
      set({ clipboard: { ids: [...ids], cut: true } })
    },

    async pasteClipboard() {
      const clip = get().clipboard
      if (!clip || clip.ids.length === 0) return
      const target = get().selectedFolderId
      for (const id of clip.ids) {
        if (get().notebooks.some((n) => n.id === id)) {
          if (clip.cut) {
            await get().moveNotebook(id, target)
          } else {
            await get().copyNotebook(id, target)
          }
        } else if (get().folders.some((f) => f.id === id)) {
          if (clip.cut) {
            await get().moveFolder(id, target)
          } else {
            await get().copyFolder(id, target)
          }
        }
      }
      set({ clipboard: null, selectedIds: [] })
    },

    async duplicateSelected() {
      const ids = [...get().selectedIds]
      for (const id of ids) {
        if (get().notebooks.some((n) => n.id === id)) {
          await get().duplicateNotebook(id)
        } else if (get().folders.some((f) => f.id === id)) {
          await get().duplicateFolder(id)
        }
      }
    },

    async deleteSelected(scope) {
      const ids = [...get().selectedIds]
      for (const id of ids) {
        if (get().notebooks.some((n) => n.id === id)) {
          await get().deleteNotebook(id, scope)
        } else if (get().folders.some((f) => f.id === id)) {
          await get().deleteFolder(id, scope)
        }
      }
      set({ selectedIds: [] })
    },

    async addFolder(name, parentId = null) {
      const folder = makeFolder(name, parentId)
      folder.order = nextOrder(
        get()
          .folders.filter((f) => (f.parentId ?? null) === (parentId ?? null))
          .map((f) => f.order),
      )
      const folders = sortFoldersByOrder([...get().folders, folder])
      set({ folders })
      await db.putFolder(folder)
      return folder
    },

    async deleteFolder(id, scope) {
      const allFolders = get().folders
      const allNotebooks = get().notebooks
      const toDelete = new Set<string>()
      const collect = (fid: string) => {
        if (toDelete.has(fid)) return
        toDelete.add(fid)
        for (const f of allFolders) {
          if (f.parentId === fid) collect(f.id)
        }
      }
      collect(id)
      const childNotebooks = allNotebooks.filter((n) => n.folderId && toDelete.has(n.folderId))
      const notebooks = allNotebooks.filter((n) => !n.folderId || !toDelete.has(n.folderId))
      const folders = allFolders.filter((f) => !toDelete.has(f.id))
      const removedIds = new Set([...toDelete, ...childNotebooks.map((n) => n.id)])
      const selectedIds = get().selectedIds.filter((sid) => !removedIds.has(sid))
      const lastClicked = get().lastClicked
      if (
        lastClicked &&
        ((lastClicked.type === 'folder' && removedIds.has(lastClicked.id)) ||
          (lastClicked.type === 'notebook' && removedIds.has(lastClicked.id)))
      ) {
        set({ lastClicked: null })
      }
      set({ folders, notebooks, selectedIds })
      if (get().selectedFolderId && toDelete.has(get().selectedFolderId!)) {
        set({ selectedFolderId: null, selectedNotebookId: null, currentPageIndex: 0 })
      }
      const cloud = get().settings.cloud
      const configured = !!cloud.webdavUrl
      const scopeRemote = scope === 'remote' || (scope === undefined && cloud.enabled)
      const cloudKeepsCopy = scope === 'local' && configured
      if (configured) {
        const state = await db.getCloudSyncState()
        const now = Date.now()
        if (scopeRemote) {
          for (const nb of childNotebooks) state.tombstones[nb.id] = now
        } else if (scope === 'local') {
          for (const nb of childNotebooks) {
            state.localOnlyDeleted[nb.id] = now
            delete state.notebooks[nb.id]
          }
          state.foldersHash = hashFolders(folders)
        }
        await db.putCloudSyncState(state)
      }
      const deletedAt = Date.now()
      const trashItems: TrashItem[] = []
      for (const f of allFolders) {
        if (!toDelete.has(f.id)) continue
        trashItems.push({
          id: f.id,
          kind: 'folder',
          name: f.name,
          parentId: f.parentId,
          data: { ...f },
          deletedAt,
          cloudKeepsCopy,
        })
      }
      for (const nb of childNotebooks) {
        trashItems.push({
          id: nb.id,
          kind: 'notebook',
          name: nb.name,
          parentId: nb.folderId,
          data: cloudKeepsCopy ? null : { ...nb },
          deletedAt,
          cloudKeepsCopy,
        })
      }
      for (const item of trashItems) {
        await db.putTrashItem(item)
      }
      set({ trash: sortTrash([...trashItems, ...get().trash]) })
      for (const fid of toDelete) {
        await db.deleteFolder(fid)
      }
      for (const nb of childNotebooks) {
        await db.deleteNotebook(nb.id)
      }
      if (configured && scope === 'remote') {
        void get().syncNow()
      }
    },

    async renameFolder(id, name) {
      const folders = get().folders.map((f) => (f.id === id ? { ...f, name } : f))
      set({ folders })
      const folder = folders.find((f) => f.id === id)
      if (folder) await db.putFolder(folder)
    },

    async reorderFolder(id, parentId, beforeId) {
      const folder = get().folders.find((f) => f.id === id)
      if (!folder) return
      if (id === parentId) return
      let cur = parentId
      while (cur) {
        if (cur === id) return
        cur = get().folders.find((f) => f.id === cur)?.parentId ?? null
      }
      const siblings = sortFoldersByOrder(
        get().folders.filter((f) => (f.parentId ?? null) === (parentId ?? null) && f.id !== id),
      )
      const dragged = { ...folder, parentId }
      const list: Folder[] = []
      if (beforeId) {
        const idx = siblings.findIndex((s) => s.id === beforeId)
        if (idx >= 0) list.push(...siblings.slice(0, idx), dragged, ...siblings.slice(idx))
        else list.push(...siblings, dragged)
      } else {
        list.push(...siblings, dragged)
      }
      const changed = new Map<string, Folder>()
      list.forEach((s, i) => {
        if (s.id === id) {
          if (s.parentId !== parentId || s.order !== i) {
            changed.set(s.id, { ...s, parentId, order: i })
          }
        } else if (s.order !== i) {
          changed.set(s.id, { ...s, order: i })
        }
      })
      if (changed.size === 0) return
      const folders = sortFoldersByOrder(
        get().folders.map((f) => changed.get(f.id) ?? f),
      )
      set({ folders, dataVersion: get().dataVersion + 1 })
      for (const c of changed.values()) await db.putFolder(c)
    },

    async moveFolder(id, newParentId) {
      await get().reorderFolder(id, newParentId, null)
    },

    async duplicateFolder(id) {
      const src = get().folders.find((f) => f.id === id)
      if (!src) return
      const idMap = new Map<string, string>()
      const collect = (fid: string, newParentId: string | null) => {
        const f = get().folders.find((x) => x.id === fid)
        if (!f) return
        const newFolder = makeFolder(f.name + t('copySuffix'), newParentId)
        newFolder.order = nextOrder(
          get()
            .folders.filter((x) => (x.parentId ?? null) === (newParentId ?? null))
            .map((x) => x.order),
        )
        idMap.set(fid, newFolder.id)
        get().folders.push(newFolder)
        void db.putFolder(newFolder)
        for (const child of get().folders.filter((x) => x.parentId === fid)) {
          collect(child.id, newFolder.id)
        }
        for (const nb of get().notebooks.filter((x) => x.folderId === fid)) {
          const clone = cloneNotebookForCopy(nb, newFolder.id)
          clone.name = nb.name + t('copySuffix')
          get().notebooks.push(clone)
          void db.putNotebook(clone)
        }
      }
      collect(id, null)
      set({
        folders: sortFoldersByOrder([...get().folders]),
        notebooks: sortNotebooksByOrder([...get().notebooks]),
      })
    },

    async copyFolder(id, targetParentId) {
      const src = get().folders.find((f) => f.id === id)
      if (!src) return null
      const collect = (fid: string, newParentId: string | null): string | null => {
        const f = get().folders.find((x) => x.id === fid)
        if (!f) return null
        const newFolder = makeFolder(f.name, newParentId)
        if (fid === id) newFolder.name = f.name + t('copySuffix')
        newFolder.order = nextOrder(
          get()
            .folders.filter((x) => (x.parentId ?? null) === (newParentId ?? null))
            .map((x) => x.order),
        )
        get().folders.push(newFolder)
        void db.putFolder(newFolder)
        for (const child of get().folders.filter((x) => x.parentId === fid)) {
          collect(child.id, newFolder.id)
        }
        for (const nb of get().notebooks.filter((x) => x.folderId === fid)) {
          const clone = cloneNotebookForCopy(nb, newFolder.id)
          clone.name = nb.name + t('copySuffix')
          get().notebooks.push(clone)
          void db.putNotebook(clone)
        }
        return newFolder.id
      }
      const root = collect(id, targetParentId)
      if (root) {
        set({
          folders: sortFoldersByOrder([...get().folders]),
          notebooks: sortNotebooksByOrder([...get().notebooks]),
        })
      }
      return root
    },

    async createNotebook(name, folderId, template) {
      const notebook = makeNotebook(name, folderId)
      notebook.order = 0
      notebook.pages.push(makePage(template))
      const notebooks = sortNotebooksByOrder([notebook, ...get().notebooks])
      set({ notebooks, selectedNotebookId: notebook.id, currentPageIndex: 0 })
      await db.putNotebook(notebook)
      return notebook
    },

    async createNotebookFromTemplate(name, folderId, template) {
      const notebook = makeNotebook(name, folderId)
      notebook.order = 0
      notebook.pages = cloneTemplatePages(template.pages)
      if (notebook.pages.length === 0) notebook.pages.push(makePage('blank'))
      notebook.updatedAt = Date.now()
      const notebooks = sortNotebooksByOrder([notebook, ...get().notebooks])
      set({ notebooks, selectedNotebookId: notebook.id, currentPageIndex: 0 })
      await db.putNotebook(notebook)
      return notebook
    },

    async addTemplate(name, pages) {
      const template: PageTemplate = {
        id: uid(),
        name,
        createdAt: Date.now(),
        pages: cloneTemplatePages(pages),
      }
      const templates = [template, ...get().templates]
      set({ templates })
      await db.putTemplate(template)
      return template
    },

    async deleteTemplate(id) {
      const templates = get().templates.filter((t) => t.id !== id)
      set({ templates })
      await db.deleteTemplate(id)
    },

    async addPagesFromTemplate(template) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const ref = notebook.pages[0]
      const pages = cloneTemplatePages(template.pages).map((p) => ({
        ...p,
        width: ref?.width ?? p.width,
        height: ref?.height ?? p.height,
      }))
      notebook.pages.push(...pages)
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
      set({ currentPageIndex: notebook.pages.length - 1 })
    },

    async applyTemplateToPage(index, template) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const ref = notebook.pages[Math.max(0, Math.min(index, notebook.pages.length - 1))]
      if (!ref) return
      const page = cloneTemplatePages(template.pages)[0] ?? makePage('blank')
      page.id = ref.id
      page.createdAt = ref.createdAt
      page.width = ref.width
      page.height = ref.height
      page.rotation = ref.rotation
      page.updatedAt = Date.now()
      notebook.pages[index] = page
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async deleteNotebook(id, scope) {
      const cloud = get().settings.cloud
      const configured = !!cloud.webdavUrl
      const scopeRemote = scope === 'remote' || (scope === undefined && cloud.enabled)
      const cloudKeepsCopy = scope === 'local' && configured
      if (configured) {
        const state = await db.getCloudSyncState()
        if (scopeRemote) {
          state.tombstones[id] = Date.now()
        } else if (scope === 'local') {
          state.localOnlyDeleted[id] = Date.now()
          delete state.notebooks[id]
        }
        await db.putCloudSyncState(state)
      }
      const nb = get().notebooks.find((n) => n.id === id)
      const notebooks = get().notebooks.filter((n) => n.id !== id)
      const selectedIds = get().selectedIds.filter((sid) => sid !== id)
      const lastClicked = get().lastClicked
      if (lastClicked && lastClicked.type === 'notebook' && lastClicked.id === id) {
        set({ lastClicked: null })
      }
      set({ notebooks, selectedIds })
      if (get().selectedNotebookId === id) {
        set({ selectedNotebookId: null, currentPageIndex: 0 })
      }
      if (nb) {
        const item: TrashItem = {
          id,
          kind: 'notebook',
          name: nb.name,
          parentId: nb.folderId,
          data: cloudKeepsCopy ? null : { ...nb },
          deletedAt: Date.now(),
          cloudKeepsCopy,
        }
        await db.putTrashItem(item)
        set({ trash: sortTrash([item, ...get().trash]) })
      }
      await db.deleteNotebook(id)
      if (configured && scope === 'remote') {
        void get().syncNow()
      }
    },

    async reorderNotebook(id, folderId, beforeId) {
      const nb = get().notebooks.find((n) => n.id === id)
      if (!nb) return
      const now = Date.now()
      const siblings = sortNotebooksByOrder(
        get().notebooks.filter((n) => (n.folderId ?? null) === (folderId ?? null) && n.id !== id),
      )
      const dragged = { ...nb, folderId }
      const list: Notebook[] = []
      if (beforeId) {
        const idx = siblings.findIndex((s) => s.id === beforeId)
        if (idx >= 0) list.push(...siblings.slice(0, idx), dragged, ...siblings.slice(idx))
        else list.push(...siblings, dragged)
      } else {
        list.push(...siblings, dragged)
      }
      const changed = new Map<string, Notebook>()
      list.forEach((s, i) => {
        if (s.id === id) {
          if (s.folderId !== folderId || s.order !== i) {
            changed.set(s.id, { ...s, folderId, order: i, updatedAt: now })
          }
        } else if (s.order !== i) {
          changed.set(s.id, { ...s, order: i, updatedAt: now })
        }
      })
      if (changed.size === 0) return
      const notebooks = sortNotebooksByOrder(
        get().notebooks.map((n) => changed.get(n.id) ?? n),
      )
      set({ notebooks, dataVersion: get().dataVersion + 1 })
      for (const c of changed.values()) await db.putNotebook(c)
    },

    async moveNotebook(id, folderId) {
      await get().reorderNotebook(id, folderId, null)
    },

    async copyNotebook(id, folderId) {
      const src = get().notebooks.find((n) => n.id === id)
      if (!src) return null
      const clone = cloneNotebookForCopy(src, folderId)
      clone.name = src.name + t('copySuffix')
      clone.order = 0
      const notebooks = sortNotebooksByOrder([clone, ...get().notebooks])
      set({ notebooks })
      await db.putNotebook(clone)
      return clone
    },

    async duplicateNotebook(id) {
      const src = get().notebooks.find((n) => n.id === id)
      if (!src) return null
      const clone = cloneNotebookForCopy(src, src.folderId)
      clone.name = src.name + t('copySuffix')
      const notebooks = sortNotebooksByOrder([...get().notebooks])
      const idx = notebooks.findIndex((n) => n.id === id)
      notebooks.splice(idx + 1, 0, clone)
      set({ notebooks: sortNotebooksByOrder(notebooks) })
      await db.putNotebook(clone)
      return clone
    },

    async updateNotebook(notebook) {
      await updateNotebookStorage(notebook)
    },

    async addPage(template) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = makePage(template, {
        width: notebook.pages[0]?.width,
        height: notebook.pages[0]?.height,
      })
      notebook.pages.push(page)
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
      set({ currentPageIndex: notebook.pages.length - 1 })
    },

    async addPageAfter(index, template) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const ref = notebook.pages[Math.max(0, Math.min(index, notebook.pages.length - 1))]
      const page = makePage(template, {
        width: ref?.width,
        height: ref?.height,
      })
      notebook.pages.splice(Math.max(0, Math.min(index, notebook.pages.length - 1)) + 1, 0, page)
      notebook.updatedAt = Date.now()
      const newIndex = Math.max(0, Math.min(index, notebook.pages.length - 1)) + 1
      const selectedPageIndices = get().selectedPageIndices.map((x) => (x >= newIndex ? x + 1 : x))
      await updateNotebookStorage(notebook)
      set({ currentPageIndex: newIndex, selectedPageIndices })
    },

    async duplicatePage(index) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const src = notebook.pages[index]
      if (!src) return
      const clone: Page = {
        ...src,
        id: uid(),
        layers: src.layers.map((l) => cloneLayerWithNewIds(l)),
        activeLayerId: src.activeLayerId,
      }
      notebook.pages.splice(index + 1, 0, clone)
      notebook.updatedAt = Date.now()
      const cloneIndex = index + 1
      const selectedPageIndices = get().selectedPageIndices.map((x) =>
        x >= cloneIndex ? x + 1 : x,
      )
      await updateNotebookStorage(notebook)
      set({ currentPageIndex: cloneIndex, selectedPageIndices })
    },

    async deletePage(index) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      if (notebook.pages.length <= 1) return
      notebook.pages.splice(index, 1)
      notebook.updatedAt = Date.now()
      const cur = get().currentPageIndex
      const next = Math.min(Math.max(cur, 1), notebook.pages.length - 1)
      const selectedPageIndices = get()
        .selectedPageIndices.filter((x) => x !== index)
        .map((x) => (x > index ? x - 1 : x))
        .filter((x) => x < notebook.pages.length)
      set({ currentPageIndex: next, selectedPageIndices })
      await updateNotebookStorage(notebook)
    },

    async movePage(from, to) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const [page] = notebook.pages.splice(from, 1)
      notebook.pages.splice(to, 0, page)
      notebook.updatedAt = Date.now()
      let cur = get().currentPageIndex
      if (from === cur) cur = to
      else if (from < cur && to >= cur) cur -= 1
      else if (from > cur && to <= cur) cur += 1
      set({ currentPageIndex: cur, selectedPageIndices: [] })
      await updateNotebookStorage(notebook)
    },

    async rotatePage(index) {
      await get().rotatePageBy(index, 90)
    },

    async rotatePageBy(index, delta) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[index]
      page.rotation = (((page.rotation + delta) % 360) + 360) % 360
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async updatePage(index, patch) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[index]
      Object.assign(page, patch, { updatedAt: Date.now() })
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async addLayer(folderId) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page || page.layers.length === 0) return
      get().pushUndo()
      let maxN = 0
      for (const l of page.layers) {
        const m = /^Camada (\d+)$/.exec(l.name)
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10))
      }
      const layer = makeLayer(`Camada ${maxN + 1}`)
      const targetFolder = folderId ?? null
      let insertAt: number
      if (targetFolder !== null) {
        layer.folderId = targetFolder
        insertAt = topOfGroupInsertIndex(page.layers, targetFolder)
      } else {
        const activeIdx = page.layers.findIndex((l) => l.id === page.activeLayerId)
        insertAt = activeIdx >= 0 ? activeIdx + 1 : page.layers.length
      }
      page.layers.splice(insertAt, 0, layer)
      page.activeLayerId = layer.id
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async renameLayer(index, name) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = page.layers[index]
      if (!layer) return
      const trimmed = name.trim()
      if (trimmed === layer.name) return
      get().pushUndo()
      layer.name = trimmed || layer.name
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async duplicateLayer(index) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = page.layers[index]
      if (!layer) return
      get().pushUndo()
      const clone = cloneLayerWithNewIds(layer)
      page.layers.splice(index + 1, 0, clone)
      page.activeLayerId = clone.id
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async deleteLayer(index) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page || page.layers.length <= 1) return
      const layer = page.layers[index]
      if (!layer) return
      const wasActive = layer.id === page.activeLayerId
      get().pushUndo()
      page.layers.splice(index, 1)
      const lastClicked = get().lastClicked
      if (lastClicked && lastClicked.type === 'layer' && lastClicked.id === layer.id) {
        set({ lastClicked: null })
      }
      if (wasActive) {
        const below = page.layers[index - 1]
        const above = page.layers[index]
        page.activeLayerId = (below ?? above)?.id ?? page.layers[page.layers.length - 1]?.id ?? null
      }
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async moveLayer(from, to) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page || page.layers.length === 0) return
      const len = page.layers.length
      const f = Math.max(0, Math.min(from, len - 1))
      const t = Math.max(0, Math.min(to, len - 1))
      if (f === t) return
      get().pushUndo()
      const [layer] = page.layers.splice(f, 1)
      page.layers.splice(t, 0, layer)
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async moveLayerToFolder(from, folderId, beforeId) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page || page.layers.length === 0) return
      const layer = page.layers[from]
      if (!layer) return
      const target = folderId ?? null
      const rest = page.layers.filter((_, i) => i !== from)
      let insertAt: number
      if (beforeId !== null) {
        const idx = rest.findIndex((l) => l.id === beforeId)
        insertAt = idx >= 0 ? idx : rest.length
      } else {
        let hi = -1
        for (let i = 0; i < rest.length; i++) {
          if ((rest[i].folderId ?? null) === target) hi = i
        }
        insertAt = hi >= 0 ? hi + 1 : (layer.folderId ?? null) === target ? from : rest.length
      }
      if ((layer.folderId ?? null) === target && insertAt === from) return
      get().pushUndo()
      page.layers.splice(from, 1)
      layer.folderId = target
      page.layers.splice(insertAt, 0, layer)
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async addLayerFolder(name) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const trimmed = name.trim()
      if (!trimmed) return
      get().pushUndo()
      const folders = page.layerFolders ?? []
      const folder: LayerFolder = {
        id: newId(),
        name: trimmed,
        order: nextOrder(folders.map((f) => f.order)),
      }
      folders.push(folder)
      page.layerFolders = folders
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async renameLayerFolder(id, name) {
      const nb = get().selectedNotebookId
      if (!nb) return
      const notebook = get().notebooks.find((n) => n.id === nb)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const folder = (page.layerFolders ?? []).find((f) => f.id === id)
      if (!folder) return
      const trimmed = name.trim()
      if (trimmed === folder.name) return
      get().pushUndo()
      folder.name = trimmed || folder.name
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async deleteLayerFolder(id) {
      const nb = get().selectedNotebookId
      if (!nb) return
      const notebook = get().notebooks.find((n) => n.id === nb)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const folders = page.layerFolders ?? []
      if (!folders.some((f) => f.id === id)) return
      get().pushUndo()
      page.layerFolders = folders.filter((f) => f.id !== id)
      const lastClicked = get().lastClicked
      if (lastClicked && lastClicked.type === 'layerFolder' && lastClicked.id === id) {
        set({ lastClicked: null })
      }
      for (const l of page.layers) {
        if ((l.folderId ?? null) === id) l.folderId = null
      }
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async reorderLayerFolder(id, beforeId) {
      const nb = get().selectedNotebookId
      if (!nb) return
      const notebook = get().notebooks.find((n) => n.id === nb)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const folders = page.layerFolders ?? []
      const folder = folders.find((f) => f.id === id)
      if (!folder) return
      const siblings = folders.filter((f) => f.id !== id)
      const list: LayerFolder[] = []
      if (beforeId) {
        const idx = siblings.findIndex((s) => s.id === beforeId)
        if (idx >= 0) list.push(...siblings.slice(0, idx), folder, ...siblings.slice(idx))
        else list.push(...siblings, folder)
      } else {
        list.push(...siblings, folder)
      }
      const ordered = list.map((f, i) => ({ ...f, order: i }))
      if (ordered.every((f, i) => f.id === (folders[i]?.id ?? null) && f.order === folders[i]?.order)) return
      get().pushUndo()
      page.layerFolders = ordered
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async setLayerVisible(index, visible) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = page.layers[index]
      if (!layer || layer.visible === visible) return
      get().pushUndo()
      layer.visible = visible
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async setLayerOpacity(index, opacity) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = page.layers[index]
      if (!layer) return
      const clamped = Math.max(0, Math.min(1, opacity))
      if (layer.opacity === clamped) return
      get().pushUndo()
      layer.opacity = clamped
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async setLayerLocked(index, locked) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = page.layers[index]
      if (!layer || layer.locked === locked) return
      get().pushUndo()
      layer.locked = locked
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async setActiveLayer(layerId) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page || page.layers.length === 0) return
      if (!page.layers.some((l) => l.id === layerId)) return
      if (page.activeLayerId === layerId) return
      page.activeLayerId = layerId
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async mergeSelectedLayers(indices) {
      const id = get().selectedNotebookId
      if (!id) return
      const notebook = get().notebooks.find((n) => n.id === id)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const sel = [...new Set(indices.filter((i) => i >= 0 && i < page.layers.length))].sort(
        (a, b) => a - b,
      )
      if (sel.length < 2) return
      get().pushUndo()
      const topIdx = sel[sel.length - 1]
      const top = page.layers[topIdx]
      const merged: Layer = {
        ...top,
        locked: false,
        strokes: [],
        images: [],
        texts: [],
      }
      for (const i of sel) {
        const l = page.layers[i]
        merged.strokes.push(...l.strokes)
        merged.images.push(...l.images)
        merged.texts.push(...l.texts)
      }
      for (let i = sel.length - 1; i >= 0; i--) {
        page.layers.splice(sel[i], 1)
      }
      const insertAt = topIdx - (sel.length - 1)
      page.layers.splice(insertAt, 0, merged)
      page.activeLayerId = merged.id
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async setSettings(patch) {
      if (patch.language && (patch.language === 'pt-BR' || patch.language === 'en')) {
        setLanguage(patch.language)
      }
      const next = { ...get().settings, ...patch }
      await saveSettings(next)
    },

    async setShortcut(action, value) {
      const shortcuts = { ...get().settings.shortcuts, [action]: value }
      await saveSettings({ ...get().settings, shortcuts })
    },

    async setCloud(patch) {
      const cloud = { ...get().settings.cloud, ...patch }
      await saveSettings({ ...get().settings, cloud })
    },

    async syncNow() {
      const cloud = get().settings.cloud
      if (!cloud.webdavUrl) return null
      if (syncRunning) {
        syncQueued = true
        return null
      }
      syncRunning = true
      try {
        let out
        try {
          const state = await db.getCloudSyncState()
          const transport = makeTransport(cloud)
          out = await runSync({
            basePath: cloud.webdavPath,
            folders: get().folders,
            notebooks: get().notebooks,
            state,
            transport,
          })
          // Apply the pulled/new content BEFORE committing the advanced baseline
          // (`db.putCloudSyncState`). If the content application fails (e.g. an
          // IndexedDB error), the baseline is left untouched, so the next sync
          // re-pulls the same notebooks (idempotent) instead of silently marking
          // them as synced — which would make remote changes never appear.
          await applySyncChanges({
            pulledNotebooks: out.pulledNotebooks,
            newNotebooks: [],
            removedLocalNotebookIds: out.removedLocalNotebookIds,
            pulledFolders: out.pulledFolders,
          })
          await db.putCloudSyncState(out.nextState)
          if (out.pendingConflicts.length > 0) {
            pendingResume = {
              cloud,
              state: out.nextState,
              manifest: out.manifest,
            }
            useUiStore.getState().open('syncConflict', {
              conflicts: out.pendingConflicts,
            })
          }
        } catch (e) {
          return {
            pushed: [],
            pulled: [],
            deleted: [],
            conflicts: [],
            errors: [e instanceof Error ? e.message : String(e)],
          }
        }
        if (out.result.errors.length === 0) {
          await get().setCloud({
            enabled: true,
            lastSyncAt: out.nextState.lastSyncAt ?? Date.now(),
          })
        } else {
          // The sync did not complete successfully: keep the cloud enabled but do
          // not pretend it succeeded (preserves the real "last sync" timestamp).
          await get().setCloud({ enabled: true })
        }
        return out.result
      } finally {
        syncRunning = false
        if (syncQueued) {
          syncQueued = false
          void get().syncNow()
        }
      }
    },

    async resolveConflicts(choices) {
      const resume = pendingResume
      if (!resume) return
      pendingResume = null
      try {
        const transport = makeTransport(resume.cloud)
        const out = await applyConflictChoices({
          basePath: resume.cloud.webdavPath,
          transport,
          choices,
          localNotebooks: get().notebooks,
          folders: get().folders,
          state: resume.state,
          manifest: resume.manifest,
        })
        await db.putCloudSyncState(out.nextState)
        await applySyncChanges({
          pulledNotebooks: out.pulledNotebooks,
          newNotebooks: out.newNotebooks,
          removedLocalNotebookIds: out.removedLocalNotebookIds,
          pulledFolders: out.pulledFolders,
        })
        await get().setCloud({ enabled: true, lastSyncAt: Date.now() })
      } finally {
        useUiStore.getState().close()
      }
    },

    async persistNotebook(notebook) {
      await updateNotebookStorage(notebook)
    },

    pushUndo() {
      const notebookId = get().selectedNotebookId
      if (!notebookId) return
      const notebook = get().notebooks.find((n) => n.id === notebookId)
      if (!notebook) return
      const pageIndex = get().currentPageIndex
      const page = notebook.pages[pageIndex]
      if (!page) return
      undoStack.push({ notebookId, pageIndex, pageSnapshot: clonePage(page) })
      if (undoStack.length > 60) undoStack.shift()
      redoStack.length = 0
      set({ canUndo: true, canRedo: false })
    },

    async undo() {
      const entry = undoStack.pop()
      if (!entry) return
      const notebook = get().notebooks.find((n) => n.id === entry.notebookId)
      if (!notebook) return
      const current = notebook.pages[entry.pageIndex]
      if (current) redoStack.push({ notebookId: entry.notebookId, pageIndex: entry.pageIndex, pageSnapshot: clonePage(current) })
      notebook.pages[entry.pageIndex] = entry.pageSnapshot
      notebook.updatedAt = Date.now()
      set({ currentPageIndex: entry.pageIndex, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })
      await updateNotebookStorage(notebook)
    },

    async redo() {
      const entry = redoStack.pop()
      if (!entry) return
      const notebook = get().notebooks.find((n) => n.id === entry.notebookId)
      if (!notebook) return
      const current = notebook.pages[entry.pageIndex]
      if (current) undoStack.push({ notebookId: entry.notebookId, pageIndex: entry.pageIndex, pageSnapshot: clonePage(current) })
      notebook.pages[entry.pageIndex] = entry.pageSnapshot
      notebook.updatedAt = Date.now()
      set({ currentPageIndex: entry.pageIndex, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 })
      await updateNotebookStorage(notebook)
    },

    async addImageToPage(dataUrl, name, center) {
      const notebookId = get().selectedNotebookId
      if (!notebookId) return
      const notebook = get().notebooks.find((n) => n.id === notebookId)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      const layer = getActiveLayer(page)
      if (layer.locked) return
      get().pushUndo()
      const img = new Image()
      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.onerror = () => resolve()
        img.src = dataUrl
      })
      const maxW = page.width * 0.7
      const maxH = page.height * 0.7
      const scale = Math.min(1, maxW / img.width, maxH / img.height)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const cx = center?.x ?? page.width / 2
      const cy = center?.y ?? page.height / 2
      const el = {
        id: newId(),
        name,
        dataUrl,
        x: Math.round(cx - w / 2),
        y: Math.round(cy - h / 2),
        width: w,
        height: h,
        rotation: 0,
      }
      layer.images.push(el)
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async addPdfToPage(dataUrl, name) {
      const notebookId = get().selectedNotebookId
      if (!notebookId) return
      const notebook = get().notebooks.find((n) => n.id === notebookId)
      if (!notebook) return
      const page = notebook.pages[get().currentPageIndex]
      if (!page) return
      get().pushUndo()
      const img = new Image()
      await new Promise<void>((resolve) => {
        img.onload = () => resolve()
        img.onerror = () => resolve()
        img.src = dataUrl
      })
      page.pdf = { dataUrl, name, pageNumber: 1 }
      page.updatedAt = Date.now()
      notebook.updatedAt = Date.now()
      await updateNotebookStorage(notebook)
    },

    async importPdfNotebook(name, folderId, rendered) {
      const notebook = makeNotebook(name, folderId)
      notebook.order = 0
      for (let i = 0; i < rendered.length; i++) {
        const rp = rendered[i]
        const page = makePage('blank', {
          width: Math.max(400, Math.round(rp.width)),
          height: Math.max(400, Math.round(rp.height)),
        })
        page.pdf = { dataUrl: rp.dataUrl, name, pageNumber: i + 1 }
        notebook.pages.push(page)
      }
      if (notebook.pages.length === 0) notebook.pages.push(makePage('blank'))
      notebook.updatedAt = Date.now()
      const notebooks = sortNotebooksByOrder([notebook, ...get().notebooks])
      set({ notebooks, selectedNotebookId: notebook.id, currentPageIndex: 0 })
      await db.putNotebook(notebook)
      return notebook
    },

    async restoreFromTrash(id) {
      const item = get().trash.find((x) => x.id === id)
      if (!item || !item.data) return
      if (item.kind === 'folder') {
        const folder = item.data as Folder
        if (!get().folders.some((f) => f.id === id)) {
          const folders = sortFoldersByOrder([...get().folders, { ...folder }])
          set({ folders, dataVersion: get().dataVersion + 1 })
          await db.putFolder(folder)
        }
      } else {
        const nb = item.data as Notebook
        if (!get().notebooks.some((n) => n.id === id)) {
          const norm = normalizeRestoredNotebook(nb)
          const notebooks = sortNotebooksByOrder([...get().notebooks, norm])
          set({ notebooks, dataVersion: get().dataVersion + 1 })
          await db.putNotebook(norm)
        }
      }
      await removeTrashEntry(id)
      const cloud = get().settings.cloud
      if (cloud.webdavUrl) {
        const state = await db.getCloudSyncState()
        // Deleted "local + nuvem": clear the tombstone and the baseline entry so
        // the next sync re-uploads it (buildPlan remote.deleted + no tombstone).
        // For folders, `foldersHash` is intentionally NOT touched: if the delete
        // already synced, the baseline no longer includes the folder, so local ≠
        // baseline → pushFolders re-uploads it; if it didn't, the baseline still
        // includes it and the cloud copy is intact (no spurious push).
        delete state.tombstones[id]
        delete state.localOnlyDeleted[id]
        delete state.notebooks[id]
        await db.putCloudSyncState(state)
        void get().syncNow()
      }
    },

    async restoreFromCloud(id) {
      const cloud = get().settings.cloud
      if (!cloud.webdavUrl) return
      const item = get().trash.find((x) => x.id === id)
      if (!item) return
      const transport = makeTransport(cloud)
      let restored = false
      if (item.kind === 'folder') {
        const text = await transport.downloadFile(`${cloud.webdavPath}/${FOLDERS_PATH}`)
        const data = JSON.parse(text) as { folders?: Folder[] }
        const folder = (data.folders ?? []).find((f) => f.id === id)
        if (folder) {
          if (!get().folders.some((f) => f.id === id)) {
            const folders = sortFoldersByOrder([...get().folders, { ...folder }])
            set({ folders, dataVersion: get().dataVersion + 1 })
            await db.putFolder(folder)
          }
          restored = true
        }
      } else {
        const text = await transport.downloadFile(
          `${cloud.webdavPath}/${NOTEBOOKS_DIR}/${id}.json`,
        )
        const data = JSON.parse(text) as { notebook?: Notebook }
        const nb = data.notebook
        if (nb) {
          const norm = normalizeRestoredNotebook(nb)
          const existingIndex = get().notebooks.findIndex((n) => n.id === id)
          const notebooks = [...get().notebooks]
          if (existingIndex >= 0) notebooks[existingIndex] = norm
          else notebooks.push(norm)
          set({ notebooks: sortNotebooksByOrder(notebooks), dataVersion: get().dataVersion + 1 })
          await db.putNotebook(norm)
          restored = true
        }
      }
      if (!restored) {
        throw new Error(t('error.trashRestoreCloudFailed', { name: item.name }))
      }
      const state = await db.getCloudSyncState()
      delete state.tombstones[id]
      delete state.localOnlyDeleted[id]
      if (item.kind === 'folder') {
        state.foldersHash = hashFolders(get().folders)
      } else {
        const nb = get().notebooks.find((n) => n.id === id)
        if (nb) state.notebooks[id] = nb.updatedAt
      }
      await db.putCloudSyncState(state)
      await removeTrashEntry(id)
    },

    async purgeTrashItem(id) {
      await removeTrashEntry(id)
    },

    async runTrashPurge() {
      const cutoff = Date.now() - TOMBSTONE_RETENTION_MS
      const items = get().trash
      const expired = items.filter((x) => x.deletedAt < cutoff && !x.cloudKeepsCopy)
      if (expired.length === 0) return
      for (const item of expired) {
        await db.deleteTrashItem(item.id)
      }
      set({ trash: items.filter((x) => !expired.some((e) => e.id === x.id)) })
    },

    async replaceAllData(folders, notebooks, settings) {
      const prevFolders = get().folders
      const prevNotebooks = get().notebooks
      const folderIds = new Set(folders.map((f) => f.id))
      const next = notebooks.map((nb) => ({
        ...nb,
        folderId: normalizeNotebookFolder(nb, folderIds),
        pages: nb.pages.map((p) => normalizePage(p)),
      }))
      let nextSettings = get().settings
      if (settings) {
        const safeSettings: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...settings,
          cloud: { ...DEFAULT_SETTINGS.cloud, ...(settings.cloud ?? {}) },
          shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(settings.shortcuts ?? {}) },
        }
        nextSettings = safeSettings
        setLanguage(safeSettings.language === 'en' ? 'en' : 'pt-BR')
      }
      const { folders: outFolders } = fillFolderOrder(folders)
      const { notebooks: outNotebooks } = fillNotebookOrder(next)
      set({
        folders: outFolders,
        notebooks: outNotebooks,
        settings: nextSettings,
        selectedFolderId: null,
        selectedNotebookId: outNotebooks[0]?.id ?? null,
        currentPageIndex: 0,
        lastClicked: null,
      })
      for (const f of outFolders) await db.putFolder(f)
      for (const nb of outNotebooks) await db.putNotebook(nb)
      for (const f of prevFolders) {
        if (!outFolders.some((x) => x.id === f.id)) await db.deleteFolder(f.id)
      }
      for (const nb of prevNotebooks) {
        if (!outNotebooks.some((x) => x.id === nb.id)) await db.deleteNotebook(nb.id)
      }
      if (settings) {
        await db.putSettings(nextSettings)
      }
    },
  }
})

useAppStore.subscribe((state, prev) => {
  if (state.dataVersion === prev.dataVersion) return
  const cloud = state.settings.cloud
  if (!cloud.enabled || !cloud.autoSync || !cloud.webdavUrl) return
  if (syncRunning) {
    // A change arrived while a sync is in flight: queue a follow-up so it is
    // not silently lost (the in-flight run captured the previous snapshot).
    syncQueued = true
    return
  }
  if (syncDebounceTimer !== undefined) clearTimeout(syncDebounceTimer)
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = undefined
    void useAppStore.getState().syncNow()
  }, 20000)
})

useAppStore.subscribe((state, prev) => {
  if (
    state.selectedNotebookId === prev.selectedNotebookId &&
    state.currentPageIndex === prev.currentPageIndex
  ) {
    return
  }
  if (!state.selectedNotebookId) return
  const pages = state.notebooks.find((n) => n.id === state.selectedNotebookId)?.pages ?? []
  const pageId = pages[state.currentPageIndex]?.id ?? null
  saveLastSession(state.selectedNotebookId, pageId)
  saveLastPage(state.selectedNotebookId, pageId)
})
