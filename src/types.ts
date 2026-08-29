export type TemplateId = 'blank' | 'ruled' | 'grid' | 'dot'

export const APP_VERSION = '1.2.2'

export type PageViewMode = 'separate' | 'vertical' | 'horizontal'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ToolKind = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'pan'

export type TextAlign = 'left' | 'center' | 'right'
export type TextMarker = 'none' | 'disc' | 'number'
export type TextDirection = 'horizontal' | 'vertical'

export interface TextElement {
  id: string
  text: string
  x: number
  y: number
  width: number
  rotation: number
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  color: string
  backgroundColor: string | null
  align: TextAlign
  marker: TextMarker
  direction: TextDirection
  createdAt: number
}

export type SelectMode = 'click' | 'free' | 'circle' | 'rect'

export type EraserMode = 'strokes' | 'images' | 'both'

export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

export interface Stroke {
  id: string
  kind: ToolKind
  color: string
  size: number
  points: StrokePoint[]
}

export interface ImageElement {
  id: string
  name: string
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export interface PdfBackground {
  dataUrl: string
  name: string
  pageNumber: number
}

export interface LayerFolder {
  id: string
  name: string
  order?: number
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  folderId?: string | null
  strokes: Stroke[]
  images: ImageElement[]
  texts: TextElement[]
}

export interface Page {
  id: string
  template: TemplateId
  width: number
  height: number
  rotation: number
  backgroundColor: string
  layers: Layer[]
  layerFolders?: LayerFolder[]
  activeLayerId: string | null
  pdf?: PdfBackground
  createdAt: number
  updatedAt: number
}

export interface Notebook {
  id: string
  name: string
  folderId: string | null
  pages: Page[]
  createdAt: number
  updatedAt: number
  order?: number
}

export interface PageTemplate {
  id: string
  name: string
  createdAt: number
  pages: Page[]
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  order?: number
}

export type AppTheme = 'light' | 'dark' | 'system'

export interface AppSettings {
  language: string
  theme: AppTheme
  defaultTemplate: TemplateId
  lastPenColor: string
  lastPenSize: number
  lastHighlighterColor: string
  lastHighlighterSize: number
  lastEraserSize: number
  lastSelectMode: SelectMode
  selectDelimitedOnly: boolean
  eraserMode: EraserMode
  eraserEraseWholeStroke: boolean
  freeRotate: boolean
  hideTopBar: boolean
  hideToolbar: boolean
  hideSidebar: boolean
  hidePageList: boolean
  hidePageCount: boolean
  hideToolCursor: boolean
  sidebarWidth: number
  layersWidth: number
  pageViewMode: PageViewMode
  lastTextFontFamily: string
  lastTextFontSize: number
  lastTextColor: string
  lastTextBackground: string | null
  lastTextBold: boolean
  lastTextItalic: boolean
  lastTextUnderline: boolean
  lastTextStrikethrough: boolean
  lastTextAlign: TextAlign
  lastTextMarker: TextMarker
  lastTextDirection: TextDirection
  ignoreVersion: string | null
  shortcuts: ShortcutMap
  cloud: CloudSettings
}

export interface CloudSettings {
  enabled: boolean
  webdavUrl: string
  webdavUsername: string
  webdavPassword: string
  webdavPath: string
  autoSync: boolean
  lastSyncAt: number | null
}

export interface SyncManifestNotebook {
  id: string
  name: string
  updatedAt: number
  deleted: boolean
}

export interface SyncManifest {
  version: 2
  updatedAt: number
  folders: { updatedAt: number }
  notebooks: SyncManifestNotebook[]
}

export interface CloudSyncState {
  id: 'main'
  lastSyncAt: number | null
  foldersHash: string
  foldersUpdatedAt: number
  notebooks: Record<string, number>
  tombstones: Record<string, number>
  localOnlyDeleted: Record<string, number>
}

export type DeleteScope = 'local' | 'remote'

/**
 * Entry in the local trash (NOT synced). One entry per deleted item — a
 * deleted folder produces one entry for the folder, one for each subfolder and
 * one for each notebook inside it (each with its own `parentId`).
 *
 * `cloudKeepsCopy` is true when the item was deleted "só local" (the cloud
 * still holds a copy): the heavy `data` is discarded and the item can only be
 * brought back with "Restaurar da nuvem". When false, the item was deleted
 * "local + nuvem" (or there is no cloud): `data` holds the full item so it can
 * be restored without a cloud copy.
 */
export interface TrashItem {
  id: string
  kind: 'notebook' | 'folder'
  name: string
  parentId: string | null
  data: Notebook | Folder | null
  deletedAt: number
  cloudKeepsCopy: boolean
}

export interface SyncConflictItem {
  id: string
  name: string
  kind: 'notebook' | 'folders'
  conflictType:
    | 'bothModified'
    | 'deletedLocalModifiedRemote'
    | 'deletedRemoteModifiedLocal'
  localUpdatedAt: number | null
  remoteUpdatedAt: number | null
}

export type ConflictChoice =
  | 'keepLocal'
  | 'useServer'
  | 'keepBoth'
  | 'confirmDelete'
  | 'restoreFromServer'

export interface SyncResult {
  pushed: string[]
  pulled: string[]
  deleted: string[]
  conflicts: SyncConflictItem[]
  errors: string[]
}

export type ShortcutActionId =
  | 'pen'
  | 'eraser'
  | 'highlighter'
  | 'text'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'recenter'
  | 'pan'
  | 'addPage'
  | 'deletePage'
  | 'save'
  | 'exportPng'
  | 'exportPdf'
  | 'toggleSidebar'
  | 'togglePageList'
  | 'searchPages'
  | 'sizeIncrease'
  | 'sizeDecrease'
  | 'rotatePlus'
  | 'rotateMinus'
  | 'rotateReset'
  | 'toggleFullscreen'
  | 'toggleHideToolbar'
  | 'toggleHideTopBar'
  | 'toggleFreeRotate'
  | 'selectClick'
  | 'selectFree'
  | 'selectCircle'
  | 'selectRect'
  | 'rename'

export type ShortcutMap = Record<ShortcutActionId, string>

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  pen: 'p',
  eraser: 'e',
  highlighter: 'h',
  text: 't',
  undo: 'ctrl+z',
  redo: 'ctrl+y',
  zoomIn: 'ctrl+=',
  zoomOut: 'ctrl+-',
  zoomReset: 'ctrl+0',
  recenter: 'r',
  pan: 'alt',
  addPage: 'ctrl+n',
  deletePage: 'ctrl+shift+d',
  save: 'ctrl+s',
  exportPng: 'ctrl+shift+e',
  exportPdf: 'ctrl+shift+p',
  toggleSidebar: 'ctrl+b',
  togglePageList: 'ctrl+shift+l',
  searchPages: 'ctrl+f',
  sizeIncrease: ']',
  sizeDecrease: '[',
  rotatePlus: 'ctrl+right',
  rotateMinus: 'ctrl+left',
  rotateReset: '0',
  toggleFullscreen: 'f11',
  toggleHideToolbar: 'ctrl+shift+h',
  toggleHideTopBar: 'ctrl+shift+t',
  toggleFreeRotate: 'ctrl+alt+r',
  selectClick: 'c',
  selectFree: 'l',
  selectCircle: 'o',
  selectRect: 'q',
  rename: 'f2',
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'pt-BR',
  theme: 'system',
  defaultTemplate: 'ruled',
  lastPenColor: '#1c1c1c',
  lastPenSize: 3,
  lastHighlighterColor: '#ffe84d',
  lastHighlighterSize: 18,
  lastEraserSize: 20,
  lastSelectMode: 'click',
  selectDelimitedOnly: false,
  eraserMode: 'both',
  eraserEraseWholeStroke: false,
  freeRotate: false,
  hideTopBar: false,
  hideToolbar: false,
  hideSidebar: false,
  hidePageList: false,
  hidePageCount: false,
  hideToolCursor: false,
  sidebarWidth: 260,
  layersWidth: 260,
  pageViewMode: 'vertical',
  lastTextFontFamily: 'Segoe UI, system-ui, sans-serif',
  lastTextFontSize: 24,
  lastTextColor: '#1c1c1c',
  lastTextBackground: null,
  lastTextBold: false,
  lastTextItalic: false,
  lastTextUnderline: false,
  lastTextStrikethrough: false,
  lastTextAlign: 'left',
  lastTextMarker: 'none',
  lastTextDirection: 'horizontal',
  ignoreVersion: null,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  cloud: {
    enabled: false,
    webdavUrl: '',
    webdavUsername: '',
    webdavPassword: '',
    webdavPath: '/MamacoNotes',
    autoSync: false,
    lastSyncAt: null,
  },
}

