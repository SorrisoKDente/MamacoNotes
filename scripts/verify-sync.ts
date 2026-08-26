/**
 * Verification script for the sync fixes.
 *
 * Exercises `buildPlan` and `runSync` against a fake in-memory transport to prove:
 *  1. buildPlan decisions (push/pull/conflict/delete/folders)
 *  2. runSync happy path advances the baseline and sets lastSyncAt
 *  3. A failed manifest write ROLLS BACK the baseline (no silent pull on the
 *     next run) and does NOT set lastSyncAt
 *  4. The next run (transport healthy) re-runs the same plan (idempotent)
 *  5. An authentication failure (401) surfaces a clear message and leaves the
 *     sync state untouched
 *
 * Run: npx tsx scripts/verify-sync.ts
 */
import {
  buildPlan,
  hashFolders,
  runSync,
  serializeManifest,
  emptyManifest,
  MANIFEST_PATH,
} from '../src/utils/sync'
import type { CloudSyncState, Folder, Notebook, SyncManifest } from '../src/types'
import type { Transport } from '../src/utils/webdav'
import { RemoteFileNotFoundError } from '../src/utils/webdav'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

function makeNotebook(id: string, name: string, updatedAt: number): Notebook {
  return { id, name, folderId: null, pages: [], createdAt: updatedAt, updatedAt }
}

function makeState(overrides: Partial<CloudSyncState> = {}): CloudSyncState {
  return {
    id: 'main',
    lastSyncAt: null,
    foldersHash: hashFolders([]),
    foldersUpdatedAt: 0,
    notebooks: {},
    tombstones: {},
    localOnlyDeleted: {},
    ...overrides,
  }
}

class FakeTransport implements Transport {
  files = new Map<string, string>()
  failManifestWrite = false
  failEnsureDirectory = false
  ensureDirCalls: string[] = []

  async ensureDirectory(dirPath: string): Promise<void> {
    this.ensureDirCalls.push(dirPath)
    if (this.failEnsureDirectory) {
      throw new Error(
        'Falha de autenticação (401). Verifique o usuário e a senha (app password) do servidor WebDAV.',
      )
    }
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/'
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.slice(prefix.length))
      .filter((n) => !n.includes('/'))
  }

  async uploadFile(filePath: string, bytes: Uint8Array | Blob, _contentType: string): Promise<void> {
    if (filePath.endsWith(`/${MANIFEST_PATH}`) && this.failManifestWrite) {
      throw new Error('Failed to save manifest (server rejected the write)')
    }
    const text = bytes instanceof Blob ? await bytes.text() : new TextDecoder().decode(bytes)
    this.files.set(filePath, text)
  }

  async downloadFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath)
    if (content === undefined) throw new RemoteFileNotFoundError(filePath)
    return content
  }

  async deleteRemoteFile(filePath: string): Promise<void> {
    this.files.delete(filePath)
  }
}

function seedManifest(t: FakeTransport, basePath: string, manifest: SyncManifest): void {
  t.files.set(`${basePath}/${MANIFEST_PATH}`, serializeManifest(manifest))
}

console.log('== buildPlan ==')

{
  const nb = makeNotebook('nb-new', 'New', 1000)
  const plan = buildPlan([nb], [], makeState(), emptyManifest())
  assert(plan.push.length === 1 && plan.push[0].id === nb.id, 'new local notebook -> push')
}

{
  const nb = makeNotebook('nb-1', 'Same', 1000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 1000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(
    plan.push.length === 0 && plan.pullIds.length === 0 && plan.conflicts.length === 0,
    'unchanged notebook -> no action',
  )
}

{
  const nb = makeNotebook('nb-1', 'Local', 2000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 1000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(plan.push.length === 1 && plan.pullIds.length === 0, 'local changed -> push')
}

{
  const nb = makeNotebook('nb-1', 'Remote', 1000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: false }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(plan.pullIds.length === 1 && plan.push.length === 0, 'remote changed -> pull')
}

{
  const nb = makeNotebook('nb-1', 'Both', 2000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: false }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(
    plan.conflicts.length === 1 && plan.conflicts[0].conflictType === 'bothModified',
    'both changed -> conflict (bothModified)',
  )
}

{
  const nb = makeNotebook('nb-1', 'Del', 1000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 2000, deleted: true }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(plan.deleteLocalIds.length === 1, 'remote tombstone + local unchanged -> delete local')
}

{
  const nb = makeNotebook('nb-1', 'DelLocal', 1000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: false }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1000 }, tombstones: { [nb.id]: 1500 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(
    plan.conflicts.length === 1 &&
      plan.conflicts[0].conflictType === 'deletedLocalModifiedRemote',
    'local tombstone + remote modified -> conflict',
  )
}

{
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: 'nb-remote', name: 'RemoteOnly', updatedAt: 2000, deleted: false }],
  }
  const plan = buildPlan([], [], makeState(), manifest)
  assert(plan.pullIds.length === 1 && plan.pullIds[0] === 'nb-remote', 'remote-only -> pull')
}

