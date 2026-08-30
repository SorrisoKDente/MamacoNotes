import type { Folder, Notebook, AppSettings, CloudSyncState, PageTemplate, TrashItem, NotebookSummary, Page } from './types'
import { DEFAULT_SETTINGS, normalizePage } from './types'
import { hashFolders } from './utils/sync'

const DB_NAME = 'mamaco-notes'
const DB_VERSION = 8

let dbPromise: Promise<IDBDatabase> | null = null

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

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    let needsOrderMigration = false
    let needsLayersMigration = false
    let needsMetaContentMigration = false

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
      if (!db.objectStoreNames.contains('notebooksContent')) {
        db.createObjectStore('notebooksContent', { keyPath: 'id' })
      }

      if (oldVersion < 4) needsOrderMigration = true
      if (oldVersion < 5) needsLayersMigration = true
      if (oldVersion < 8) needsMetaContentMigration = true
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
    const content = await tx<{ id: string; pages: Page[] } | undefined>(
      'notebooksContent',
      'readonly',
      (s) => s.get(id),
    )
    return {
      ...meta,
      pages: content?.pages ?? [],
    }
  },
  async getFirstPage(id: string): Promise<Page | undefined> {
    const content = await tx<{ id: string; pages: Page[] } | undefined>(
      'notebooksContent',
      'readonly',
      (s) => s.get(id),
    )
    return content?.pages?.[0]
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
    // We must use a single transaction to ensure consistency
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(['notebooks', 'notebooksContent'], 'readwrite')
      t.objectStore('notebooks').put(summary)
      t.objectStore('notebooksContent').put({ id: notebook.id, pages: notebook.pages })
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    })
  },
  async deleteNotebook(id: string): Promise<void> {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(['notebooks', 'notebooksContent'], 'readwrite')
      t.objectStore('notebooks').delete(id)
      t.objectStore('notebooksContent').delete(id)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
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
