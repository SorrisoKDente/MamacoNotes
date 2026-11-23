import type {
  CloudSyncState,
  ConflictChoice,
  Folder,
  Notebook,
  Page,
  NotebookSummary,
  SyncConflictItem,
  SyncManifest,
  SyncManifestNotebook,
  SyncProgress,
  SyncResult,
} from '../types'
import { normalizePage, uid, NOTEBOOKS_DIR, FOLDERS_DIR, PDFS_DIR } from '../types'
import { t } from '../i18n'
import { RemoteFileNotFoundError } from './webdav'
import type { Transport } from './webdav'
import { logger } from './logger'
import { isBrowserFetchError } from './http'

export const MANIFEST_PATH = 'manifest.json'
export const FOLDERS_PATH = `${FOLDERS_DIR}/folders.json`
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
/**
 * Format version written by this client. Version 3 keeps PDF backgrounds out of
 * the notebook JSON (`pdfs/<pageId>.png`, hashes in the manifest). Version-2
 * files are still read: the hashes a version-2 client drops from the manifest
 * are rebuilt from the bitmaps on the next pull.
 */
export const MANIFEST_VERSION = 3
export const NOTEBOOK_FORMAT_VERSION = 3
const PNG_BASE64_HEADER = 'data:image/png;base64,'

function notebookPath(basePath: string, id: string): string {
  return `${basePath}/${NOTEBOOKS_DIR}/${id}.json`
}

/** Remote path of a page's PDF background image. */
export function pdfFilePath(basePath: string, pageId: string): string {
  return `${basePath}/${PDFS_DIR}/${pageId}.png`
}

/**
 * Fingerprint of a PDF background image. PDF backgrounds are immutable (set
 * once when the PDF is imported), so this only has to tell "already uploaded"
 * from "new". The dataUrl is sampled instead of read end to end so a push of a
 * notebook with 100+ PDF pages stays cheap; the length and the tail are always
 * included, so a changed image never hashes the same.
 */
export function pdfHash(dataUrl: string): string {
  const length = dataUrl.length
  const stride = Math.max(1, Math.floor(length / 4096))
  let hash = 0x811c9dc5
  for (let i = 0; i < length; i += stride) {
    hash = Math.imul(hash ^ dataUrl.charCodeAt(i), 0x01000193)
  }
  for (let i = Math.max(0, length - 64); i < length; i++) {
    hash = Math.imul(hash ^ dataUrl.charCodeAt(i), 0x01000193)
  }
  return `${length.toString(36)}-${(hash >>> 0).toString(36)}`
}

/** Decodes a PNG dataUrl into raw bytes; null when it is not PNG base64. */
export function decodePngDataUrl(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PNG_BASE64_HEADER)) return null
  try {
    const binary = atob(dataUrl.slice(PNG_BASE64_HEADER.length))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function encodePngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  // btoa takes a binary string; chunk it so a full-page image never exceeds
  // the argument limit of String.fromCharCode.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return PNG_BASE64_HEADER + btoa(binary)
}

/**
 * Splits a notebook into the JSON payload (pages without their PDF bitmap) and
 * the bitmaps to upload as separate files. Only PNG base64 dataUrls are split;
 * anything else stays inline as a safe fallback, so a background is never lost.
 */
function splitPdfBackgrounds(nb: Notebook): {
  notebook: Notebook
  pdfs: Map<string, string>
} {
  const pdfs = new Map<string, string>()
  const pages = nb.pages.map((page) => {
    const dataUrl = page.pdf?.dataUrl
    if (!page.pdf || !dataUrl || !dataUrl.startsWith(PNG_BASE64_HEADER)) return page
    pdfs.set(page.id, dataUrl)
    const lightPdf = { name: page.pdf.name, pageNumber: page.pdf.pageNumber }
    return { ...page, pdf: lightPdf as Page['pdf'] }
  })
  return { notebook: pdfs.size > 0 ? { ...nb, pages } : nb, pdfs }
}

interface UploadNotebookArgs {
  basePath: string
  transport: Transport
  notebook: Notebook
  previous?: SyncManifestNotebook
}

/**
 * Reads a notebook file of any format version (2 and 3 carry the same
 * `{ notebook }` envelope; version 3 only moved the PDF bitmaps out of it).
 */
function parseNotebookFile(text: string): Notebook {
  const notebook = (JSON.parse(text) as { notebook?: Notebook } | null)?.notebook
  if (!notebook) throw new Error(t('error.invalidNotebook'))
  return notebook
}

/**
 * Image hashes for a notebook as seen after a download: the previous hashes of
 * pages that still exist, overridden by every bitmap that came down with the
 * notebook (it is the bytes the next push would compare against). A page whose
 * image could not be downloaded (404) keeps its previous hash, so the page is
 * never mistaken for an orphan.
 */
function pdfHashesFor(
  previous: Record<string, string> | undefined,
  notebook: Notebook,
): Record<string, string> {
  const pageIds = new Set(notebook.pages.map((page) => page.id))
  const next: Record<string, string> = {}
  for (const [pageId, hash] of Object.entries(previous ?? {})) {
    if (pageIds.has(pageId)) next[pageId] = hash
  }
  for (const page of notebook.pages) {
    if (page.pdf?.dataUrl) next[page.id] = pdfHash(page.pdf.dataUrl)
  }
  return next
}

/**
 * Rebuilds a manifest entry's image hashes from a downloaded notebook. A
 * version-2 client rewrites the manifest without `pdfs`; without this repair the
 * next push would re-upload every image. Returns the repaired entry, or null
 * when nothing changed.
 */
function repairPdfHashes(
  entry: SyncManifestNotebook,
  notebook: Notebook,
): SyncManifestNotebook | null {
  const next = pdfHashesFor(entry.pdfs, notebook)
  if (JSON.stringify(entry.pdfs ?? {}) === JSON.stringify(next)) return null
  const repaired: SyncManifestNotebook = { ...entry }
  if (Object.keys(next).length > 0) repaired.pdfs = next
  else delete repaired.pdfs
  return repaired
}

/**
 * Uploads a notebook with its PDF backgrounds as separate `pdfs/<pageId>.png`
 * files and returns the manifest entry to store. A bitmap is only uploaded when
 * its hash differs from the previous entry's, so the hot path (a stroke made a
 * notebook dirty) rewrites the small notebook JSON and never the PDF images.
 */
