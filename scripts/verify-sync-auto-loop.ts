/**
 * Regression verification for the sync LOOP (store level).
 *
 * A device that finished a sync and immediately started another one was caught
 * in the store's auto-sync subscriber: `applySyncChanges`/the PDF repair bumped
 * `dataVersion` from inside the run, the subscriber saw a "local change" and
 * queued another sync, which the `finally` restarted back to back.
 *
 * This script drives the REAL `syncNow`/subscriber against a local WebDAV stub
 * (no production seam) and proves:
 *  1. a sync that pulls and applies content logs `nextSyncScheduled: false` and
 *     starts no second run (content applied by the sync is not a local edit)
 *  2. a local edit made while a sync is in flight is NOT pushed by that run: it
 *     is queued and left to the debounced auto-sync (`nextSyncScheduled: true`),
 *     so the run is never restarted recursively
 *  3. every run records why it started and how many pulls/repairs it applied
 *
 * Run: npx tsx scripts/verify-sync-auto-loop.ts
 */
import 'fake-indexeddb/auto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { db } from '../src/db'
import { useAppStore } from '../src/store'
import { logger } from '../src/utils/logger'
import { parseManifest, serializeManifest, MANIFEST_PATH, NOTEBOOK_FORMAT_VERSION } from '../src/utils/sync'
import { DEFAULT_SETTINGS, makeNotebook, makePage } from '../src/types'
import type { Notebook } from '../src/types'

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Minimal in-memory WebDAV server: MKCOL/PROPFIND/GET/PUT/DELETE is all `sync`
 * needs against a plain WebDAV endpoint. `manifestLatencyMs` holds the manifest
 * response so a test can make a local edit while the run is in flight.
 */
interface WebdavStub {
  url: string
  requests: string[]
  manifestLatencyMs: number
  put(path: string, text: string): void
  read(path: string): string | undefined
  stop(): void
}

async function startWebdavStub(files: Record<string, string>): Promise<WebdavStub> {
  const store = new Map<string, Uint8Array>()
  for (const [path, text] of Object.entries(files)) {
    store.set(path, new TextEncoder().encode(text))
  }
  const stub: WebdavStub = {
    url: '',
    requests: [],
    manifestLatencyMs: 0,
    put(path, text) {
      store.set(path, new TextEncoder().encode(text))
    },
    read(path) {
      const bytes = store.get(path)
      return bytes ? new TextDecoder().decode(bytes) : undefined
    },
    stop() {
      server.closeAllConnections()
      server.close()
    },
  }

  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      .replace(/^\/+/, '')
    stub.requests.push(`${req.method} ${path}`)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks)

    if (req.method === 'MKCOL') {
      res.writeHead(201).end()
      return
    }
    if (req.method === 'PROPFIND') {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const names = [...store.keys()]
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length))
        .filter((name) => name.length > 0 && !name.includes('/'))
      const xml =
        '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
        names.map((name) => `<d:response><d:displayname>${name}</d:displayname></d:response>`).join('') +
        '</d:multistatus>'
      res.writeHead(207, { 'Content-Type': 'application/xml' }).end(xml)
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path.endsWith(`/${MANIFEST_PATH}`) && stub.manifestLatencyMs > 0) {
        await delay(stub.manifestLatencyMs)
      }
      const file = store.get(path)
      if (!file) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, {
        'Content-Type': path.endsWith('.json') ? 'application/json' : 'image/png',
        'Content-Length': String(file.length),
      })
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(file))
      return
    }
    if (req.method === 'PUT') {
      store.set(path, new Uint8Array(body))
      res.writeHead(201).end()
      return
    }
    if (req.method === 'DELETE') {
      store.delete(path)
      res.writeHead(204).end()
      return
    }
    res.writeHead(405).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return stub
}

function notebookFile(nb: Notebook): string {
  return JSON.stringify({ version: NOTEBOOK_FORMAT_VERSION, exportedAt: 1, notebook: nb })
}

function remoteNotebook(id: string, name: string, updatedAt: number): Notebook {
  return {
    id,
    name,
    folderId: null,
    createdAt: updatedAt,
    updatedAt,
    order: 0,
    pages: [makePage('blank')],
  }
}

/** The last log `details` for a message prefix (logs are JSON in the Logs tab). */
function lastDetails(prefix: string): Record<string, any> | null {
  const entries = logger.getLogs().filter((entry) => entry.message.startsWith(prefix))
  const last = entries[entries.length - 1]
  if (!last?.details) return null
  try {
    return JSON.parse(last.details) as Record<string, any>
  } catch {
    return null
  }
}

function countLogs(prefix: string): number {
  return logger.getLogs().filter((entry) => entry.message.startsWith(prefix)).length
}

