/**
 * Verification script for the v10 -> v11 upgrade of the PDF bitmap fingerprints.
 *
 * Root cause it guards against: v11 keeps a fingerprint next to each bitmap
 * (`pdfHashes`) so a pull can tell "this page is already on the device" without
 * reading a multi-megabyte dataUrl. A database written by v10 has the bitmaps
 * but no fingerprints; if the upgrade did not backfill them lazily, the first
 * sync after updating the app would treat every PDF page as new and download all
 * of them again.
 *
 * This script proves:
 *  1. a v10 database (no `pdfHashes` store) opens at v11 and creates it
 *  2. `getPagePdfHash` backfills the fingerprint from the stored dataUrl and
 *     persists it
 *  3. the next pull skips the page (no `pdfs/<pageId>.png` request) and leaves
 *     it light, because the database already holds the bitmap
 *  4. a page whose manifest hash changed is still downloaded
 *  5. deleting the notebook drops the bitmap and its fingerprint together
 *
 * Run: npx tsx scripts/verify-pdf-hash-upgrade.ts
 */
import 'fake-indexeddb/auto'

import {
  encodePngDataUrl,
  MANIFEST_PATH,
  pdfHash,
  runSync,
  serializeManifest,
} from '../src/utils/sync'
import type { Transport } from '../src/utils/webdav'
import { normalizePage } from '../src/types'
import type { CloudSyncState, Notebook, Page } from '../src/types'

const DB_NAME = 'mamaco-notes'
const BASE = 'base'
const NB = 'nb-v10'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9])
const DATA_URL = encodePngDataUrl(PNG)
const HASH = pdfHash(DATA_URL)

/** A page whose PDF metadata is stored without the bitmap, like v10 persisted it. */
function lightPage(): Page {
  return normalizePage({
    id: 'p1',
    template: 'blank',
    width: 100,
    height: 100,
    pdf: { name: 'doc.pdf', pageNumber: 1 } as Page['pdf'],
    createdAt: 1,
    updatedAt: 1,
  })
}

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

/** Writes a database exactly as v10 left it: bitmaps, no `pdfHashes`. */
function createV10Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 10)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('folders', { keyPath: 'id' })
      d.createObjectStore('notebooks', { keyPath: 'id' })
      d.createObjectStore('settings', { keyPath: 'id' })
      d.createObjectStore('cloudSync', { keyPath: 'id' })
      d.createObjectStore('templates', { keyPath: 'id' })
      d.createObjectStore('trash', { keyPath: 'id' })
      const pages = d.createObjectStore('pages', { keyPath: 'key' })
      pages.createIndex('byNotebook', ['notebookId', 'order'])
      const pdfs = d.createObjectStore('pdfImages', { keyPath: 'pageId' })
      pdfs.createIndex('byNotebook', 'notebookId')
    }
    req.onsuccess = () => {
      const d = req.result
      const t = d.transaction(['notebooks', 'pages', 'pdfImages'], 'readwrite')
      t.objectStore('notebooks').put({
        id: NB,
        name: 'V10',
        folderId: null,
        createdAt: 1000,
        updatedAt: 1000,
        order: 0,
        pageCount: 1,
      })
      t.objectStore('pages').put({ key: `${NB}:p1`, notebookId: NB, order: 0, page: lightPage() })
      t.objectStore('pdfImages').put({ pageId: 'p1', notebookId: NB, dataUrl: DATA_URL })
      t.oncomplete = () => {
        d.close()
        resolve()
      }
      t.onerror = () => reject(t.error)
    }
    req.onerror = () => reject(req.error)
  })
}

class FakeTransport implements Transport {
  files = new Map<string, string>()
  binaries = new Map<string, Uint8Array>()
  downloads: string[] = []

  async ensureDirectory(): Promise<void> {}
  async listDirectory(): Promise<string[]> {
    return []
  }
  async uploadFile(): Promise<void> {}
  async downloadFile(path: string): Promise<string> {
    this.downloads.push(path)
    const text = this.files.get(path)
    if (text === undefined) throw new Error(`missing remote file: ${path}`)
    return text
  }
  async downloadBinaryFile(path: string): Promise<Uint8Array> {
    this.downloads.push(path)
    const bytes = this.binaries.get(path)
    if (!bytes) throw new Error(`missing remote file: ${path}`)
    return bytes
  }
  async deleteRemoteFile(): Promise<void> {}
}