export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  ).slice(0, 20)
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return uid()
}

export function makeLayer(
  name: string,
  opts?: {
    strokes?: Stroke[]
    images?: ImageElement[]
    texts?: TextElement[]
  },
): Layer {
  return {
    id: newId(),
    name,
    visible: true,
    opacity: 1,
    locked: false,
    folderId: null,
    strokes: opts?.strokes ?? [],
    images: opts?.images ?? [],
    texts: opts?.texts ?? [],
  }
}

export function normalizePage(
  page: Partial<Page> & {
    strokes?: Stroke[]
    images?: ImageElement[]
    texts?: TextElement[]
  },
): Page {
  const layers: Layer[] = (page.layers && page.layers.length > 0
    ? page.layers
    : [
        makeLayer('Camada 1', {
          strokes: page.strokes ?? [],
          images: page.images ?? [],
          texts: page.texts ?? [],
        }),
      ]
  ).map((layer) => ({
    id: layer.id,
    name: layer.name ?? 'Camada 1',
    visible: layer.visible ?? true,
    opacity: layer.opacity ?? 1,
    locked: layer.locked ?? false,
    folderId: layer.folderId ?? null,
    strokes: layer.strokes ?? [],
    images: layer.images ?? [],
    texts: layer.texts ?? [],
  }))
  const layerFolders: LayerFolder[] = (page.layerFolders ?? []).map((f) => ({
    id: f.id,
    name: f.name ?? 'Pasta',
    ...(typeof f.order === 'number' ? { order: f.order } : {}),
  }))
  const activeLayerId =
    page.activeLayerId != null && layers.some((l) => l.id === page.activeLayerId)
      ? page.activeLayerId
      : layers[layers.length - 1].id
  return {
    id: page.id!,
    template: page.template!,
    width: page.width!,
    height: page.height!,
    rotation: page.rotation ?? 0,
    backgroundColor: page.backgroundColor ?? '#ffffff',
    layers,
    layerFolders,
    activeLayerId,
    ...(page.pdf ? { pdf: page.pdf } : {}),
    createdAt: page.createdAt ?? Date.now(),
    updatedAt: page.updatedAt ?? Date.now(),
  }
}