async function uploadNotebook({
  basePath,
  transport,
  notebook,
  previous,
}: UploadNotebookArgs): Promise<SyncManifestNotebook> {
  const { notebook: lightNotebook, pdfs } = splitPdfBackgrounds(notebook)
  const hashes: Record<string, string> = {}
  let pdfDirectoryReady = false
  for (const [pageId, dataUrl] of pdfs) {
    const hash = pdfHash(dataUrl)
    hashes[pageId] = hash
    if (previous?.pdfs?.[pageId] === hash) continue
    // Decoded one image at a time: a PDF-heavy notebook must never hold every
    // page bitmap in memory at once (Android OOM).
    const bytes = decodePngDataUrl(dataUrl)
    if (!bytes) throw new Error(t('error.invalidNotebook'))
    if (!pdfDirectoryReady) {
      await transport.ensureDirectory(`${basePath}/${PDFS_DIR}`)
      pdfDirectoryReady = true
    }
    await transport.uploadFile(pdfFilePath(basePath, pageId), bytes, 'image/png')
  }
  // A page that still exists locally but lost its bitmap (it was pulled by an
  // older client that stripped `pdf.dataUrl`) keeps its previous hash: the
  // remote image stays, instead of being deleted as a false orphan.
  for (const [pageId, hash] of Object.entries(previous?.pdfs ?? {})) {
    if (!hashes[pageId] && notebook.pages.some((page) => page.id === pageId)) {
      hashes[pageId] = hash
    }
  }
  // The notebook file goes last: it is only visible once every bitmap it
  // references is on the server.
  await transport.uploadFile(
    notebookPath(basePath, notebook.id),
    new TextEncoder().encode(
      JSON.stringify({
        version: NOTEBOOK_FORMAT_VERSION,
        exportedAt: Date.now(),
        notebook: lightNotebook,
      }),
    ),
    'application/json',
  )
  // Backgrounds of pages removed from the notebook leave no orphan files. A page
  // that still exists is never an orphan, even when its bitmap is missing.
  const livePageIds = new Set(notebook.pages.map((page) => page.id))
  for (const pageId of Object.keys(previous?.pdfs ?? {})) {
    if (livePageIds.has(pageId)) continue
    try {
      await transport.deleteRemoteFile(pdfFilePath(basePath, pageId))
    } catch {
      // Orphan image only — never fails the notebook upload.
    }
  }
  const entry: SyncManifestNotebook = {
    id: notebook.id,
    name: notebook.name,
    updatedAt: notebook.updatedAt,
    deleted: false,
  }
  if (Object.keys(hashes).length > 0) entry.pdfs = hashes
  return entry
}

/**
 * Rehydrates the PDF backgrounds of a downloaded notebook from
 * `pdfs/<pageId>.png`. Only "light" pages are fetched (a page whose JSON still
 * carries the dataUrl, or has no PDF, is left alone). A missing file (404)
 * leaves that page without a background instead of failing the pull; a network
 * failure aborts the pull so it is retried on the next sync.
 */
async function hydratePdfBackgrounds(
  basePath: string,
  transport: Transport,
  notebook: Notebook,
): Promise<Notebook> {
  const pending = notebook.pages.filter((page) => page.pdf && !page.pdf.dataUrl)
  if (pending.length === 0) return notebook
  const dataUrls = new Map<string, string>()
  for (const page of pending) {
    try {
      const bytes = await transport.downloadBinaryFile(pdfFilePath(basePath, page.id))
      dataUrls.set(page.id, encodePngDataUrl(bytes))
    } catch (e) {
      const notFound =
        e instanceof RemoteFileNotFoundError ||
        (e as { name?: string } | null)?.name === 'RemoteFileNotFoundError'
      if (notFound) continue
      throw e
    }
  }
  if (dataUrls.size === 0) return notebook
  return {
    ...notebook,
    pages: notebook.pages.map((page) => {
      const dataUrl = dataUrls.get(page.id)
      return dataUrl && page.pdf ? { ...page, pdf: { ...page.pdf, dataUrl } } : page
    }),
  }
}

/**
 * Restores PDF bitmaps that a local page still references but that are missing
 * from the local database. A client older than 2.4.2 cannot download
 * `pdfs/<pageId>.png`, so pulling a version-3 notebook leaves the page with PDF
 * metadata but no bitmap; updating the app never heals it because the notebook's
 * `updatedAt` matches the sync baseline and is never pulled again. Downloading
 * the remote image on sync is what repairs those pages (once; afterwards the
 * page has its bitmap again).
 */
async function repairLocalPdfBitmaps(
  basePath: string,
  transport: Transport,
  pending: PendingPdfBitmap[],
  pulled: Notebook[],
  getNotebook: (id: string) => Promise<Notebook | undefined>,
): Promise<{ repaired: Notebook[]; incomplete: boolean }> {
  if (pending.length === 0) return { repaired: [], incomplete: false }
  const pulledById = new Map(pulled.map((nb) => [nb.id, nb]))
  const dataUrls = new Map<string, string>()
  let incomplete = false
  for (const { notebookId, pageId } of pending) {
    // A pull in this same run may already have restored the page.
    const already = pulledById
      .get(notebookId)
      ?.pages.find((page) => page.id === pageId)?.pdf?.dataUrl
    if (already) continue
    try {
      const bytes = await transport.downloadBinaryFile(pdfFilePath(basePath, pageId))
      dataUrls.set(pageId, encodePngDataUrl(bytes))
    } catch (e) {
      const notFound =
        e instanceof RemoteFileNotFoundError ||
        (e as { name?: string } | null)?.name === 'RemoteFileNotFoundError'
      // A page without a remote image (404) simply stays as it is; any other
      // failure is retried on the next sync and is reported as incomplete so
      // the repair is not considered done.
      if (notFound) continue
      incomplete = true
      logger.warn(`PDF background repair failed (${notebookId}/${pageId})`, e)
    }
  }
  if (dataUrls.size === 0) return { repaired: [], incomplete }
  const byNotebook = new Map<string, string[]>()
  for (const { notebookId, pageId } of pending) {
    if (!dataUrls.has(pageId)) continue
    const ids = byNotebook.get(notebookId)
    if (ids) ids.push(pageId)
    else byNotebook.set(notebookId, [pageId])
  }
  const repaired: Notebook[] = []
  for (const [notebookId, pageIds] of byNotebook) {
    const notebook = pulledById.get(notebookId) ?? (await getNotebook(notebookId))
    if (!notebook) continue
    const ids = new Set(pageIds)
    const pages = notebook.pages.map((page) => {
      const dataUrl = ids.has(page.id) ? dataUrls.get(page.id) : undefined
      return dataUrl && page.pdf ? { ...page, pdf: { ...page.pdf, dataUrl } } : page
    })
    if (pages.every((page, i) => page === notebook.pages[i])) continue
    repaired.push({ ...notebook, pages })
  }
  return { repaired, incomplete }
}