function lightBody(updatedAt: number): Notebook {
  return {
    id: NB,
    name: 'V10',
    folderId: null,
    createdAt: 1000,
    updatedAt,
    pages: [lightPage()],
  }
}

function seedRemote(transport: FakeTransport, updatedAt: number, manifestHash: string): void {
  transport.files.set(
    `${BASE}/${MANIFEST_PATH}`,
    serializeManifest({
      version: 3,
      updatedAt,
      folders: { updatedAt: 0 },
      notebooks: [
        { id: NB, name: 'V10', updatedAt, deleted: false, pdfs: { p1: manifestHash } },
      ],
    }),
  )
  transport.files.set(
    `${BASE}/notebooks/${NB}.json`,
    JSON.stringify({ version: 3, exportedAt: 1, notebook: lightBody(updatedAt) }),
  )
  transport.binaries.set(`${BASE}/pdfs/p1.png`, PNG)
  transport.files.set(`${BASE}/folders/folders.json`, JSON.stringify({ folders: [] }))
}

function makeState(): CloudSyncState {
  return {
    id: 'main',
    lastSyncAt: null,
    foldersHash: 'empty',
    foldersUpdatedAt: 0,
    notebooks: {},
    tombstones: {},
    localOnlyDeleted: {},
  }
}

function rawHashRecord(): Promise<{ pageId: string; hash: string } | undefined> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('pdfHashes')) {
        d.close()
        resolve(undefined)
        return
      }
      const get = d.transaction('pdfHashes', 'readonly').objectStore('pdfHashes').get('p1')
      get.onsuccess = () => {
        d.close()
        resolve(get.result as { pageId: string; hash: string } | undefined)
      }
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  })
}

console.log('== a v10 database upgrades to v11 ==')

await createV10Database()
assert((await rawHashRecord()) === undefined, 'v10: no fingerprint exists yet')

// Imported after the v10 database exists, so `openDb` performs the real upgrade.
const { db } = await import('../src/db')

const backfilled = await db.getPagePdfHash('p1')
assert(backfilled === HASH, 'v11: the fingerprint is backfilled from the stored bitmap')
const persisted = await rawHashRecord()
assert(persisted?.hash === HASH, 'v11: the backfilled fingerprint is persisted in pdfHashes')

console.log('== the next sync skips the page without downloading its PNG ==')

{
  const transport = new FakeTransport()
  seedRemote(transport, 2000, HASH)
  const out = await runSync({
    basePath: BASE,
    folders: [],
    notebooks: [],
    state: makeState(),
    transport,
    getNotebook: async () => undefined,
    getPagePdfHash: (pageId) => db.getPagePdfHash(pageId),
  })
  assert(out.result.errors.length === 0, 'sync after upgrade: no errors')
  assert(
    !transport.downloads.includes(`${BASE}/pdfs/p1.png`),
    'sync after upgrade: the unchanged PNG is not downloaded',
  )
  assert(
    out.pulledNotebooks[0]?.pages[0]?.pdf?.dataUrl === undefined,
    'sync after upgrade: the reused page stays light',
  )

  const changed = new FakeTransport()
  seedRemote(changed, 3000, 'changed-on-the-server')
  const pulled = await runSync({
    basePath: BASE,
    folders: [],
    notebooks: [],
    state: out.nextState,
    transport: changed,
    getNotebook: async () => undefined,
    getPagePdfHash: (pageId) => db.getPagePdfHash(pageId),
  })
  assert(
    changed.downloads.filter((p) => p === `${BASE}/pdfs/p1.png`).length === 1,
    'sync after upgrade: a page whose image changed is still downloaded',
  )
  assert(
    pulled.pulledNotebooks[0]?.pages[0]?.pdf?.dataUrl === DATA_URL,
    'sync after upgrade: the downloaded bitmap is rebuilt byte-for-byte',
  )
}

console.log('== deleting the notebook drops the bitmap and its fingerprint ==')

await db.deleteNotebook(NB)
assert((await db.getPagePdfDataUrl('p1')) === undefined, 'delete: the bitmap is gone')
assert((await rawHashRecord()) === undefined, 'delete: the fingerprint is gone with it')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