export function getActiveLayer(page: Page): Layer {
  const layer = page.layers.find((l) => l.id === page.activeLayerId)
  return layer ?? page.layers[page.layers.length - 1]
}

export function makePage(
  template: TemplateId,
  opts?: { width?: number; height?: number },
): Page {
  const now = Date.now()
  const layer = makeLayer('Camada 1')
  return {
    id: uid(),
    template,
    width: opts?.width ?? 1240,
    height: opts?.height ?? 1754,
    rotation: 0,
    backgroundColor: '#ffffff',
    layers: [layer],
    layerFolders: [],
    activeLayerId: layer.id,
    createdAt: now,
    updatedAt: now,
  }
}

export function makeTextElement(
  text: string,
  x: number,
  y: number,
  settings: Pick<
    AppSettings,
    | 'lastTextFontFamily'
    | 'lastTextFontSize'
    | 'lastTextColor'
    | 'lastTextBackground'
    | 'lastTextBold'
    | 'lastTextItalic'
    | 'lastTextUnderline'
    | 'lastTextStrikethrough'
    | 'lastTextAlign'
    | 'lastTextMarker'
    | 'lastTextDirection'
  >,
): TextElement {
  return {
    id: uid(),
    text,
    x,
    y,
    width: 400,
    rotation: 0,
    fontSize: settings.lastTextFontSize,
    fontFamily: settings.lastTextFontFamily,
    bold: settings.lastTextBold,
    italic: settings.lastTextItalic,
    underline: settings.lastTextUnderline,
    strikethrough: settings.lastTextStrikethrough,
    color: settings.lastTextColor,
    backgroundColor: settings.lastTextBackground,
    align: settings.lastTextAlign,
    marker: settings.lastTextMarker,
    direction: settings.lastTextDirection,
    createdAt: Date.now(),
  }
}

export function makeNotebook(name: string, folderId: string | null): Notebook {
  const now = Date.now()
  return {
    id: uid(),
    name,
    folderId,
    pages: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function makeFolder(name: string, parentId: string | null): Folder {
  return {
    id: uid(),
    name,
    parentId,
    createdAt: Date.now(),
  }
}
