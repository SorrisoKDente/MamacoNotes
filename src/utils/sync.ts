import type {
  CloudSyncState,
  ConflictChoice,
  Folder,
  Notebook,
  SyncConflictItem,
  SyncManifest,
  SyncManifestNotebook,
  SyncResult,
} from '../types'
import { normalizePage, uid } from '../types'
import { t } from '../i18n'
import { RemoteFileNotFoundError } from './webdav'
import type { Transport } from './webdav'
import { logger } from './logger'

export const MANIFEST_PATH = 'manifest.json'
export const NOTEBOOKS_DIR = 'notebooks'
export const FOLDERS_DIR = 'folders'
export const FOLDERS_PATH = `${FOLDERS_DIR}/folders.json`
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function notebookPath(basePath: string, id: string): string {
  return `${basePath}/${NOTEBOOKS_DIR}/${id}.json`
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
  return { version: 2, updatedAt: 0, folders: { updatedAt: 0 }, notebooks: [] }
}

export function parseManifest(text: string): SyncManifest {
  try {
    const data = JSON.parse(text) as Partial<SyncManifest>
    return {
      version: 2,
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
      folders: {
        updatedAt:
          typeof data.folders?.updatedAt === 'number' ? data.folders.updatedAt : 0,
      },
      notebooks: Array.isArray(data.notebooks)
        ? data.notebooks.map((n) => ({
            id: String(n?.id ?? ''),
            name: String(n?.name ?? ''),
            updatedAt: typeof n?.updatedAt === 'number' ? n.updatedAt : 0,
            deleted: !!n?.deleted,
          }))
        : [],
    }
  } catch {
    return emptyManifest()
  }
}

