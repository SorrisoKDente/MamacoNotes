export type TemplateId = 'blank' | 'ruled' | 'grid' | 'dot'

export const APP_VERSION = '2.3.0'

export const NOTEBOOKS_DIR = 'notebooks'
export const FOLDERS_DIR = 'folders'

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
  /** Z-order inside the layer; see `Stroke.order`. */
  order?: number
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
  /**
   * Z-order of the element inside its layer (bottom = lower). Optional for
   * backward compatibility: elements without it keep the legacy group order
   * (strokes -> images -> texts), see `layerItems`.
   */
  order?: number
}

export interface StrokeErasure {
  radius: number
  points: { x: number; y: number }[]
  strokeIds?: string[]
  x?: number
  y?: number
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
  /** Z-order inside the layer; see `Stroke.order`. */
  order?: number
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
  strokeErasures?: StrokeErasure[]
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
  favorite?: boolean
}

export interface NotebookSummary {
  id: string
  name: string
  folderId: string | null
  createdAt: number
  updatedAt: number
  order?: number
  pageCount: number
  favorite?: boolean
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
  favorite?: boolean
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
  hidePageList: boolean
  hidePageCount: boolean
  hideToolCursor: boolean
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
  rememberPassword: boolean
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
  hidePageList: false,
  hidePageCount: false,
  hideToolCursor: false,
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
    rememberPassword: true,
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
    strokeErasures?: StrokeErasure[]
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
    strokeErasures: opts?.strokeErasures ?? [],
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
  ).map((layer) => {
    const strokeErasures = (layer.strokeErasures ?? []).reduce<StrokeErasure[]>((paths, erasure) => {
      if (Array.isArray(erasure.points)) {
        paths.push({ radius: erasure.radius, points: erasure.points.map((p) => ({ ...p })), strokeIds: erasure.strokeIds })
      } else if (typeof erasure.x === 'number' && typeof erasure.y === 'number') {
        const path = paths.find((candidate) => candidate.radius === erasure.radius)
        if (path) path.points.push({ x: erasure.x, y: erasure.y })
        else paths.push({ radius: erasure.radius, points: [{ x: erasure.x, y: erasure.y }] })
      }
      return paths
    }, [])
    return {
      id: layer.id,
      name: layer.name ?? 'Camada 1',
      visible: layer.visible ?? true,
      opacity: layer.opacity ?? 1,
      locked: layer.locked ?? false,
      folderId: layer.folderId ?? null,
      strokes: layer.strokes ?? [],
      images: layer.images ?? [],
      texts: layer.texts ?? [],
      strokeErasures,
    }
  })
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

/** One entry of a layer's merged draw list; see `layerItems`. */
export type LayerItem =
  | { kind: 'stroke'; item: Stroke; order: number }
  | { kind: 'image'; item: ImageElement; order: number }
  | { kind: 'text'; item: TextElement; order: number }

export type ArrangeMode = 'front' | 'back' | 'forward' | 'backward'

export interface LayerSelection {
  strokes: Set<string>
  images: Set<string>
  texts: Set<string>
}

// Fallback bands used for elements created before z-ordering existed (no
// explicit `order`). They preserve the legacy within-layer order:
// strokes -> images -> texts. Values are far apart so a freshly assigned
// explicit order (see `nextLayerOrder`) always dominates them.
const ORDER_BAND = { stroke: 0, image: 1_000_000, text: 2_000_000 } as const

/**
 * Bottom -> top draw list of a layer, interleaving strokes, images and texts by
 * their explicit `order`. Elements without `order` fall back to the legacy
 * group order, so pages saved before z-ordering render exactly as before.
 */
