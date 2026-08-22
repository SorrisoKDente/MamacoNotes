import type { Folder, Notebook, AppSettings, CloudSyncState, PageTemplate } from './types'
import { DEFAULT_SETTINGS, normalizePage } from './types'

const DB_NAME = 'mamaco-notes'
const DB_VERSION = 5

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
      const pages = nb.pages.map((p) => normalizePage(p))
      cur.update({ ...nb, pages })
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
    req.onupgradeneeded = () => {
      const db = req.result
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
      needsOrderMigration = true
      needsLayersMigration = true
    }
    req.onsuccess = async () => {
      const db = req.result
      if (needsOrderMigration) {
        try {
          await migrateOrders(db)
        } catch (e) {
          reject(e)
          return
        }
      }
      if (needsLayersMigration) {
        try {
          await migrateLayers(db)
        } catch (e) {
          reject(e)
          return
        }
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
  async getNotebooks(): Promise<Notebook[]> {
    const all = await tx('notebooks', 'readonly', (s) => s.getAll())
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async getNotebook(id: string): Promise<Notebook | undefined> {
    return tx('notebooks', 'readonly', (s) => s.get(id))
  },
  async putNotebook(notebook: Notebook): Promise<void> {
    await txAll('notebooks', 'readwrite', (s) => s.put(notebook))
  },
  async deleteNotebook(id: string): Promise<void> {
    await txAll('notebooks', 'readwrite', (s) => s.delete(id))
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
        foldersHash: '',
        foldersUpdatedAt: 0,
        notebooks: {},
        tombstones: {},
        localOnlyDeleted: {},
      }
    }
    return {
      id: 'main',
      lastSyncAt: stored.lastSyncAt ?? null,
      foldersHash: stored.foldersHash ?? '',
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
}
