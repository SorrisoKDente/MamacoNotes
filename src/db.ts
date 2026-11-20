import type { Folder, Notebook, AppSettings, CloudSyncState, PageTemplate, TrashItem, NotebookSummary, Page, PdfBackground } from './types'
import { DEFAULT_SETTINGS, normalizePage } from './types'
import { hashFolders } from './utils/sync'

const DB_NAME = 'mamaco-notes'
const DB_VERSION = 10

let dbPromise: Promise<IDBDatabase> | null = null

interface PdfImageRecord {
  pageId: string
  notebookId: string
  dataUrl: string
}

/**
 * One record per page (v10). Keyed by `notebookId:pageId` so a page can be
 * rewritten without touching the other pages of the notebook, and indexed by
 * `[notebookId, order]` so loading a notebook returns its pages already in
 * order.
 */
interface PageRecord {
  key: string
  notebookId: string
  order: number
  page: Page
}

function pageKey(notebookId: string, pageId: string): string {
  return `${notebookId}:${pageId}`
}

/**
 * Cheap fingerprint of a page's persisted content. Writing a page only when
 * its stamp changed is what makes a stroke commit cost O(1) page writes
 * instead of re-cloning every page of the notebook.
 *
 * Every page mutation in the app bumps `page.updatedAt` (Editor, store page and
 * layer actions, background color modal), so the timestamp is the primary
 * discriminator; the structural fields are a second line of defense for edits
 * that land in the same millisecond as the previous write (layer toggles,
 * undo/redo restoring an older snapshot). Point counts catch drawing changes
 * without serializing the page.
 */
function pageStamp(page: Page): string {
  let sig = `${page.updatedAt}|${page.rotation}|${page.width}x${page.height}|${page.backgroundColor}|${page.template}|${page.activeLayerId ?? ''}`
  for (const layer of page.layers ?? []) {
    let points = 0
    for (const stroke of layer.strokes) points += stroke.points.length
    sig += `#${layer.id},${layer.name},${layer.visible ? 1 : 0},${layer.opacity},${layer.locked ? 1 : 0},${layer.folderId ?? ''},${layer.strokes.length},${layer.images.length},${layer.texts.length},${points},${layer.strokeErasures?.length ?? 0}`
  }
  return sig
}

/**
 * In-memory mirror of what is already persisted in `pages`:
 * pageId -> { stamp, order }. Populated when a notebook is loaded and kept in
 * sync by `putNotebook`/`deleteNotebook` (only once their transaction commits),
 * so a page that did not change is never rewritten. A page missing from the
 * mirror is always written — the mirror can only make writes cheaper, never
 * hide an unknown page.
 */
const knownPageState = new Map<string, { stamp: string; order: number }>()

/**
 * In-memory cache of which PDF backgrounds are already persisted in the
 * `pdfImages` object store, keyed by pageId -> dataUrl length. It lets
 * `putNotebook` skip re-cloning the heavy base64 blobs into IndexedDB on
 * every notebook write (the hot path for stroke commits). Populated when a
 * notebook is loaded/rehydrated and during the DB migration. A page whose
 * dataUrl changes to a different length re-writes the blob; a same-length
 * change is an accepted edge case (pdf backgrounds are set once at import).
 */
const knownPdfLength = new Map<string, number>()

function stripPdfDataUrl(pdf: { name: string; pageNumber: number }): Omit<PdfBackground, 'dataUrl'> {
  return { name: pdf.name, pageNumber: pdf.pageNumber }
}

function hasPdfWithoutDataUrl(pages: Page[]): boolean {
  return pages.some((p) => p.pdf && !p.pdf.dataUrl)
}