export function layerItems(layer: Layer): LayerItem[] {
  const items: LayerItem[] = []
  layer.strokes.forEach((item, i) =>
    items.push({ kind: 'stroke', item, order: item.order ?? ORDER_BAND.stroke + i }),
  )
  layer.images.forEach((item, i) =>
    items.push({ kind: 'image', item, order: item.order ?? ORDER_BAND.image + i }),
  )
  layer.texts.forEach((item, i) =>
    items.push({ kind: 'text', item, order: item.order ?? ORDER_BAND.text + i }),
  )
  // Array.prototype.sort is stable (ES2019+), so equal orders keep the push
  // order above (strokes -> images -> texts).
  items.sort((a, b) => a.order - b.order)
  return items
}

/**
 * Z-order that places a newly created element on top of everything already in
 * the layer. Assigned on creation so drawing/importing always lands above the
 * existing content (this is what lets you write over an image).
 */
export function nextLayerOrder(layer: Layer): number {
  const items = layerItems(layer)
  return items.length > 0 ? items[items.length - 1].order + 1 : 0
}

/**
 * Moves the selected elements to the front/back (or one step forward/backward)
 * of the layer. The current visible order is materialized to explicit 0..n-1
 * values first, which makes the result stable and independent of the legacy
 * bands. Returns true only when the visible order actually changed.
 */
export function arrangeLayer(
  layer: Layer,
  selected: LayerSelection,
  mode: ArrangeMode,
): boolean {
  const items = layerItems(layer)
  if (items.length < 2) return false
  const isSelected = (it: LayerItem): boolean =>
    it.kind === 'stroke'
      ? selected.strokes.has(it.item.id)
      : it.kind === 'image'
        ? selected.images.has(it.item.id)
        : selected.texts.has(it.item.id)

  const before = items.map((it) => it.item.id).join('|')
  const list = [...items]
  if (mode === 'front' || mode === 'back') {
    const sel = list.filter(isSelected)
    const rest = list.filter((it) => !isSelected(it))
    list.length = 0
    list.push(...(mode === 'front' ? [...rest, ...sel] : [...sel, ...rest]))
  } else if (mode === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) {
      if (isSelected(list[i]) && !isSelected(list[i + 1])) {
        ;[list[i], list[i + 1]] = [list[i + 1], list[i]]
      }
    }
  } else {
    for (let i = 1; i < list.length; i++) {
      if (isSelected(list[i]) && !isSelected(list[i - 1])) {
        ;[list[i], list[i - 1]] = [list[i - 1], list[i]]
      }
    }
  }
  if (list.map((it) => it.item.id).join('|') === before) return false
  list.forEach((it, index) => {
    it.item.order = index
  })
  return true
}

/**
 * Rebuilds a layer's erasure masks after the strokes they scope were transformed
 * (drag/move, resize, rotate). `sourceErasures` is the snapshot taken when the
 * gesture started and `mapPoint` must be the SAME absolute transform applied to
 * the stroke points, so rebuilding from the snapshot on every frame is
 * idempotent. Erasures shared between transformed and non-transformed strokes
 * are split: a mapped clone follows the transformed strokes while the original
 * keeps punching the strokes that stayed in place. Without this, the mask stays
 * fixed in page coordinates and clipped transformed strokes at the old hole —
 * the "dragged element disappears over the erased region" bug.
 */
export function transformStrokeErasures(
  layer: Layer,
  sourceErasures: StrokeErasure[] | undefined,
  transformedStrokeIds: Set<string>,
  mapPoint: (p: { x: number; y: number }) => { x: number; y: number },
): void {
  if (!sourceErasures || transformedStrokeIds.size === 0) return
  const next: StrokeErasure[] = []
  for (const erasure of sourceErasures) {
    // Legacy erasures without strokeIds applied to every stroke; scope them on split.
    const ids = erasure.strokeIds ?? layer.strokes.map((s) => s.id)
    const kept = ids.filter((id) => !transformedStrokeIds.has(id))
    const moved = ids.filter((id) => transformedStrokeIds.has(id))
    if (kept.length > 0) next.push({ ...erasure, strokeIds: kept })
    if (moved.length > 0) {
      next.push({ ...erasure, points: erasure.points.map((p) => mapPoint(p)), strokeIds: moved })
    }
  }
  layer.strokeErasures = next
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
    width: 0,
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
