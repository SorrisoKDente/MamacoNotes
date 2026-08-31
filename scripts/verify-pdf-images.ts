/**
 * Verification script for the PDF-background persistence split (db v8 -> v9).
 *
 * Root cause it guards against: `putNotebook` used to structured-clone the
 * ENTIRE notebook — including every full-resolution PDF page image embedded as
 * a base64 `dataUrl` — into IndexedDB on every stroke commit, freezing the UI
 * for notebooks with many PDF pages. The fix moves those immutable blobs to a
 * dedicated `pdfImages` object store and persists only "light" pages (pdf
 * without dataUrl) in `notebooksContent`, so per-stroke writes stay small.
 *
 * This script proves:
 *  1. `putNotebook` writes light pages + extracts the blobs into `pdfImages`
 *  2. `getNotebook` rehydrates the `dataUrl` so in-memory pages are unchanged
 *  3. a second put (simulating the hot path after a stroke) keeps pdfImages
 *     intact and the content record light (no re-clone of the big strings)
 *  4. removing a page cleans its orphaned blob from `pdfImages`
 *  5. `deleteNotebook` removes the notebook's blobs from `pdfImages`
 *  6. migrating a v8 database (full pages embedded) to v9 extracts the blobs
 *     and rewrites the content record to light
 *
 * Run: npx tsx scripts/verify-pdf-images.ts
 */
import 'fake-indexeddb/auto'

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

function makePage(id: string, dataUrl: string | undefined): Record<string, unknown> {
  return {
    id,
    template: 'blank',
    width: 2480,
    height: 3508,
    rotation: 0,
    backgroundColor: '#ffffff',
    layers: [
      {
        id: `l-${id}`,
        name: 'Camada 1',
        visible: true,
        opacity: 1,
        locked: false,
        folderId: null,
        strokes: [],
        images: [],
        texts: [],
      },
    ],
    layerFolders: [],
    activeLayerId: `l-${id}`,
    updatedAt: Date.now(),
    createdAt: Date.now(),
    ...(dataUrl ? { pdf: { dataUrl, name: 'teste.pdf', pageNumber: 1 } } : {}),
  }
}

async function countPdfImages(db: IDBDatabase): Promise<number> {
  const recs = await new Promise<PdfImageRecord[]>((resolve, reject) => {
    const t = db.transaction('pdfImages', 'readonly')
    const req = t.objectStore('pdfImages').getAll()
    req.onsuccess = () => resolve(req.result as PdfImageRecord[])
    req.onerror = () => reject(req.error)
  })
  return recs.length
}

interface PdfImageRecord {
  pageId: string
  notebookId: string
  dataUrl: string
}

interface LightContent {
  id: string
  pages: { id: string; pdf?: { name: string; pageNumber: number; dataUrl?: string } }[]
}

async function readLightContent(db: IDBDatabase, id: string): Promise<LightContent | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('notebooksContent', 'readonly')
    const req = t.objectStore('notebooksContent').get(id)
    req.onsuccess = () => resolve(req.result as LightContent | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function readPdfImage(db: IDBDatabase, pageId: string): Promise<PdfImageRecord | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction('pdfImages', 'readonly')
    const req = t.objectStore('pdfImages').get(pageId)
    req.onsuccess = () => resolve(req.result as PdfImageRecord | undefined)
    req.onerror = () => reject(req.error)
  })
}

const dataUrlA = 'data:image/png;base64,' + 'A'.repeat(200000)
const dataUrlB = 'data:image/png;base64,' + 'B'.repeat(150000)

function summary(id: string, pageCount: number) {
  return {
    id,
    name: 'teste',
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: 0,
    pageCount,
  }
}

