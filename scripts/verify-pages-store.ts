/**
 * Verification script for the per-page persistence store (db v9 -> v10).
 *
 * Root cause it guards against: `notebooksContent` stored every page of a
 * notebook inside one record, so each stroke commit structured-cloned the
 * whole notebook — on a 100+ page PDF notebook the UI froze on pen release.
 * v10 stores one record per page (`key = notebookId:pageId`) and `putNotebook`
 * rewrites only the pages whose content fingerprint changed.
 *
 * This script proves:
 *  1. `putNotebook` writes one record per page
 *  2. an unchanged put writes zero page records (the hot path after a stroke)
 *  3. a single edited page writes exactly one record
 *  4. reordering pages rewrites only the moved pages and `getNotebook` returns
 *     the new order
 *  5. `getFirstPage` returns the first page (with PDF dataUrl rehydrated)
 *  6. removed pages have their record deleted
 *  7. `deleteNotebook` removes every page record of that notebook
 *
 * Run: npx tsx scripts/verify-pages-store.ts
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

// Count page-store writes only; every other store keeps its normal behavior.
const pagePuts = { count: 0 }
const storeProto = IDBObjectStore.prototype as unknown as {
  put: (value: unknown, key?: IDBValidKey) => IDBRequest
}
const originalPut = storeProto.put
storeProto.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
  if (this.name === 'pages') pagePuts.count++
  return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
}

function makePage(id: string, pdf?: { name: string; pageNumber: number; dataUrl: string }) {
  return {
    id,
    template: 'blank',
    width: 1000,
    height: 1400,
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
        strokes: [] as { id: string; kind: string; color: string; size: number; points: number[][] }[],
        images: [],
        texts: [],
      },
    ],
    layerFolders: [],
    activeLayerId: `l-${id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...(pdf ? { pdf } : {}),
  }
}

function withStroke(page: ReturnType<typeof makePage>, strokeId: string) {
  return {
    ...page,
    updatedAt: page.updatedAt + 1,
    layers: [
      {
        ...page.layers[0],
        strokes: [
          ...page.layers[0].strokes,
          { id: strokeId, kind: 'pen', color: '#000', size: 3, points: [[0, 0], [5, 5]] },
        ],
      },
    ],
  }
}

const dataUrl = 'data:image/png;base64,' + 'Z'.repeat(120000)

async function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mamaco-notes')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function pageCount(idb: IDBDatabase, notebookId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = idb
      .transaction('pages', 'readonly')
      .objectStore('pages')
      .index('byNotebook')
      .count(IDBKeyRange.bound([notebookId, -Infinity], [notebookId, Infinity]))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('mamaco-notes')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })

  const { db, closeDb } = await import('../src/db')

  console.log('== putNotebook writes one record per page ==')
  const pages = [makePage('p1', { name: 'a.pdf', pageNumber: 1, dataUrl }), makePage('p2'), makePage('p3')]
  const nb = {
    id: 'nb1',
    name: 'teste',
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages,
  }
  pagePuts.count = 0
  await db.putNotebook(nb as never)
  assert(pagePuts.count === 3, `first put writes 3 page records (got ${pagePuts.count})`)
  const idb = await openRaw()
  assert((await pageCount(idb, 'nb1')) === 3, 'notebook has 3 page records')

  console.log('== unchanged put writes nothing (stroke hot path) ==')
  pagePuts.count = 0
  await db.putNotebook(nb as never)
  assert(pagePuts.count === 0, `unchanged put writes 0 page records (got ${pagePuts.count})`)

  console.log('== editing one page writes exactly one record ==')
  const editedPages = [pages[0], withStroke(pages[1], 's1'), pages[2]]
  const edited = { ...nb, pages: editedPages }
  pagePuts.count = 0
  await db.putNotebook(edited as never)
  assert(pagePuts.count === 1, `single edited page writes 1 record (got ${pagePuts.count})`)
  pagePuts.count = 0
  await db.putNotebook(edited as never)
  assert(pagePuts.count === 0, `re-persisting the same edited pages writes 0 (got ${pagePuts.count})`)

  console.log('== reordering rewrites only the moved pages ==')
  const reordered = { ...edited, pages: [editedPages[1], editedPages[0], editedPages[2]] }
  pagePuts.count = 0
  await db.putNotebook(reordered as never)
  assert(pagePuts.count === 2, `swapping 2 pages writes 2 records (got ${pagePuts.count})`)
  pagePuts.count = 0
  await db.putNotebook(reordered as never)
  assert(pagePuts.count === 0, `stable order writes 0 records (got ${pagePuts.count})`)

  console.log('== getNotebook returns pages in stored order + rehydrated PDF ==')
  const loaded = (await db.getNotebook('nb1'))!
  assert(
    loaded.pages.map((p) => p.id).join(',') === 'p2,p1,p3',
    `page order preserved (got ${loaded.pages.map((p) => p.id).join(',')})`,
  )
  assert(loaded.pages[1].pdf?.dataUrl === dataUrl, 'PDF dataUrl rehydrated')

  console.log('== getFirstPage returns the first page ==')
  const first = (await db.getFirstPage('nb1'))!
  assert(first?.id === 'p2', `getFirstPage returns p2 (got ${first?.id})`)

  console.log('== removed pages have their record deleted ==')
  pagePuts.count = 0
  const withoutP1 = { ...reordered, pages: [editedPages[1], editedPages[2]] }
  await db.putNotebook(withoutP1 as never)
  // p3 shifts from order 2 to order 1; p2 is untouched.
  assert(pagePuts.count === 1, `removing a page rewrites only the shifted page (got ${pagePuts.count})`)
  assert((await pageCount(idb, 'nb1')) === 2, 'removed page record gone')
  assert((await db.getFirstPage('nb1'))?.id === 'p2', 'first page still p2')

  console.log('== deleteNotebook removes every page record ==')
  await db.deleteNotebook('nb1')
  assert((await pageCount(idb, 'nb1')) === 0, 'page records removed with the notebook')

  // ---- Self-healing migration ----
  // The v9 -> v10 split runs after the version upgrade commits, so an app killed
  // in that window leaves a v10 database with unmigrated content records. The
  // next open must still split them instead of showing empty notebooks.
  console.log('== current-version DB with leftover legacy content is migrated on open ==')
  await closeDb()
  idb.close()
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('mamaco-notes')
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('mamaco-notes', 10)
    req.onupgradeneeded = () => {
      const raw = req.result
      if (!raw.objectStoreNames.contains('notebooks')) raw.createObjectStore('notebooks', { keyPath: 'id' })
      if (!raw.objectStoreNames.contains('notebooksContent')) raw.createObjectStore('notebooksContent', { keyPath: 'id' })
      if (!raw.objectStoreNames.contains('pages')) {
        raw.createObjectStore('pages', { keyPath: 'key' }).createIndex('byNotebook', ['notebookId', 'order'])
      }
      if (!raw.objectStoreNames.contains('pdfImages')) {
        raw.createObjectStore('pdfImages', { keyPath: 'pageId' }).createIndex('byNotebook', 'notebookId')
      }
    }
    req.onsuccess = () => {
      const raw = req.result
      const t = raw.transaction(['notebooks', 'notebooksContent'], 'readwrite')
      t.objectStore('notebooks').put({ id: 'legacy-nb', name: 'legado', folderId: null, createdAt: 1, updatedAt: 1, order: 0, pageCount: 2 })
      t.objectStore('notebooksContent').put({ id: 'legacy-nb', pages: [makePage('lg-p1'), makePage('lg-p2')] })
      t.oncomplete = () => {
        raw.close()
        resolve()
      }
      t.onerror = () => reject(t.error)
    }
    req.onerror = () => reject(req.error)
  })
  const healed = (await db.getNotebook('legacy-nb'))!
  assert(healed?.pages.map((p) => p.id).join(',') === 'lg-p1,lg-p2', 'leftover legacy content split into page records')
  const healedDb = await openRaw()
  assert((await pageCount(healedDb, 'legacy-nb')) === 2, 'healed notebook has 2 page records')
  const legacyLeft = await new Promise<number>((resolve, reject) => {
    const req = healedDb.transaction('notebooksContent', 'readonly').objectStore('notebooksContent').count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  assert(legacyLeft === 0, 'legacy content records consumed')
  healedDb.close()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