/**
 * Downloads one notebook with its PDF backgrounds rehydrated. Used by the trash
 * "restore from cloud", which reads a remote notebook outside the sync plan.
 */
export async function downloadNotebook(
  basePath: string,
  transport: Transport,
  id: string,
): Promise<Notebook> {
  const text = await transport.downloadFile(notebookPath(basePath, id))
  return hydratePdfBackgrounds(basePath, transport, parseNotebookFile(text))
}

function notebookDisplayPath(
  remotePath: string,
  id: string,
  folders: Folder[],
  notebooks: NotebookSummary[],
  fallbackName?: string,
): string {
  const summary = notebooks.find((notebook) => notebook.id === id)
  const name = summary?.name ?? fallbackName ?? id
  const folderById = new Map(folders.map((folder) => [folder.id, folder]))
  const folderNames: string[] = []
  let folderId = summary?.folderId ?? null
  const visited = new Set<string>()
  while (folderId && !visited.has(folderId)) {
    visited.add(folderId)
    const folder = folderById.get(folderId)
    if (!folder) break
    folderNames.unshift(folder.name)
    folderId = folder.parentId
  }
  return `${remotePath} · ${[...folderNames, name].join('/')}`
}

export function hashFolders(folders: Folder[]): string {
  const sorted = folders
    .map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId ?? null,
      order: typeof f.order === 'number' ? f.order : null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify(sorted)
}

export function emptyManifest(): SyncManifest {
  return { version: MANIFEST_VERSION, updatedAt: 0, folders: { updatedAt: 0 }, notebooks: [] }
}

export function parseManifest(text: string): SyncManifest {
  try {
    const data = JSON.parse(text) as Partial<SyncManifest>
    return {
      // The in-memory manifest always describes the format this client writes;
      // a version-2 file is read tolerantly and upgraded on the next write.
      version: MANIFEST_VERSION,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      folders: {
        updatedAt:
          typeof data.folders?.updatedAt === 'number' ? data.folders.updatedAt : 0,
      },
      notebooks: Array.isArray(data.notebooks)
        ? data.notebooks.map((n) => {
            const pdfs: Record<string, string> = {}
            if (n?.pdfs && typeof n.pdfs === 'object') {
              for (const [pageId, hash] of Object.entries(n.pdfs)) {
                if (typeof hash === 'string') pdfs[pageId] = hash
              }
            }
            return {
              id: String(n?.id ?? ''),
              name: String(n?.name ?? ''),
              updatedAt: typeof n?.updatedAt === 'number' ? n.updatedAt : 0,
              deleted: !!n?.deleted,
              ...(Object.keys(pdfs).length > 0 ? { pdfs } : {}),
            }
          })
        : [],
    }
  } catch {
    return emptyManifest()
  }
}

export function serializeManifest(m: SyncManifest): string {
  return JSON.stringify({ ...m, version: MANIFEST_VERSION })
}

function upsertManifestNotebook(
  manifest: SyncManifest,
  entry: SyncManifestNotebook,
): SyncManifest {
  const next = manifest.notebooks.filter((n) => n.id !== entry.id)
  next.push(entry)
  return { ...manifest, notebooks: next }
}

function removeManifestNotebook(manifest: SyncManifest, id: string): SyncManifest {
  return { ...manifest, notebooks: manifest.notebooks.filter((n) => n.id !== id) }
}

function cloneNotebookAsCopy(nb: Notebook, suffix: string): Notebook {
  const now = Date.now()
  return {
    ...nb,
    id: uid(),
    name: nb.name + suffix,
    createdAt: now,
    updatedAt: now,
    pages: nb.pages.map((p) => {
      const norm = normalizePage(p)
      return {
        ...norm,
        id: uid(),
        layers: norm.layers.map((l) => ({
          ...l,
          id: uid(),
          strokes: l.strokes.map((s) => ({ ...s, id: uid(), points: s.points.slice() })),
          images: l.images.map((i) => ({ ...i, id: uid() })),
          texts: l.texts.map((t) => ({ ...t, id: uid() })),
        })),
        activeLayerId: norm.activeLayerId,
      }
    }),
  }
}

/** A locally persisted page whose PDF background bitmap was lost. */
export interface PendingPdfBitmap {
  notebookId: string
  pageId: string
}

export interface SyncInput {
  basePath: string
  folders: Folder[]
  notebooks: NotebookSummary[]
  state: CloudSyncState
  transport: Transport
  getNotebook: (id: string) => Promise<Notebook | undefined>
  /**
   * Locally persisted pages that keep their PDF metadata but lost the bitmap
   * (a client older than 2.4.2 cannot read `pdfs/<pageId>.png`). Optional: sync
   * restores them from the remote image even when the notebook is not pulled.
   */
  findMissingPdfBitmaps?: () => Promise<PendingPdfBitmap[]>
  onProgress?: (progress: SyncProgress) => void
}

export interface SyncOutput {
  result: SyncResult
  nextState: CloudSyncState
  manifest: SyncManifest
  pulledNotebooks: Notebook[]
  /** Notebooks whose missing PDF bitmap was restored from the remote image. */
  repairedNotebooks: Notebook[]
  /** True when a bitmap repair attempt failed for a non-404 reason. */
  pdfRepairIncomplete: boolean
  pulledFolders: Folder[] | null
  removedLocalNotebookIds: string[]
  pendingConflicts: SyncConflictItem[]
}

export interface MergePlan {
  pushIds: string[]
  pullIds: string[]
  deleteRemoteIds: string[]
  deleteLocalIds: string[]
  pushFolders: boolean
  pullFolders: boolean
  conflicts: SyncConflictItem[]
}