async function main(): Promise<void> {
  // Clean start for this test run.
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('mamaco-notes')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })

  const { db, closeDb } = await import('../src/db')

  console.log('== putNotebook writes light content + extracts blobs ==')
  const nb = {
    id: 'nb1',
    name: 'teste',
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: [makePage('p1', dataUrlA), makePage('p2', dataUrlB), makePage('p3', undefined)],
  }
  await db.putNotebook(nb as never)

  const idb = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('mamaco-notes')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

  const light = (await readLightContent(idb, 'nb1'))!
  assert(light.pages.length === 3, 'content record has 3 pages')
  assert(!light.pages[0].pdf?.dataUrl && light.pages[0].pdf?.name === 'teste.pdf', 'page 1 pdf is light (no dataUrl)')
  assert(!light.pages[1].pdf?.dataUrl && light.pages[1].pdf?.pageNumber === 1, 'page 2 pdf is light (no dataUrl)')
  assert(light.pages[2].pdf === undefined, 'page without pdf stays without pdf')
  assert((await countPdfImages(idb)) === 2, 'pdfImages has exactly 2 blobs')

  const img1 = (await readPdfImage(idb, 'p1'))!
  const img2 = (await readPdfImage(idb, 'p2'))!
  assert(img1.dataUrl === dataUrlA, 'pdfImages p1 holds the exact dataUrl')
  assert(img2.dataUrl === dataUrlB, 'pdfImages p2 holds the exact dataUrl')

  console.log('== getNotebook rehydrates dataUrl ==')
  const loaded = (await db.getNotebook('nb1'))!
  assert(loaded.pages.length === 3, 'getNotebook returns all pages')
  assert(loaded.pages[0].pdf?.dataUrl === dataUrlA, 'page 1 dataUrl rehydrated')
  assert(loaded.pages[1].pdf?.dataUrl === dataUrlB, 'page 2 dataUrl rehydrated')
  assert(loaded.pages[2].pdf === undefined, 'page without pdf unaffected')

  console.log('== second put (hot path) does not lose blobs, keeps content light ==')
  const nbAfterStroke = {
    ...nb,
    pages: [
      makePage('p1', dataUrlA),
      makePage('p2', dataUrlB),
      makePage('p3', undefined),
    ],
  }
  await db.putNotebook(nbAfterStroke as never)
  assert((await countPdfImages(idb)) === 2, 'pdfImages still has 2 blobs after second put')
  const light2 = (await readLightContent(idb, 'nb1'))!
  assert(!light2.pages[0].pdf?.dataUrl, 'content record still light after second put')
  assert((await readPdfImage(idb, 'p1'))!.dataUrl === dataUrlA, 'blob p1 intact after second put')

  console.log('== removing a page cleans its orphaned blob ==')
  const nbWithoutPage2 = {
    ...nb,
    pages: [makePage('p1', dataUrlA), makePage('p3', undefined)],
  }
  await db.putNotebook(nbWithoutPage2 as never)
  assert((await countPdfImages(idb)) === 1, 'p2 blob removed from pdfImages')
  assert((await readPdfImage(idb, 'p2')) === undefined, 'orphaned p2 blob gone')

  console.log('== deleteNotebook cleans blobs ==')
  await db.deleteNotebook('nb1')
  assert((await countPdfImages(idb)) === 0, 'pdfImages empty after notebook deletion')
  assert((await readLightContent(idb, 'nb1')) === undefined, 'content record removed')

  console.log('\nAll pdfImages checks done — migration scenario below.\n')

  // ---- Migration v8 -> v9 ----
  // Build a fresh v8 database that already contains full pages (pdf with
  // dataUrl) inside notebooksContent, as pre-upgrade installs would.
  // The db module's v9 connection must be closed first, otherwise the
  // deleteDatabase below is blocked and open(name, 8) would never succeed.
  await closeDb()
  idb.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('mamaco-notes')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('mamaco-notes', 8)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('notebooksContent')) db.createObjectStore('notebooksContent', { keyPath: 'id' })
    }
    req.onsuccess = () => {
      const db = req.result
      const t = db.transaction(['notebooks', 'notebooksContent'], 'readwrite')
      t.objectStore('notebooks').put(summary('old-nb', 1))
      t.objectStore('notebooksContent').put({ id: 'old-nb', pages: [makePage('old-p1', dataUrlA)] })
      t.oncomplete = () => {
        db.close()
        resolve()
      }
      t.onerror = () => reject(t.error)
    }
    req.onerror = () => reject(req.error)
  })

  // Reopen at v9 via the db module: with the connection reset by closeDb(), the
  // next openDb() reconnects and runs the 8 -> 9 migration, extracting the blob.
  const migrated = (await db.getNotebook('old-nb'))!
  assert(migrated.pages[0].pdf?.dataUrl === dataUrlA, 'v8 -> v9 migration rehydrates the old dataUrl')
  const idb9 = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('mamaco-notes')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const migratedLight = (await readLightContent(idb9, 'old-nb'))!
  assert(!migratedLight.pages[0].pdf?.dataUrl, 'v8 -> v9 migration rewrote content to light')
  assert((await readPdfImage(idb9, 'old-p1'))!.dataUrl === dataUrlA, 'v8 -> v9 migration stored the blob in pdfImages')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