{
  const folders: Folder[] = [{ id: 'f1', name: 'F1', parentId: null, createdAt: 1000 }]
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 2000 },
    notebooks: [],
  }
  const state = makeState({ foldersHash: 'old', foldersUpdatedAt: 1000 })
  const plan = buildPlan([], folders, state, manifest)
  assert(
    plan.conflicts.length === 1 && plan.conflicts[0].kind === 'folders',
    'folders changed on both sides -> folders conflict',
  )
}

{
  const folders: Folder[] = [{ id: 'f1', name: 'F1', parentId: null, createdAt: 1000 }]
  const manifest = emptyManifest()
  const state = makeState({ foldersHash: 'old', foldersUpdatedAt: 0 })
  const plan = buildPlan([], folders, state, manifest)
  assert(plan.pushFolders && !plan.pullFolders, 'folders changed locally -> pushFolders')
}

{
  const folders: Folder[] = []
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 2000 },
    notebooks: [],
  }
  const state = makeState({ foldersHash: hashFolders([]), foldersUpdatedAt: 1000 })
  const plan = buildPlan([], folders, state, manifest)
  assert(!plan.pushFolders && plan.pullFolders, 'folders changed remotely -> pullFolders')
}

{
  // Regression: a device that NEVER synced has an empty foldersHash baseline
  // (`''`) and no local folders. This must NOT raise a folder conflict — it
  // must pull the remote folders. Previously the empty baseline was treated as
  // a local change, producing a spurious 'bothModified' conflict; resolving it
  // with "keep local" uploaded an empty folder list and wiped the server's real
  // folders.
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 2000 },
    notebooks: [],
  }
  const state = makeState({ foldersHash: '', foldersUpdatedAt: 0 })
  const plan = buildPlan([], [], state, manifest)
  assert(
    !plan.pushFolders && plan.pullFolders && plan.conflicts.length === 0,
    'fresh device (empty foldersHash, no local folders): pull remote folders, NO conflict',
  )
}

{
  // Regression (runSync): a fresh device pulls the remote folders.json instead
  // of conflicting; the notebooks it pulls reference those folders.
  const folders: Folder[] = [{ id: 'f1', name: '日本語', parentId: null, createdAt: 1000 }]
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 2000 },
    notebooks: [],
  }
  const t = new FakeTransport()
  seedManifest(t, 'base', manifest)
  t.files.set(
    'base/folders/folders.json',
    JSON.stringify({ version: 2, exportedAt: Date.now(), folders }),
  )
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state: makeState({ foldersHash: '', foldersUpdatedAt: 0 }),
    transport: t,
  })
  assert(out.result.errors.length === 0, 'fresh device runSync: no errors')
  assert(out.result.conflicts.length === 0, 'fresh device runSync: no conflicts')
  assert(
    out.pulledFolders !== null && out.pulledFolders.length === 1 && out.pulledFolders[0].id === 'f1',
    'fresh device runSync: remote folders pulled',
  )
}

{
  // Bug A regression (pull loop): a notebook with an ACTIVE tombstone must NOT
  // be re-pulled even though the remote still lists it. It may only be deleted
  // remotely (deleteRemoteIds), never downloaded back locally.
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: 'nb-tomb', name: 'Tombstoned', updatedAt: 2000, deleted: false }],
  }
  const state = makeState({ tombstones: { 'nb-tomb': 1500 } })
  const plan = buildPlan([], [], state, manifest)
  assert(plan.pullIds.length === 0, 'Bug A: tombstoned notebook is NOT pulled')
  assert(
    plan.deleteRemoteIds.includes('nb-tomb'),
    'Bug A: tombstoned notebook is deleted on the cloud',
  )
}