export function buildPlan(
  notebooks: NotebookSummary[],
  folders: Folder[],
  state: CloudSyncState,
  manifest: SyncManifest,
): MergePlan {
  const localById = new Map(notebooks.map((n) => [n.id, n]))
  const remoteById = new Map(manifest.notebooks.map((n) => [n.id, n]))
  const plan: MergePlan = {
    pushIds: [],
    pullIds: [],
    deleteRemoteIds: [],
    deleteLocalIds: [],
    pushFolders: false,
    pullFolders: false,
    conflicts: [],
  }

  for (const nb of notebooks) {
    const remote = remoteById.get(nb.id)
    const last = state.notebooks[nb.id]

    if (!remote) {
      plan.pushIds.push(nb.id)
      continue
    }
    if (remote.deleted) {
      if (!state.tombstones?.[nb.id] && last === undefined) {
        // No active tombstone and no sync baseline: this notebook reappeared
        // locally AFTER its deletion was confirmed on the server (e.g. restored
        // from the trash). Re-upload it so the remote copy comes back, instead
        // of deleting it locally again.
        plan.pushIds.push(nb.id)
      } else if (last === undefined || nb.updatedAt === last) {
        plan.deleteLocalIds.push(nb.id)
      } else {
        plan.conflicts.push({
          id: nb.id,
          name: nb.name,
          kind: 'notebook',
          conflictType: 'deletedRemoteModifiedLocal',
          localUpdatedAt: nb.updatedAt,
          remoteUpdatedAt: remote.updatedAt,
        })
      }
      continue
    }

    // Prefer a clearly newer remote notebook when a previous failed upload
    // advanced the local baseline without persisting the notebook body. This
    // repairs stale devices that otherwise appear locally modified and push
    // their old copy back to the cloud instead of pulling the real change.
    if (last !== undefined && remote.updatedAt === last && remote.updatedAt > nb.updatedAt) {
      plan.pullIds.push(nb.id)
      continue
    }

    if (last === undefined) {
      if (nb.updatedAt >= remote.updatedAt) plan.pushIds.push(nb.id)
      else plan.pullIds.push(nb.id)
      continue
    }

    const localChanged = nb.updatedAt !== last
    const remoteChanged = remote.updatedAt !== last
    if (!localChanged && !remoteChanged) {
      continue
    }
    if (localChanged && !remoteChanged) {
      plan.pushIds.push(nb.id)
    } else if (!localChanged && remoteChanged) {
      plan.pullIds.push(nb.id)
    } else {
      plan.conflicts.push({
        id: nb.id,
        name: nb.name,
        kind: 'notebook',
        conflictType: 'bothModified',
        localUpdatedAt: nb.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
      })
    }
  }

  for (const [id, deletedAt] of Object.entries(state.tombstones)) {
    const remote = remoteById.get(id)
    if (!remote) continue
    if (remote.deleted) continue
    const last = state.notebooks[id]
    if (last !== undefined && remote.updatedAt !== last) {
      plan.conflicts.push({
        id,
        name: remote.name,
        kind: 'notebook',
        conflictType: 'deletedLocalModifiedRemote',
        localUpdatedAt: deletedAt,
        remoteUpdatedAt: remote.updatedAt,
      })
    } else {
      plan.deleteRemoteIds.push(id)
    }
  }

  for (const rm of manifest.notebooks) {
    if (rm.deleted) continue
    if (localById.has(rm.id)) continue
    if (state.localOnlyDeleted?.[rm.id]) continue
    if (state.tombstones?.[rm.id]) continue
    plan.pullIds.push(rm.id)
  }

  const localHash = hashFolders(folders)
  // A device that has never synced has no folder baseline (`foldersHash` is
  // empty). Treat that as "local folders are the empty set, unchanged since the
  // baseline" instead of an actual local change, so a fresh device PULLS the
  // remote folders instead of raising a spurious conflict — otherwise resolving
  // that conflict with "keep local" uploads an empty folder list and wipes the
  // real folders on the server.
  const baselineHash = state.foldersHash === '' ? hashFolders([]) : state.foldersHash
  const localChanged = localHash !== baselineHash
  const remoteChanged = manifest.folders.updatedAt !== state.foldersUpdatedAt
  if (localChanged && remoteChanged) {
    plan.conflicts.push({
      id: 'folders',
      name: t('error.foldersName'),
      kind: 'folders',
      conflictType: 'bothModified',
      localUpdatedAt: state.foldersUpdatedAt,
      remoteUpdatedAt: manifest.folders.updatedAt,
    })
  } else if (localChanged) {
    plan.pushFolders = true
  } else if (remoteChanged) {
    plan.pullFolders = true
  }

  return plan
}

interface LegacyMigrationResult {
  manifest: SyncManifest
  baselineState: CloudSyncState
}

async function migrateLegacy(
  basePath: string,
  folders: Folder[],
  notebooks: NotebookSummary[],
  transport: Transport,
): Promise<LegacyMigrationResult> {
  const remoteNotebooks = new Map<string, Notebook>()
  const remoteNames = new Map<string, string>()
  const legacyPaths = new Map<string, string>()

  try {
    const names = await transport.listDirectory(`${basePath}/${NOTEBOOKS_DIR}`)
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const text = await transport.downloadFile(
          `${basePath}/${NOTEBOOKS_DIR}/${name}`,
        )
        const data = JSON.parse(text)
        const nb = data?.notebook as Notebook | undefined
        if (nb && nb.id) {
          remoteNotebooks.set(nb.id, nb)
          remoteNames.set(nb.id, nb.name)
          if (name !== `${nb.id}.json`) {
            legacyPaths.set(nb.id, `${basePath}/${NOTEBOOKS_DIR}/${name}`)
          }
        }
      } catch {
        // ignore unreadable files
      }
    }
  } catch {
    // ignore listing failures
  }

  let remoteFolders: Folder[] = []
  let legacyFolderPaths: string[] = []
  try {
    const names = await transport.listDirectory(`${basePath}/${FOLDERS_DIR}`)
    const seen = new Set<string>()
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      if (name !== 'folders.json') legacyFolderPaths.push(`${basePath}/${FOLDERS_DIR}/${name}`)
      try {
        const text = await transport.downloadFile(
          `${basePath}/${FOLDERS_DIR}/${name}`,
        )
        const data = JSON.parse(text)
        if (Array.isArray(data?.folders)) {
          for (const f of data.folders as Folder[]) {
            if (f?.id && !seen.has(f.id)) {
              seen.add(f.id)
              remoteFolders.push(f)
            }
          }
        }
      } catch {
        // ignore
      }
    }
    remoteFolders = remoteFolders.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    // ignore
  }

  const manifest = emptyManifest()
  manifest.updatedAt = Date.now()
  manifest.folders.updatedAt = Date.now()
  manifest.notebooks = [...remoteNotebooks.keys()].map((id) => ({
    id,
    name: remoteNames.get(id) ?? '',
    updatedAt: remoteNotebooks.get(id)!.updatedAt,
    deleted: false,
  }))

  for (const [id, legacyPath] of legacyPaths) {
    try {
      const nb = remoteNotebooks.get(id)!
      await transport.uploadFile(
        notebookPath(basePath, id),
        new TextEncoder().encode(
          JSON.stringify({ version: NOTEBOOK_FORMAT_VERSION, exportedAt: Date.now(), notebook: nb }),
        ),
        'application/json',
      )
      await transport.deleteRemoteFile(legacyPath)
    } catch {
      // ignore — arquivo legado permanece, mas não bloqueia
    }
  }

  if (remoteFolders.length > 0) {
    try {
      await transport.uploadFile(
        `${basePath}/${FOLDERS_PATH}`,
        new TextEncoder().encode(
          JSON.stringify({ version: 2, exportedAt: Date.now(), folders: remoteFolders }),
        ),
        'application/json',
      )
    } catch {
      // ignore
    }
  }
  for (const legacyPath of legacyFolderPaths) {
    try {
      await transport.deleteRemoteFile(legacyPath)
    } catch {
      // ignore
    }
  }

  const localById = new Map(notebooks.map((n) => [n.id, n]))
  const baseline: CloudSyncState = {
    id: 'main',
    lastSyncAt: null,
    foldersHash: folders.length > 0 ? hashFolders(folders) : hashFolders([]),
    foldersUpdatedAt: folders.length > 0 ? manifest.folders.updatedAt : 0,
    notebooks: {},
    tombstones: {},
    localOnlyDeleted: {},
  }
  for (const id of manifest.notebooks.map((n) => n.id)) {
    const local = localById.get(id)
    const remote = remoteNotebooks.get(id)!
    baseline.notebooks[id] = local
      ? Math.min(local.updatedAt, remote.updatedAt)
      : remote.updatedAt
  }

  return { manifest, baselineState: baseline }
}