async function main(): Promise<void> {
  // Node has no localStorage by default; the store persists its repair state and
  // last-session info there, so give it a real in-memory one.
  const storage = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  }

  const localNotebook = { ...makeNotebook('Local', null), updatedAt: 500 }
  const pulled = remoteNotebook('nb-remote', 'Remote', 1000)
  const stub = await startWebdavStub({
    'mamaco/manifest.json': serializeManifest({
      version: 3,
      updatedAt: 1000,
      folders: { updatedAt: 0 },
      notebooks: [{ id: pulled.id, name: pulled.name, updatedAt: 1000, deleted: false }],
    }),
    'mamaco/notebooks/nb-remote.json': notebookFile(pulled),
  })

  await db.putSettings({
    ...DEFAULT_SETTINGS,
    cloud: {
      ...DEFAULT_SETTINGS.cloud,
      enabled: true,
      autoSync: true,
      webdavUrl: stub.url,
      webdavPath: 'mamaco',
    },
  })
  await db.putNotebook(localNotebook)
  await useAppStore.getState().init()
  logger.clear()

  console.log('== content applied by the sync does not schedule another sync ==')
  const first = await useAppStore.getState().syncNow('startup')
  const started = lastDetails('Sync started')
  const finished = lastDetails('Sync finished')
  assert(first !== null && first.errors.length === 0, 'run 1: finished without errors')
  assert(started?.trigger === 'startup', 'run 1: the log records why it started (startup)')
  assert(started?.pdfScan === true, 'run 1: the log records the one-per-version PDF scan')
  assert(finished?.trigger === 'startup', 'run 1: the summary keeps the trigger')
  assert(finished?.pulled === 1, 'run 1: the summary counts the applied pull (1)')
  assert(finished?.pushed === 1, 'run 1: the summary counts the pushed notebook (1)')
  assert(finished?.repairedPdfPages === 0, 'run 1: 0 pages repaired')
  assert(finished?.pendingPdfPages === 0, 'run 1: 0 pages pending repair')
  assert(
    useAppStore.getState().notebooks.some((nb) => nb.id === pulled.id),
    'run 1: the pulled notebook reached the store',
  )
  assert(
    finished?.localChangesQueuedDuringRun === false,
    'run 1: applying remote content is not a local change',
  )
  assert(finished?.nextSyncScheduled === false, 'run 1: the run scheduled no follow-up')
  await delay(300)
  assert(countLogs('Sync started') === 1, 'run 1: no second sync started after it finished')

  console.log('== a local edit during a run waits for the debounce ==')
  const second = remoteNotebook('nb-remote-2', 'Remote 2', 2000)
  const manifest = parseManifest(stub.read(`mamaco/${MANIFEST_PATH}`)!)
  manifest.notebooks.push({ id: second.id, name: second.name, updatedAt: 2000, deleted: false })
  stub.put(`mamaco/${MANIFEST_PATH}`, serializeManifest(manifest))
  stub.put(`mamaco/notebooks/nb-remote-2.json`, notebookFile(second))

  const manifestReadsBefore = stub.requests.filter((r) => r === `GET mamaco/${MANIFEST_PATH}`).length
  stub.manifestLatencyMs = 200
  const run = useAppStore.getState().syncNow('auto')
  // Wait until the run is blocked on the manifest, then edit a notebook.
  for (let i = 0; i < 100; i++) {
    const reads = stub.requests.filter((r) => r === `GET mamaco/${MANIFEST_PATH}`).length
    if (reads > manifestReadsBefore) break
    await delay(10)
  }
  await useAppStore.getState().persistNotebook({ ...localNotebook, name: 'Local edit' })
  const result = await run
  stub.manifestLatencyMs = 0

  const secondFinished = lastDetails('Sync finished')
  assert(result !== null && result.errors.length === 0, 'run 2: finished without errors')
  assert(secondFinished?.trigger === 'auto', 'run 2: the log records the auto trigger')
  assert(secondFinished?.pulled === 1, 'run 2: the summary counts the applied pull (1)')
  assert(secondFinished?.pushed === 0, 'run 2: the in-flight edit is not pushed by this run')
  assert(
    secondFinished?.localChangesQueuedDuringRun === true,
    'run 2: a local edit during the run is detected',
  )
  assert(secondFinished?.nextSyncScheduled === true, 'run 2: it is left to the debounced sync')
  assert(countLogs('Sync started') === 2, 'run 2: the run was not restarted recursively')
  assert(
    useAppStore.getState().notebooks.some((nb) => nb.id === second.id),
    'run 2: the second pulled notebook reached the store',
  )
  assert(
    useAppStore.getState().notebooks.find((nb) => nb.id === localNotebook.id)?.name === 'Local edit',
    'run 2: the local edit is kept locally',
  )
  const remoteCopy = JSON.parse(
    stub.read(`mamaco/notebooks/${localNotebook.id}.json`)!,
  ).notebook as Notebook
  assert(
    remoteCopy.name === 'Local',
    'run 2: the in-flight edit was not uploaded by this run (deferred to the debounce)',
  )

  stub.stop()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