export function serializeManifest(m: SyncManifest): string {
  return JSON.stringify(m)
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

export interface SyncInput {
  basePath: string
  folders: Folder[]
  notebooks: Notebook[]
  state: CloudSyncState
  transport: Transport
}

export interface SyncOutput {
  result: SyncResult
  nextState: CloudSyncState
  manifest: SyncManifest
  pulledNotebooks: Notebook[]
  pulledFolders: Folder[] | null
  removedLocalNotebookIds: string[]
  pendingConflicts: SyncConflictItem[]
}

export interface MergePlan {
  push: Notebook[]
  pullIds: string[]
  deleteRemoteIds: string[]
  deleteLocalIds: string[]
  pushFolders: boolean
  pullFolders: boolean
  conflicts: SyncConflictItem[]
}

export function buildPlan(
  notebooks: Notebook[],
  folders: Folder[],
  state: CloudSyncState,
  manifest: SyncManifest,
): MergePlan {
  const localById = new Map(notebooks.map((n) => [n.id, n]))
  const remoteById = new Map(manifest.notebooks.map((n) => [n.id, n]))
  const plan: MergePlan = {
    push: [],
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
      plan.push.push(nb)
      continue
    }
    if (remote.deleted) {
      if (!state.tombstones?.[nb.id] && last === undefined) {
        // No active tombstone and no sync baseline: this notebook reappeared
        // locally AFTER its deletion was confirmed on the server (e.g. restored
        // from the trash). Re-upload it so the remote copy comes back, instead
        // of deleting it locally again.
        plan.push.push(nb)
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

    if (last === undefined) {
      if (nb.updatedAt >= remote.updatedAt) plan.push.push(nb)
      else plan.pullIds.push(nb.id)
      continue
    }

    const localChanged = nb.updatedAt !== last
    const remoteChanged = remote.updatedAt !== last
    if (!localChanged && !remoteChanged) {
      continue
    }
    if (localChanged && !remoteChanged) {
      plan.push.push(nb)
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
  notebooks: Notebook[],
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
          JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: nb }),
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
      pulledFolders: null,
      removedLocalNotebookIds: [],
      pendingConflicts: [],
    }
  }

  let manifest: SyncManifest
  let migrated = false
  try {
    const text = await transport.downloadFile(`${basePath}/${MANIFEST_PATH}`)
    manifest = parseManifest(text)
  } catch (e) {
    if (!(e instanceof RemoteFileNotFoundError)) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('Sync manifest read failed', e)
      result.errors.push(t('error.syncReadManifestFailed', { message: msg }))
      return {
        result,
        nextState: state,
        manifest: emptyManifest(),
        pulledNotebooks: [],
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
  let manifestChanged = migrated

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

  for (const nb of plan.push) {
    try {
      const path = notebookPath(basePath, nb.id)
      await transport.uploadFile(
        path,
        new TextEncoder().encode(JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: nb })),
        'application/json',
      )
      manifest = upsertManifestNotebook(manifest, {
        id: nb.id,
        name: nb.name,
        updatedAt: nb.updatedAt,
        deleted: false,
      })
      state.notebooks[nb.id] = nb.updatedAt
      manifestChanged = true
      result.pushed.push(nb.name)
    } catch (e) {
      result.errors.push(t('error.syncUploadNotebookFailed', { name: nb.name, message: e instanceof Error ? e.message : String(e) }))
    }
  }

  for (const id of plan.pullIds) {
    try {
      const text = await transport.downloadFile(notebookPath(basePath, id))
      const data = JSON.parse(text)
      const nb = data?.notebook as Notebook | undefined
      if (!nb) throw new Error(t('error.invalidNotebook'))
      pulledNotebooks.push(nb)
      state.notebooks[id] = nb.updatedAt
      result.pulled.push(nb.name)
    } catch (e) {
      if (e instanceof RemoteFileNotFoundError) {
        // The manifest lists a notebook whose file is missing on the server
        // (e.g. an interrupted upload or a stale manifest). Self-heal instead of
        // erroring forever: restore the local copy if it exists, otherwise prune
        // the phantom manifest entry.
        const local = localById.get(id)
        if (local) {
          try {
            const path = notebookPath(basePath, id)
            await transport.uploadFile(
              path,
              new TextEncoder().encode(
                JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: local }),
              ),
              'application/json',
            )
            manifest = upsertManifestNotebook(manifest, {
              id,
              name: local.name,
              updatedAt: local.updatedAt,
              deleted: false,
            })
            state.notebooks[id] = local.updatedAt
            manifestChanged = true
            result.pushed.push(local.name)
          } catch (e2) {
            result.errors.push(
              t('error.syncUploadNotebookFailed', {
                name: local.name,
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
      const entry = manifest.notebooks.find((n) => n.id === id)
      await transport.deleteRemoteFile(notebookPath(basePath, id))
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
    pulledFolders,
    removedLocalNotebookIds,
    pendingConflicts: plan.conflicts,
  }
}

export interface ConflictResolutionInput {
  basePath: string
  transport: Transport
  choices: Record<string, ConflictChoice>
  localNotebooks: Notebook[]
  folders: Folder[] | null
  state: CloudSyncState
  manifest: SyncManifest
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

  const loadRemote = async (id: string): Promise<Notebook> => {
    const text = await transport.downloadFile(notebookPath(basePath, id))
    const data = JSON.parse(text)
    const nb = data?.notebook as Notebook | undefined
    if (!nb) throw new Error(t('error.invalidRemoteNotebook'))
    return nb
  }

  for (const [id, choice] of Object.entries(choices)) {
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
          // ignore — pastas permanecem locais
          state.foldersHash = folders ? hashFolders(folders) : state.foldersHash
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
          // ignore
        }
      }
      continue
    }

    const entry = manifest.notebooks.find((n) => n.id === id)
    const local = localById.get(id)

    if (choice === 'confirmDelete') {
      if (entry && !entry.deleted) {
        try {
          await transport.deleteRemoteFile(notebookPath(basePath, id))
          manifest = upsertManifestNotebook(manifest, {
            id,
            name: entry.name,
            updatedAt: Date.now(),
            deleted: true,
          })
          delete state.tombstones[id]
          delete state.notebooks[id]
          manifestChanged = true
        } catch {
          // ignore
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
      if (local) {
        try {
          const path = notebookPath(basePath, id)
          await transport.uploadFile(
            path,
            new TextEncoder().encode(
              JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: local }),
            ),
            'application/json',
          )
          manifest = upsertManifestNotebook(manifest, {
            id,
            name: local.name,
            updatedAt: local.updatedAt,
            deleted: false,
          })
          state.notebooks[id] = local.updatedAt
          delete state.tombstones[id]
          manifestChanged = true
        } catch {
          // ignore
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
        manifest = upsertManifestNotebook(manifest, {
          id,
          name: remote.name,
          updatedAt: remote.updatedAt,
          deleted: false,
        })
        manifestChanged = true
      } catch {
        // ignore
      }
      continue
    }

    if (choice === 'keepBoth') {
      if (local && entry) {
        try {
          const remote = await loadRemote(id)
          const copy = cloneNotebookAsCopy(remote, t('copySuffix'))
          newNotebooks.push(copy)
          await transport.uploadFile(
            notebookPath(basePath, copy.id),
            new TextEncoder().encode(
              JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: copy }),
            ),
            'application/json',
          )
          manifest = upsertManifestNotebook(manifest, {
            id,
            name: local.name,
            updatedAt: local.updatedAt,
            deleted: false,
          })
          manifest = upsertManifestNotebook(manifest, {
            id: copy.id,
            name: copy.name,
            updatedAt: copy.updatedAt,
            deleted: false,
          })
          state.notebooks[id] = local.updatedAt
          state.notebooks[copy.id] = copy.updatedAt
          manifestChanged = true
        } catch {
          // ignore
        }
      }
      continue
    }
  }

  if (manifestChanged) {
    manifest.updatedAt = Date.now()
    try {
      await transport.uploadFile(
        `${basePath}/${MANIFEST_PATH}`,
        new TextEncoder().encode(serializeManifest(manifest)),
        'application/json',
      )
    } catch {
      // ignore
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