export async function runSync(input: SyncInput): Promise<SyncOutput> {
  const { basePath, folders, notebooks, transport } = input
  const displayFile = (id: string, name?: string) =>
    notebookDisplayPath(notebookPath(basePath, id), id, folders, notebooks, name)
  let total = 1
  let completed = 0
  const report = (
    phase: SyncProgress['phase'],
    currentFile: string | null,
  ) => {
    const percent = Math.min(100, Math.round((completed / total) * 100))
    input.onProgress?.({
      phase,
      currentFile,
      completed,
      total,
      percent,
    })
  }
  report('preparing', null)
  const result: SyncResult = { pushed: [], pulled: [], deleted: [], conflicts: [], errors: [] }
  let state = input.state

  try {
    await transport.ensureDirectory(basePath)
    await transport.ensureDirectory(`${basePath}/${NOTEBOOKS_DIR}`)
    await transport.ensureDirectory(`${basePath}/${FOLDERS_DIR}`)
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    logger.error('Sync directory creation failed', e)
    result.errors.push(t('error.syncCreateDirsFailed', { message: errorMsg }))
    return {
      result,
      nextState: state,
      manifest: emptyManifest(),
      pulledNotebooks: [],
      repairedNotebooks: [],
      pdfRepairIncomplete: false,
      pulledFolders: null,
      removedLocalNotebookIds: [],
      pendingConflicts: [],
    }
  }

  let manifest: SyncManifest
  let migrated = false
  let manifestChanged = false
  try {
    const text = await transport.downloadFile(`${basePath}/${MANIFEST_PATH}`)
    manifest = parseManifest(text)
  } catch (e) {
    let effectiveError = e
    const isRemoteNotFound =
      e instanceof RemoteFileNotFoundError || (e as any).name === 'RemoteFileNotFoundError'

    if (!isRemoteNotFound && isBrowserFetchError(e)) {
      // ponytail: on some servers (WebDAV/CORS), a 404 for a missing manifest
      // is reported as a connection error (TypeError: Failed to fetch) instead
      // of a proper HTTP 404 response. If we just successfully created/verified
      // directories above, we assume the manifest is missing (404).
      logger.warn('Manifest download failed with browser fetch error (CORS likely), assuming missing (404)', e)
      effectiveError = new RemoteFileNotFoundError(`${basePath}/${MANIFEST_PATH}`)
    }

    if (
      !(effectiveError instanceof RemoteFileNotFoundError) &&
      (effectiveError as any).name !== 'RemoteFileNotFoundError'
    ) {
      const msg = effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
      logger.error('Sync manifest read failed', effectiveError)
      result.errors.push(t('error.syncReadManifestFailed', { message: msg }))
      return {
        result,
        nextState: state,
        manifest: emptyManifest(),
        pulledNotebooks: [],
        repairedNotebooks: [],
        pdfRepairIncomplete: false,
        pulledFolders: null,
        removedLocalNotebookIds: [],
        pendingConflicts: [],
      }
    }
    const migratedResult = await migrateLegacy(basePath, folders, notebooks, transport)
    manifest = migratedResult.manifest
    state = { ...migratedResult.baselineState, tombstones: { ...state.tombstones } }
    migrated = true
  }

  // Recover valid notebook files that are present remotely but missing from the
  // manifest. An interrupted upload can leave the body behind after the
  // manifest write fails; without this repair such a notebook is invisible to
  // buildPlan and is never shown in sync progress.
  try {
    const remoteFiles = await transport.listDirectory(`${basePath}/${NOTEBOOKS_DIR}`)
    const knownIds = new Set(manifest.notebooks.map((n) => n.id))
    for (const fileName of remoteFiles) {
      if (!fileName.endsWith('.json')) continue
      const id = fileName.slice(0, -'.json'.length)
      if (!id || knownIds.has(id)) continue
      try {
        const text = await transport.downloadFile(`${basePath}/${NOTEBOOKS_DIR}/${fileName}`)
        const data = JSON.parse(text)
        const nb = data?.notebook as Notebook | undefined
        if (!nb?.id || nb.id !== id || typeof nb.updatedAt !== 'number') continue
        manifest = upsertManifestNotebook(manifest, {
          id,
          name: nb.name,
          updatedAt: nb.updatedAt,
          deleted: false,
        })
        knownIds.add(id)
        manifestChanged = true
      } catch {
        // Invalid or partially uploaded files are left untouched.
      }
    }
  } catch (e) {
    logger.warn(`Remote notebook listing failed (${basePath}/${NOTEBOOKS_DIR})`, e)
  }

  // Baseline snapshot BEFORE this run's mutations: the local sync state must only
  // advance once the manifest is actually committed on the server. If the manifest
  // write fails, we restore this snapshot so the next sync re-runs the same plan
  // (idempotent) instead of silently pulling/stale-comparing against an old manifest.
  const baselineSnapshot = {
    foldersHash: state.foldersHash,
    foldersUpdatedAt: state.foldersUpdatedAt,
    notebooks: { ...state.notebooks },
    tombstones: { ...state.tombstones },
    localOnlyDeleted: { ...(state.localOnlyDeleted ?? {}) },
  }
  const manifestSnapshot = {
    ...manifest,
    folders: { ...manifest.folders },
    notebooks: manifest.notebooks.map((n) => ({ ...n })),
  }

  const plan = buildPlan(notebooks, folders, state, manifest)
  total = Math.max(
    1,
    plan.pushIds.length +
      plan.pullIds.length +
      plan.deleteRemoteIds.length +
      plan.deleteLocalIds.length +
      plan.conflicts.length,
  )
  report('preparing', null)
  manifestChanged = manifestChanged || migrated

  if (migrated && folders.length > 0) {
    try {
      await transport.uploadFile(
        `${basePath}/${FOLDERS_PATH}`,
        new TextEncoder().encode(
          JSON.stringify({ version: 2, exportedAt: Date.now(), folders }),
        ),
        'application/json',
      )
      state.foldersHash = hashFolders(folders)
      state.foldersUpdatedAt = Date.now()
      manifest.folders.updatedAt = Date.now()
      manifestChanged = true
    } catch (e) {
      result.errors.push(t('error.syncUploadFoldersFailed', { message: e instanceof Error ? e.message : String(e) }))
    }
  }
  const pulledNotebooks: Notebook[] = []
  const removedLocalNotebookIds: string[] = []
  const localById = new Map(notebooks.map((n) => [n.id, n]))

  for (const id of plan.pushIds) {
    const summary = localById.get(id)
    if (!summary) continue
    try {
      report('upload', displayFile(id, summary.name))
      const nb = await input.getNotebook(id)
      if (!nb) throw new Error(t('error.invalidNotebook'))
      manifest = upsertManifestNotebook(
        manifest,
        await uploadNotebook({
          basePath,
          transport,
          notebook: nb,
          previous: manifest.notebooks.find((entry) => entry.id === nb.id),
        }),
      )
      state.notebooks[nb.id] = nb.updatedAt
      manifestChanged = true
      result.pushed.push(nb.name)
    } catch (e) {
      result.errors.push(t('error.syncUploadNotebookFailed', { name: summary.name, message: e instanceof Error ? e.message : String(e) }))
    }
    completed++
    report('upload', null)
  }

  for (const id of plan.pullIds) {
    try {
      report('download', displayFile(id, manifest.notebooks.find((entry) => entry.id === id)?.name))
      const text = await transport.downloadFile(notebookPath(basePath, id))
      const nb = await hydratePdfBackgrounds(basePath, transport, parseNotebookFile(text))
      pulledNotebooks.push(nb)
      state.notebooks[id] = nb.updatedAt
      result.pulled.push(nb.name)
      // Heal image hashes an older client may have dropped from the manifest.
      const entry = manifest.notebooks.find((n) => n.id === id)
      const repaired = entry ? repairPdfHashes(entry, nb) : null
      if (repaired) {
        manifest = upsertManifestNotebook(manifest, repaired)
        manifestChanged = true
      }
    } catch (e) {
      if (e instanceof RemoteFileNotFoundError) {
        // The manifest lists a notebook whose file is missing on the server
        // (e.g. an interrupted upload or a stale manifest). Self-heal instead of
        // erroring forever: restore the local copy if it exists, otherwise prune
        // the phantom manifest entry.
        const summary = localById.get(id)
        if (summary) {
          try {
            const nb = await input.getNotebook(id)
            if (!nb) throw new Error(t('error.invalidNotebook'))
            manifest = upsertManifestNotebook(
              manifest,
              await uploadNotebook({
                basePath,
                transport,
                notebook: nb,
                previous: manifest.notebooks.find((entry) => entry.id === id),
              }),
            )
            state.notebooks[id] = nb.updatedAt
            manifestChanged = true
            result.pushed.push(nb.name)
          } catch (e2) {
            result.errors.push(
              t('error.syncUploadNotebookFailed', {
                name: summary.name,
                message: e2 instanceof Error ? e2.message : String(e2),
              }),
            )
          }
        } else {
          manifest = removeManifestNotebook(manifest, id)
          manifestChanged = true
        }
        continue
      }
      const msg = e instanceof Error ? e.message : String(e)
      logger.error(`Sync notebook download failed: ${id}`, e)
      result.errors.push(t('error.syncDownloadNotebookFailed', { id, message: msg }))
    }
    completed++
    report('download', null)
  }

  // Self-heal local pages whose bitmap was lost when an older client pulled a
  // version-3 notebook. Runs even when nothing is pushed or pulled, so an app
  // update alone is enough to bring the PDF background back.
  const repairedNotebooks: Notebook[] = []
  let pdfRepairIncomplete = false
  if (input.findMissingPdfBitmaps) {
    try {
      const missing = await input.findMissingPdfBitmaps()
      const repair = await repairLocalPdfBitmaps(
        basePath,
        transport,
        missing,
        pulledNotebooks,
        input.getNotebook,
      )
      repairedNotebooks.push(...repair.repaired)
      pdfRepairIncomplete = repair.incomplete
      for (const nb of repairedNotebooks) {
        const entry = manifest.notebooks.find((n) => n.id === nb.id)
        const repaired = entry ? repairPdfHashes(entry, nb) : null
        if (repaired) {
          manifest = upsertManifestNotebook(manifest, repaired)
          manifestChanged = true
        }
      }
    } catch (e) {
      pdfRepairIncomplete = true
      logger.warn('PDF background repair failed', e)
    }
  }

  const initiallyDeleted = new Set(
    manifest.notebooks.filter((n) => n.deleted).map((n) => n.id),
  )
  for (const id of initiallyDeleted) {
    if (localById.has(id)) continue
    if (state.tombstones[id]) continue
    manifest = removeManifestNotebook(manifest, id)
    manifestChanged = true
  }

  for (const id of plan.deleteRemoteIds) {
    try {
      report('delete', displayFile(id, manifest.notebooks.find((entry) => entry.id === id)?.name))
      const entry = manifest.notebooks.find((n) => n.id === id)
      await transport.deleteRemoteFile(notebookPath(basePath, id))
      for (const pageId of Object.keys(entry?.pdfs ?? {})) {
        try {
          await transport.deleteRemoteFile(pdfFilePath(basePath, pageId))
        } catch {
          // Orphan image only — the notebook deletion itself succeeded.
        }
      }
      manifest = upsertManifestNotebook(manifest, {
        id,
        name: entry?.name ?? id,
        updatedAt: Date.now(),
        deleted: true,
      })
      delete state.tombstones[id]
      delete state.notebooks[id]
      manifestChanged = true
      result.deleted.push(entry?.name ?? id)
    } catch (e) {
      result.errors.push(t('error.syncDeleteFailed', { name: id, message: e instanceof Error ? e.message : String(e) }))
    }
    completed++
    report('delete', null)
  }

  for (const id of plan.deleteLocalIds) {
    const entry = manifest.notebooks.find((n) => n.id === id)
    removedLocalNotebookIds.push(id)
    delete state.notebooks[id]
    manifest = removeManifestNotebook(manifest, id)
    manifestChanged = true
    result.deleted.push(entry?.name ?? id)
  }

  let pulledFolders: Folder[] | null = null
  if (plan.pushFolders) {
    try {
      await transport.uploadFile(
        `${basePath}/${FOLDERS_PATH}`,
        new TextEncoder().encode(
          JSON.stringify({ version: 2, exportedAt: Date.now(), folders }),
        ),
        'application/json',
      )
      state.foldersHash = hashFolders(folders)
      state.foldersUpdatedAt = Date.now()
      manifest.folders.updatedAt = Date.now()
      manifestChanged = true
    } catch (e) {
      result.errors.push(t('error.syncUploadFoldersFailed', { message: e instanceof Error ? e.message : String(e) }))
    }
  } else if (plan.pullFolders) {
    try {
      const text = await transport.downloadFile(`${basePath}/${FOLDERS_PATH}`)
      const data = JSON.parse(text)
      if (Array.isArray(data?.folders)) {
        pulledFolders = data.folders as Folder[]
        state.foldersHash = hashFolders(pulledFolders)
        state.foldersUpdatedAt = manifest.folders.updatedAt
      }
    } catch (e) {
      if (e instanceof RemoteFileNotFoundError) {
        if (folders.length > 0) {
          try {
            await transport.uploadFile(
              `${basePath}/${FOLDERS_PATH}`,
              new TextEncoder().encode(
                JSON.stringify({ version: 2, exportedAt: Date.now(), folders }),
              ),
              'application/json',
            )
            state.foldersHash = hashFolders(folders)
            state.foldersUpdatedAt = Date.now()
            manifest.folders.updatedAt = Date.now()
            manifestChanged = true
          } catch (e2) {
            result.errors.push(
              t('error.syncUploadFoldersFailed', { message: e2 instanceof Error ? e2.message : String(e2) }),
            )
          }
        } else {
          pulledFolders = []
          state.foldersHash = hashFolders([])
          state.foldersUpdatedAt = manifest.folders.updatedAt
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e)
        logger.error(`Sync folders download failed (${basePath}/${FOLDERS_PATH})`, e)
        result.errors.push(t('error.syncDownloadFoldersFailed', { message: msg }))
      }
    }
  }

  const retentionCutoff = Date.now() - TOMBSTONE_RETENTION_MS
  for (const [id, ts] of Object.entries(state.tombstones)) {
    if (ts < retentionCutoff) delete state.tombstones[id]
  }
  for (const n of manifest.notebooks) {
    if (n.deleted && n.updatedAt < retentionCutoff) {
      manifest = removeManifestNotebook(manifest, n.id)
      manifestChanged = true
    }
  }
  for (const id of Object.keys(state.localOnlyDeleted ?? {})) {
    const entry = manifest.notebooks.find((n) => n.id === id)
    if (!entry || entry.deleted) delete state.localOnlyDeleted[id]
  }

  let manifestWriteFailed = false
  if (manifestChanged) {
    report('manifest', MANIFEST_PATH)
    manifest.updatedAt = Date.now()
    try {
      await transport.uploadFile(
        `${basePath}/${MANIFEST_PATH}`,
        new TextEncoder().encode(serializeManifest(manifest)),
        'application/json',
      )
    } catch (e) {
      manifestWriteFailed = true
      result.errors.push(t('error.syncSaveManifestFailed', { message: e instanceof Error ? e.message : String(e) }))
    }
  }

  if (manifestWriteFailed) {
    // The server did not confirm the new manifest: keep the previous baseline (and
    // manifest) so the next sync re-evaluates the same operations (idempotent) and
    // can never silently overwrite local changes based on a stale manifest.
    state.foldersHash = baselineSnapshot.foldersHash
    state.foldersUpdatedAt = baselineSnapshot.foldersUpdatedAt
    state.notebooks = baselineSnapshot.notebooks
    state.tombstones = baselineSnapshot.tombstones
    state.localOnlyDeleted = baselineSnapshot.localOnlyDeleted
    manifest = manifestSnapshot
  } else {
    state.lastSyncAt = Date.now()
  }
  if (plan.conflicts.length > 0) {
    report(
      'conflict',
      displayFile(
        plan.conflicts[0].id,
        manifest.notebooks.find((entry) => entry.id === plan.conflicts[0].id)?.name,
      ),
    )
  } else {
    completed = total
    report(result.errors.length > 0 ? 'error' : 'complete', null)
  }

  return {
    result: {
      pushed: result.pushed,
      pulled: result.pulled,
      deleted: result.deleted,
      conflicts: [...plan.conflicts],
      errors: result.errors,
    },
    nextState: state,
    manifest,
    pulledNotebooks,
    repairedNotebooks,
    pdfRepairIncomplete,
    pulledFolders,
    removedLocalNotebookIds,
    pendingConflicts: plan.conflicts,
  }
}