{
  // Restore-from-trash: the local notebook reappeared AFTER its remote deletion
  // was confirmed (manifest deleted:true) and its tombstone was cleared. No sync
  // baseline exists for it, so it must be re-uploaded (push), NOT deleted again.
  const nb = makeNotebook('nb-restored', 'Restored', 2000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: true }],
  }
  const plan = buildPlan([nb], [], makeState(), manifest)
  assert(
    plan.push.length === 1 && plan.push[0].id === nb.id,
    'remote tombstone + local copy + no baseline -> push (restore from trash)',
  )
  assert(
    plan.deleteLocalIds.length === 0 && plan.conflicts.length === 0,
    'remote tombstone + local copy + no baseline -> NO delete/conflict',
  )
}

{
  // Same remote state but an ACTIVE local tombstone: the deletion is still in
  // progress, so the local copy must be removed, not re-uploaded.
  const nb = makeNotebook('nb-ts', 'Ts', 2000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: true }],
  }
  const state = makeState({ tombstones: { [nb.id]: 1500 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(
    plan.deleteLocalIds.length === 1 && plan.push.length === 0,
    'remote tombstone + active local tombstone -> delete local',
  )
}

{
  // Remote tombstone + local copy modified since baseline -> conflict, so the
  // user decides whether to keep local edits (push) or discard them.
  const nb = makeNotebook('nb-mod', 'Mod', 2000)
  const manifest: SyncManifest = {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: true }],
  }
  const state = makeState({ notebooks: { [nb.id]: 1500 } })
  const plan = buildPlan([nb], [], state, manifest)
  assert(
    plan.conflicts.length === 1 &&
      plan.conflicts[0].conflictType === 'deletedRemoteModifiedLocal',
    'remote tombstone + local modified -> conflict (deletedRemoteModifiedLocal)',
  )
  assert(
    plan.deleteLocalIds.length === 0 && plan.pullIds.length === 0,
    'remote tombstone + local modified -> NO silent delete/pull',
  )
}

console.log('== runSync ==')

{
  const nb = makeNotebook('nb-1', 'Happy', 2000)
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 1000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false }],
  })
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state,
    transport: t,
  })
  assert(out.result.errors.length === 0, 'happy path: no errors')
  assert(out.nextState.notebooks[nb.id] === 2000, 'happy path: baseline advanced')
  assert(out.nextState.lastSyncAt !== null, 'happy path: lastSyncAt set')
  assert(
    t.files.has('base/notebooks/nb-1.json'),
    'happy path: notebook uploaded to server',
  )
}

{
  const nb = makeNotebook('nb-1', 'Rollback', 2000)
  const t = new FakeTransport()
  t.failManifestWrite = true
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 1000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false }],
  })
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state,
    transport: t,
  })
  assert(out.result.errors.length > 0, 'manifest write fail: errors reported')
  assert(out.nextState.notebooks[nb.id] === 1000, 'manifest write fail: baseline ROLLED BACK')
  assert(out.nextState.lastSyncAt === null, 'manifest write fail: lastSyncAt NOT set')
}

{
  const nb = makeNotebook('nb-1', 'Idempotent', 2000)
  const t = new FakeTransport()
  t.failManifestWrite = true
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 1000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false }],
  })
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const first = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state,
    transport: t,
  })
  const rolledBackState = first.nextState
  t.failManifestWrite = false
  const second = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state: rolledBackState,
    transport: t,
  })
  assert(
    second.result.pushed.length === 1 && second.result.pushed[0] === nb.name,
    'after rollback, next run re-pushes the same notebook (idempotent, no silent pull)',
  )
  assert(second.nextState.notebooks[nb.id] === 2000, 'after rollback, baseline advances on retry')
  assert(second.nextState.lastSyncAt !== null, 'after rollback, lastSyncAt set on retry')
}