function fillMissingOrder(
  store: IDBObjectStore,
  groupKey: (r: Record<string, unknown>) => string | null,
  sortFn: (a: Record<string, unknown>, b: Record<string, unknown>) => number,
) {
  const all = store.getAll()
  all.onsuccess = () => {
    const rows = all.result as Record<string, unknown>[]
    const groups = new Map<string, Record<string, unknown>[]>()
    for (const r of rows) {
      const k = groupKey(r) ?? ''
      const arr = groups.get(k)
      if (arr) arr.push(r)
      else groups.set(k, [r])
    }
    for (const arr of groups.values()) {
      const anyOrder = arr.some((r) => typeof r.order === 'number')
      arr.sort(sortFn)
      if (!anyOrder) {
        arr.forEach((r, i) => store.put({ ...r, order: i }))
      } else {
        let max = -1
        for (const r of arr) {
          if (typeof r.order === 'number' && (r.order as number) > max) {
            max = r.order as number
          }
        }
        let next = max + 1
        for (const r of arr) {
          if (typeof r.order !== 'number') store.put({ ...r, order: next++ })
        }
      }
    }
  }
}

function migrateOrders(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['folders', 'notebooks'], 'readwrite')
    fillMissingOrder(
      tx.objectStore('folders'),
      (r) => (r.parentId as string | null) ?? null,
      (a, b) => ((a.createdAt as number) ?? 0) - ((b.createdAt as number) ?? 0),
    )
    fillMissingOrder(
      tx.objectStore('notebooks'),
      (r) => (r.folderId as string | null) ?? null,
      (a, b) => ((b.updatedAt as number) ?? 0) - ((a.updatedAt as number) ?? 0),
    )
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function migrateLayers(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notebooks'], 'readwrite')
    const store = tx.objectStore('notebooks')
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const cur = cursor.result
      if (!cur) return
      const nb = cur.value as Notebook
      if (nb.pages && Array.isArray(nb.pages)) {
        const pages = nb.pages.map((p) => normalizePage(p))
        cur.update({ ...nb, pages })
      }
      cur.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Migration 8 -> 9: extract the heavy PDF background dataUrls out of the
 * `notebooksContent` records into the new `pdfImages` object store. After this
 * migration the content records only hold light pages (pdf without dataUrl),
 * so per-stroke notebook writes no longer re-serialize every PDF page image.
 * Idempotent: pages without pdf (or already without dataUrl) are untouched.
 */
function migratePdfImages(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notebooksContent', 'pdfImages'], 'readwrite')
    const contentStore = tx.objectStore('notebooksContent')
    const pdfStore = tx.objectStore('pdfImages')
    const cursor = contentStore.openCursor()
    cursor.onsuccess = () => {
      const cur = cursor.result
      if (!cur) return
      const record = cur.value as { id: string; pages: Page[] }
      if (record.pages && Array.isArray(record.pages)) {
        let changed = false
        const pages = record.pages.map((p) => {
          if (p.pdf && p.pdf.dataUrl) {
            pdfStore.put({ pageId: p.id, notebookId: record.id, dataUrl: p.pdf.dataUrl })
            changed = true
            return { ...p, pdf: stripPdfDataUrl(p.pdf) as Page['pdf'] }
          }
          return p
        })
        if (changed) cur.update({ ...record, pages })
      }
      cur.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function migrateToMetaContent(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notebooks', 'notebooksContent'], 'readwrite')
    const nbStore = tx.objectStore('notebooks')
    const contentStore = tx.objectStore('notebooksContent')
    const cursor = nbStore.openCursor()
    cursor.onsuccess = () => {
      const cur = cursor.result
      if (!cur) return
      const nb = cur.value as Notebook
      if (nb.pages) {
        // Save pages to content store
        contentStore.put({ id: nb.id, pages: nb.pages })
        // Save summary back to notebooks store
        const summary: NotebookSummary = {
          id: nb.id,
          name: nb.name,
          folderId: nb.folderId,
          createdAt: nb.createdAt,
          updatedAt: nb.updatedAt,
          order: nb.order,
          pageCount: nb.pages.length,
          favorite: (nb as any).favorite ?? false,
        }
        cur.update(summary)
      } else if (!(nb as any).pageCount) {
        // Fallback for unexpected state: ensure it has at least a pageCount
        const summary: NotebookSummary = {
          id: nb.id,
          name: nb.name,
          folderId: nb.folderId,
          createdAt: nb.createdAt,
          updatedAt: nb.updatedAt,
          order: nb.order,
          pageCount: 0,
          favorite: (nb as any).favorite ?? false,
        }
        cur.update(summary)
      }
      cur.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Migration 9 -> 10: split each per-notebook `notebooksContent` record into one
 * `pages` record per page. The content record is removed in the same atomic
 * transaction, so the legacy store ends up empty and the page JSON is never
 * duplicated; an aborted transaction rolls everything back. Idempotent: pages
 * already migrated are written again with the same values, orphans stay gone.
 */
function migratePages(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['notebooksContent', 'pages'], 'readwrite')
    const contentStore = tx.objectStore('notebooksContent')
    const pageStore = tx.objectStore('pages')
    const cursor = contentStore.openCursor()
    cursor.onsuccess = () => {
      const cur = cursor.result
      if (!cur) return
      const record = cur.value as { id: string; pages?: Page[] }
      const pages = record.pages ?? []
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]
        pageStore.put({ key: pageKey(record.id, page.id), notebookId: record.id, order: i, page })
      }
      cur.delete()
      cur.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Number of pre-v10 `notebooksContent` records still waiting to be split into
 * `pages`. Checked on every open — not only while upgrading — because the
 * migrations run after the version upgrade commits: an app killed in that
 * window would otherwise leave the legacy records behind forever and every
 * notebook would load with zero pages.
 */
function countLegacyContent(db: IDBDatabase): Promise<number> {
  if (!db.objectStoreNames.contains('notebooksContent')) return Promise.resolve(0)
  return new Promise((resolve, reject) => {
    const t = db.transaction('notebooksContent', 'readonly')
    const req = t.objectStore('notebooksContent').count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let needsOrderMigration = false
    let needsLayersMigration = false
    let needsMetaContentMigration = false
    let needsPdfImagesMigration = false

    req.onupgradeneeded = (e) => {
      const db = req.result
      const oldVersion = e.oldVersion

      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('notebooks')) {
        db.createObjectStore('notebooks', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('cloudSync')) {
        db.createObjectStore('cloudSync', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('trash')) {
        db.createObjectStore('trash', { keyPath: 'id' })
      }
      // Legacy pre-v10 content store. Only old databases still carry it; it is
      // migrated into `pages` and emptied by `migratePages`.
      if (oldVersion > 0 && oldVersion < 8 && !db.objectStoreNames.contains('notebooksContent')) {
        db.createObjectStore('notebooksContent', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('pages')) {
        const pageStore = db.createObjectStore('pages', { keyPath: 'key' })
        pageStore.createIndex('byNotebook', ['notebookId', 'order'])
      }
      if (!db.objectStoreNames.contains('pdfImages')) {
        const pdfStore = db.createObjectStore('pdfImages', { keyPath: 'pageId' })
        pdfStore.createIndex('byNotebook', 'notebookId')
      }

      if (oldVersion > 0) {
        if (oldVersion < 4) needsOrderMigration = true
        if (oldVersion < 5) needsLayersMigration = true
        if (oldVersion < 8) needsMetaContentMigration = true
        if (oldVersion < 9) needsPdfImagesMigration = true
      }
    }

    req.onsuccess = async () => {
      const db = req.result

      // Run migrations in chronological order
      try {
        if (needsOrderMigration) {
          await migrateOrders(db)
        }
        if (needsLayersMigration) {
          await migrateLayers(db)
        }
        if (needsMetaContentMigration) {
          await migrateToMetaContent(db)
        }
        if (needsPdfImagesMigration) {
          await migratePdfImages(db)
        }
        // Runs for a fresh v10 database too (no legacy store -> 0 records) and
        // self-heals a migration interrupted after the upgrade committed.
        if ((await countLegacyContent(db)) > 0) {
          await migratePages(db)
        }
      } catch (e) {
        console.error('Database migration failed', e)
        reject(e)
        return
      }

      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/**
 * Closes the cached IndexedDB connection and clears the module's promise so a
 * subsequent `openDb()` reconnects. Used by tests that rebuild the database
 * from an older version (e.g. verifying the page-store migrations), and could
 * be used on app logout.
 */
export async function closeDb(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

function txAll(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }),
  )
}

/**
 * Restores the `page.pdf.dataUrl` of light pages (pdf persisted without the
 * heavy dataUrl) from the `pdfImages` object store. Used when loading a
 * notebook from IndexedDB, so in-memory pages behave exactly as before.
 */
async function rehydratePdfPages(notebookId: string, pages: Page[]): Promise<Page[]> {
  if (!hasPdfWithoutDataUrl(pages)) return pages
  const db = await openDb()
  const records = await new Promise<PdfImageRecord[]>((resolve, reject) => {
    const t = db.transaction('pdfImages', 'readonly')
    const req = t.objectStore('pdfImages').index('byNotebook').getAll(IDBKeyRange.only(notebookId))
    req.onsuccess = () => resolve(req.result as PdfImageRecord[])
    req.onerror = () => reject(req.error)
  })
  const byPage = new Map(records.map((r) => [r.pageId, r.dataUrl]))
  for (const [pageId, dataUrl] of byPage) knownPdfLength.set(pageId, dataUrl.length)
  return pages.map((p) => {
    if (!p.pdf || p.pdf.dataUrl) return p
    const dataUrl = byPage.get(p.id)
    if (!dataUrl) return p
    return { ...p, pdf: { ...p.pdf, dataUrl } }
  })
}

async function readPageRecords(notebookId: string): Promise<PageRecord[]> {
  const db = await openDb()
  return new Promise<PageRecord[]>((resolve, reject) => {
    const t = db.transaction('pages', 'readonly')
    const req = t
      .objectStore('pages')
      .index('byNotebook')
      .getAll(IDBKeyRange.bound([notebookId, -Infinity], [notebookId, Infinity]))
    req.onsuccess = () => resolve(req.result as PageRecord[])
    req.onerror = () => reject(req.error)
  })
}

export const db = {
  async getFolders(): Promise<Folder[]> {
    const all = await tx('folders', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => a.createdAt - b.createdAt)
  },
  async putFolder(folder: Folder): Promise<void> {
    await txAll('folders', 'readwrite', (s) => s.put(folder))
  },
  async deleteFolder(id: string): Promise<void> {
    await txAll('folders', 'readwrite', (s) => s.delete(id))
  },
  async getNotebookSummaries(): Promise<NotebookSummary[]> {
    const all = await tx('notebooks', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async getNotebook(id: string): Promise<Notebook | undefined> {
    const meta = await tx<NotebookSummary | undefined>('notebooks', 'readonly', (s) => s.get(id))
    if (!meta) return undefined
    const records = await readPageRecords(id)
    for (const record of records) {
      knownPageState.set(record.page.id, { stamp: pageStamp(record.page), order: record.order })
    }
    const pages = await rehydratePdfPages(id, records.map((r) => r.page))
    return {
      ...meta,
      pages,
    }
  },
  async getFirstPage(id: string): Promise<Page | undefined> {
    const db = await openDb()
    const first = await new Promise<PageRecord | undefined>((resolve, reject) => {
      const t = db.transaction('pages', 'readonly')
      // The `byNotebook` index is [notebookId, order], so the first cursor hit
      // is the first page — the rest of the notebook is never deserialized.
      const req = t
        .objectStore('pages')
        .index('byNotebook')
        .openCursor(IDBKeyRange.bound([id, -Infinity], [id, Infinity]))
      req.onsuccess = () => resolve(req.result?.value as PageRecord | undefined)
      req.onerror = () => reject(req.error)
    })
    const page = first?.page
    if (!page) return undefined
    if (page.pdf && !page.pdf.dataUrl) {
      const rec = await tx<PdfImageRecord | undefined>('pdfImages', 'readonly', (s) => s.get(page.id))
      if (rec) {
        knownPdfLength.set(page.id, rec.dataUrl.length)
        return { ...page, pdf: { ...page.pdf, dataUrl: rec.dataUrl } }
      }
    }
    return page
  },
  async putNotebook(notebook: Notebook): Promise<void> {
    const summary: NotebookSummary = {
      id: notebook.id,
      name: notebook.name,
      folderId: notebook.folderId,
      createdAt: notebook.createdAt,
      updatedAt: notebook.updatedAt,
      order: notebook.order,
      pageCount: notebook.pages.length,
      favorite: notebook.favorite,
    }
    // PDF backgrounds are stored separately (see `pdfImages`) so a per-stroke
    // write never re-serializes the heavy dataUrls. Page records keep only
    // "light" pages (pdf without dataUrl).
    const lightPages = notebook.pages.map((p) => {
      if (!p.pdf || !p.pdf.dataUrl) return p
      return { ...p, pdf: stripPdfDataUrl(p.pdf) as Page['pdf'] }
    })
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(['notebooks', 'pages', 'pdfImages'], 'readwrite')
      t.objectStore('notebooks').put(summary)
      const pageStore = t.objectStore('pages')
      const pdfStore = t.objectStore('pdfImages')
      // Detect new/deleted pages and which pages actually changed from the
      // persisted records. Only those are rewritten, so committing a stroke on
      // a 100-page notebook costs one page write instead of a whole-notebook
      // structured clone.
      const keysReq = pageStore
        .index('byNotebook')
        .getAllKeys(IDBKeyRange.bound([notebook.id, -Infinity], [notebook.id, Infinity]))
      keysReq.onsuccess = () => {
        // Keys of the records currently persisted for this notebook. Whatever
        // is left once the incoming pages are consumed belongs to deleted
        // pages and is removed below.
        const staleKeys = new Set(keysReq.result as string[])
        const written: { id: string; stamp: string; order: number }[] = []
        for (let i = 0; i < lightPages.length; i++) {
          const page = lightPages[i]
          const key = pageKey(notebook.id, page.id)
          staleKeys.delete(key)
          const stamp = pageStamp(page)
          const known = knownPageState.get(page.id)
          if (known && known.stamp === stamp && known.order === i) continue
          pageStore.put({ key, notebookId: notebook.id, order: i, page })
          written.push({ id: page.id, stamp, order: i })
        }
        const droppedPageIds: string[] = []
        for (const key of staleKeys) {
          pageStore.delete(key)
          droppedPageIds.push(key.slice(notebook.id.length + 1))
        }
        for (const id of droppedPageIds) pdfStore.delete(id)
        const pdfWrites: { id: string; length: number }[] = []
        for (const p of notebook.pages) {
          if (!p.pdf || !p.pdf.dataUrl) continue
          const length = p.pdf.dataUrl.length
          if (knownPdfLength.get(p.id) === length) continue
          pdfStore.put({ pageId: p.id, notebookId: notebook.id, dataUrl: p.pdf.dataUrl })
          pdfWrites.push({ id: p.id, length })
        }
        // The caches only claim what the transaction actually committed.
        t.oncomplete = () => {
          for (const entry of written) {
            knownPageState.set(entry.id, { stamp: entry.stamp, order: entry.order })
          }
          for (const entry of pdfWrites) knownPdfLength.set(entry.id, entry.length)
          for (const id of droppedPageIds) {
            knownPageState.delete(id)
            knownPdfLength.delete(id)
          }
          resolve()
        }
      }
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  },
  async deleteNotebook(id: string): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(['notebooks', 'pages', 'pdfImages'], 'readwrite')
      t.objectStore('notebooks').delete(id)
      const range = IDBKeyRange.bound([id, -Infinity], [id, Infinity])
      const pageStore = t.objectStore('pages')
      const pageCursor = pageStore.index('byNotebook').openCursor(range)
      const droppedPageIds: string[] = []
      pageCursor.onsuccess = () => {
        const cur = pageCursor.result
        if (!cur) return
        droppedPageIds.push((cur.value as PageRecord).page.id)
        cur.delete()
        cur.continue()
      }
      const pdfStore = t.objectStore('pdfImages')
      const pdfCursor = pdfStore.index('byNotebook').openCursor(IDBKeyRange.only(id))
      pdfCursor.onsuccess = () => {
        const cur = pdfCursor.result
        if (!cur) return
        knownPdfLength.delete(cur.value.pageId)
        cur.delete()
        cur.continue()
      }
      t.oncomplete = () => {
        for (const pageId of droppedPageIds) knownPageState.delete(pageId)
        resolve()
      }
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  },
  async updateNotebookMeta(summary: NotebookSummary): Promise<void> {
    await txAll('notebooks', 'readwrite', (s) => s.put(summary))
  },
  async getSettings(): Promise<AppSettings> {
    const stored = await tx<AppSettings | undefined>('settings', 'readonly', (s) =>
      s.get('main'),
    )
    if (!stored) return DEFAULT_SETTINGS
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      cloud: { ...DEFAULT_SETTINGS.cloud, ...(stored.cloud ?? {}) },
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(stored.shortcuts ?? {}) },
    }
  },
  async putSettings(settings: AppSettings): Promise<void> {
    await txAll('settings', 'readwrite', (s) => s.put({ id: 'main', ...settings }))
  },
  async getCloudSyncState(): Promise<CloudSyncState> {
    const stored = await tx<CloudSyncState | undefined>('cloudSync', 'readonly', (s) =>
      s.get('main'),
    )
    if (!stored) {
      return {
        id: 'main',
        lastSyncAt: null,
        foldersHash: hashFolders([]),
        foldersUpdatedAt: 0,
        notebooks: {},
        tombstones: {},
        localOnlyDeleted: {},
      }
    }
    return {
      id: 'main',
      lastSyncAt: stored.lastSyncAt ?? null,
      foldersHash: stored.foldersHash ? stored.foldersHash : hashFolders([]),
      foldersUpdatedAt: stored.foldersUpdatedAt ?? 0,
      notebooks: stored.notebooks ?? {},
      tombstones: stored.tombstones ?? {},
      localOnlyDeleted: stored.localOnlyDeleted ?? {},
    }
  },
  async putCloudSyncState(state: CloudSyncState): Promise<void> {
    await txAll('cloudSync', 'readwrite', (s) => s.put({ ...state, id: 'main' }))
  },
  async getTemplates(): Promise<PageTemplate[]> {
    const all = await tx('templates', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.createdAt - a.createdAt)
  },
  async putTemplate(template: PageTemplate): Promise<void> {
    await txAll('templates', 'readwrite', (s) => s.put(template))
  },
  async deleteTemplate(id: string): Promise<void> {
    await txAll('templates', 'readwrite', (s) => s.delete(id))
  },
  async getTrash(): Promise<TrashItem[]> {
    const all = await tx('trash', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.deletedAt - a.deletedAt)
  },
  async putTrashItem(item: TrashItem): Promise<void> {
    await txAll('trash', 'readwrite', (s) => s.put(item))
  },
  async deleteTrashItem(id: string): Promise<void> {
    await txAll('trash', 'readwrite', (s) => s.delete(id))
  },
}