export interface ConflictResolutionInput {
  basePath: string
  transport: Transport
  choices: Record<string, ConflictChoice>
  localNotebooks: NotebookSummary[]
  folders: Folder[] | null
  state: CloudSyncState
  manifest: SyncManifest
  getNotebook: (id: string) => Promise<Notebook | undefined>
  onProgress?: (progress: SyncProgress) => void
}

export interface ConflictResolutionOutput {
  nextState: CloudSyncState
  manifest: SyncManifest
  pulledNotebooks: Notebook[]
  newNotebooks: Notebook[]
  removedLocalNotebookIds: string[]
  pulledFolders: Folder[] | null
}

export async function applyConflictChoices(
  input: ConflictResolutionInput,
): Promise<ConflictResolutionOutput> {
  const { basePath, transport, choices, localNotebooks, folders, state: initial, manifest: initialManifest } = input
  let state = { ...initial, notebooks: { ...initial.notebooks }, tombstones: { ...initial.tombstones } }
  let manifest = initialManifest
  let manifestChanged = false
  const pulledNotebooks: Notebook[] = []
  const newNotebooks: Notebook[] = []
  const removedLocalNotebookIds: string[] = []
  const localById = new Map(localNotebooks.map((n) => [n.id, n]))
  let pulledFolders: Folder[] | null = null
  const choiceEntries = Object.entries(choices)
  const displayFile = (id: string, name?: string) =>
    notebookDisplayPath(notebookPath(basePath, id), id, folders ?? [], localNotebooks, name)
  const report = (completed: number, currentFile: string | null) => {
    const total = Math.max(1, choiceEntries.length)
    input.onProgress?.({
      phase: 'download',
      currentFile,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    })
  }

  const loadRemote = async (id: string): Promise<Notebook> => {
    const text = await transport.downloadFile(notebookPath(basePath, id))
    return hydratePdfBackgrounds(basePath, transport, parseNotebookFile(text))
  }

  for (const [index, [id, choice]] of choiceEntries.entries()) {
    report(
      index,
      id === 'folders'
        ? `${basePath}/${FOLDERS_PATH}`
        : displayFile(id, manifest.notebooks.find((entry) => entry.id === id)?.name),
    )
    if (id === 'folders') {
      if (choice === 'useServer') {
        try {
          const text = await transport.downloadFile(`${basePath}/${FOLDERS_PATH}`)
          const data = JSON.parse(text)
          if (Array.isArray(data?.folders)) {
            pulledFolders = data.folders as Folder[]
            state.foldersHash = hashFolders(pulledFolders)
            state.foldersUpdatedAt = manifest.folders.updatedAt
          }
        } catch (e) {
          throw new Error(t('error.syncDownloadFoldersFailed', {
            message: e instanceof Error ? e.message : String(e),
          }))
        }
      } else if (folders) {
        try {
          await transport.uploadFile(
            `${basePath}/${FOLDERS_PATH}`,
            new TextEncoder().encode(
              JSON.stringify({ version: 2, exportedAt: Date.now(), folders }),
            ),
            'application/json',
          )
          state.foldersHash = hashFolders(folders)
          state.foldersUpdatedAt = Date.now()
          manifest.folders.updatedAt = Date.now()
          manifestChanged = true
        } catch (e) {
          throw new Error(t('error.syncUploadFoldersFailed', {
            message: e instanceof Error ? e.message : String(e),
          }))
        }
      }
      continue
    }


    const entry = manifest.notebooks.find((n) => n.id === id)

    if (choice === 'confirmDelete') {
      if (entry && !entry.deleted) {
        try {
          await transport.deleteRemoteFile(notebookPath(basePath, id))
          for (const pageId of Object.keys(entry.pdfs ?? {})) {
            try {
              await transport.deleteRemoteFile(pdfFilePath(basePath, pageId))
            } catch {
              // Orphan image only — the notebook deletion itself succeeded.
            }
          }
          manifest = upsertManifestNotebook(manifest, {
            id,
            name: entry.name,
            updatedAt: Date.now(),
            deleted: true,
          })
          delete state.tombstones[id]
          delete state.notebooks[id]
          manifestChanged = true
        } catch (e) {
          throw new Error(t('error.syncDeleteFailed', {
            name: id,
            message: e instanceof Error ? e.message : String(e),
          }))
        }
      } else {
        removedLocalNotebookIds.push(id)
        delete state.notebooks[id]
        manifest = removeManifestNotebook(manifest, id)
        manifestChanged = true
      }
      continue
    }

    if (choice === 'keepLocal') {
      const summary = localById.get(id)
      if (summary) {
        try {
          const nb = await input.getNotebook(id)
          if (!nb) throw new Error(t('error.invalidNotebook'))
          manifest = upsertManifestNotebook(
            manifest,
            await uploadNotebook({
              basePath,
              transport,
              notebook: nb,
              previous: manifest.notebooks.find((entry) => entry.id === id),
            }),
          )
          state.notebooks[id] = nb.updatedAt
          delete state.tombstones[id]
          manifestChanged = true
        } catch (e) {
          throw new Error(t('error.syncDeleteFailed', {
            name: id,
            message: e instanceof Error ? e.message : String(e),
          }))
        }
      }
      continue
    }

    if (choice === 'useServer' || choice === 'restoreFromServer') {
      try {
        const remote = await loadRemote(id)
        pulledNotebooks.push(remote)
        state.notebooks[id] = remote.updatedAt
        delete state.tombstones[id]
        // Keep the image hashes: accepting the server copy must not make the
        // next push re-upload every PDF bitmap.
        const hashes = pdfHashesFor(entry?.pdfs, remote)
        manifest = upsertManifestNotebook(manifest, {
          id,
          name: remote.name,
          updatedAt: remote.updatedAt,
          deleted: false,
          ...(Object.keys(hashes).length > 0 ? { pdfs: hashes } : {}),
        })
        manifestChanged = true
      } catch (e) {
        throw new Error(t('error.syncDownloadNotebookFailed', {
          id,
          message: e instanceof Error ? e.message : String(e),
        }))
      }
      continue
    }

    if (choice === 'keepBoth') {
      const summary = localById.get(id)
      if (summary && entry) {
        try {
          const nb = await input.getNotebook(id)
          if (!nb) throw new Error(t('error.invalidNotebook'))
          const remote = await loadRemote(id)
          const copy = cloneNotebookAsCopy(remote, t('copySuffix'))
          newNotebooks.push(copy)
          manifest = upsertManifestNotebook(
            manifest,
            await uploadNotebook({ basePath, transport, notebook: copy }),
          )
          manifest = upsertManifestNotebook(
            manifest,
            await uploadNotebook({ basePath, transport, notebook: nb, previous: entry }),
          )
          state.notebooks[id] = nb.updatedAt
          state.notebooks[copy.id] = copy.updatedAt
          manifestChanged = true
        } catch (e) {
          throw new Error(t('error.syncUploadNotebookFailed', {
            name: summary.name,
            message: e instanceof Error ? e.message : String(e),
          }))
        }
      }
      continue
    }
  }

  report(choiceEntries.length, null)
  if (manifestChanged) {
    manifest.updatedAt = Date.now()
    try {
      await transport.uploadFile(
        `${basePath}/${MANIFEST_PATH}`,
        new TextEncoder().encode(serializeManifest(manifest)),
        'application/json',
      )
    } catch (e) {
      throw new Error(t('error.syncSaveManifestFailed', {
        message: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  return {
    nextState: state,
    manifest,
    pulledNotebooks,
    newNotebooks,
    removedLocalNotebookIds,
    pulledFolders,
  }
}