{
  // Regression: the manifest lists a notebook whose remote file is MISSING
  // (404). A local copy exists, so the sync must restore it (push) instead of
  // reporting an unrecoverable download error forever.
  const nb = makeNotebook('nb-ghost-local', 'GhostLocal', 2000)
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: false }],
  })
  const state = makeState({ notebooks: { [nb.id]: 2000 } })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state,
    transport: t,
  })
  assert(out.result.errors.length === 0, '404 pull with local copy: no errors reported')
  assert(
    out.result.pushed.includes(nb.name),
    '404 pull with local copy: local copy restored (pushed)',
  )
  assert(
    t.files.has('base/notebooks/nb-ghost-local.json'),
    '404 pull with local copy: file uploaded to server',
  )
  assert(
    out.nextState.notebooks[nb.id] === 2000,
    '404 pull with local copy: baseline advanced to local updatedAt',
  )
  const healedManifest = JSON.parse(t.files.get('base/manifest.json')!) as SyncManifest
  const entry = healedManifest.notebooks.find((n) => n.id === nb.id)
  assert(
    entry !== undefined && entry.updatedAt === 2000 && !entry.deleted,
    '404 pull with local copy: manifest entry now references the restored file',
  )
}

{
  // Regression: the manifest lists a notebook that does NOT exist locally and
  // whose remote file is missing (404). The phantom manifest entry must be
  // pruned so the next sync stops trying to download it.
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: 'nb-ghost-remote', name: 'GhostRemote', updatedAt: 2000, deleted: false }],
  })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state: makeState(),
    transport: t,
  })
  assert(out.result.errors.length === 0, '404 pull without local copy: no errors reported')
  const prunedManifest = JSON.parse(t.files.get('base/manifest.json')!) as SyncManifest
  assert(
    !prunedManifest.notebooks.some((n) => n.id === 'nb-ghost-remote'),
    '404 pull without local copy: phantom manifest entry pruned',
  )
}

{
  const nb = makeNotebook('nb-1', 'Auth', 2000)
  const t = new FakeTransport()
  t.failEnsureDirectory = true
  const state = makeState({ notebooks: { [nb.id]: 1000 } })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state,
    transport: t,
  })
  assert(out.result.errors.length > 0, 'auth fail: errors reported')
  assert(
    out.result.errors[0].toLowerCase().includes('autenticação') ||
      out.result.errors[0].toLowerCase().includes('authentication'),
    'auth fail: message guides the user about credentials',
  )
  assert(out.nextState === state, 'auth fail: sync state untouched (no false advance)')
  assert(out.nextState.lastSyncAt === null, 'auth fail: lastSyncAt NOT set')
}

{
  // Bug A end-to-end: deleting locally ("local + nuvem") sets a tombstone while
  // the remote still lists the notebook (deleted:false). The sync must delete it
  // on the cloud WITHOUT re-downloading it locally (the old bug re-pulled it and
  // turned it into a conflict on the next sync).
  const nb = makeNotebook('nb-del', 'ToDelete', 2000)
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: false }],
  })
  t.files.set(
    'base/notebooks/nb-del.json',
    JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: nb }),
  )
  const state = makeState({ notebooks: { [nb.id]: 3000 }, tombstones: { [nb.id]: 2500 } })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state,
    transport: t,
  })
  assert(out.result.errors.length === 0, 'Bug A runSync: no errors')
  assert(out.result.pulled.length === 0, 'Bug A runSync: NOT pulled back')
  assert(out.result.deleted.includes(nb.name), 'Bug A runSync: remote deleted')
  assert(
    !t.files.has('base/notebooks/nb-del.json'),
    'Bug A runSync: remote notebook file removed',
  )
  assert(
    out.nextState.tombstones[nb.id] === undefined,
    'Bug A runSync: local tombstone cleared after remote deletion',
  )
}

{
  // Restore-from-trash end-to-end: the notebook reappeared locally, its
  // tombstone was cleared (no baseline entry), and the remote manifest marks it
  // deleted. runSync must re-upload it and flip the manifest entry back to
  // deleted:false instead of removing it again.
  const nb = makeNotebook('nb-restore', 'Restored', 2000)
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: nb.id, name: nb.name, updatedAt: 3000, deleted: true }],
  })
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [nb],
    state: makeState(),
    transport: t,
  })
  assert(out.result.errors.length === 0, 'restored-from-trash runSync: no errors')
  assert(out.result.pushed.includes(nb.name), 'restored-from-trash runSync: re-uploaded (push)')
  assert(
    t.files.has('base/notebooks/nb-restore.json'),
    'restored-from-trash runSync: remote notebook file restored',
  )
  const healedManifest = JSON.parse(t.files.get('base/manifest.json')!) as SyncManifest
  const entry = healedManifest.notebooks.find((n) => n.id === nb.id)
  assert(
    entry !== undefined && !entry.deleted,
    'restored-from-trash runSync: manifest entry back to deleted:false',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
