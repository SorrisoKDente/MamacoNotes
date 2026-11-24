/**
 * End-to-end regression verification for the PDF bitmap sync path.
 *
 * Nothing of the production seam is mocked except the OS bridge itself:
 *
 *   real store (`syncNow`) → real `runSync` → real transport → real HTTP
 *   (a local WebDAV server) → fake `@capacitor/core` that behaves like the
 *   Android plugin (`responseType: 'arraybuffer'` arrives as
 *   `Base64.DEFAULT`-wrapped base64, JSON is parsed unless it is a truncated
 *   Range chunk).
 *
 * It proves the two regressions of `fac81be` end to end:
 *  1. `pdfs/<pageId>.png` really lands in IndexedDB as the page's `dataUrl`,
 *     byte-for-byte, after crossing the Android bridge as wrapped base64 (the
 *     old decoder treated that text as raw bytes and rejected every bitmap);
 *  2. the progress bar advances page by page and reaches 100% even when a page
 *     ends without an image, because failed attempts are reported as progress.
 *
 * Run: npx tsx scripts/verify-sync-e2e.ts
 */
import 'fake-indexeddb/auto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

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

const g = globalThis as any

// Node has no navigator (and Bun's has no `language`), but the i18n table reads
// it at import time, before the store can be imported.
try {
  Object.defineProperty(g, 'navigator', {
    value: { language: 'en-US' },
    configurable: true,
    writable: true,
  })
} catch {
  g.navigator.language = 'en-US'
}

// The store persists the PDF repair state and last-session info in localStorage.
const storage = new Map<string, string>()
g.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, String(value)),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
}

/* ------------------------------------------------------------------ *
 * Android bridge
 * ------------------------------------------------------------------ */

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Deterministic PNG-like payload; > DOWNLOAD_CHUNK so Range is really used. */
function makePng(size: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(PNG_HEADER, 0)
  let state = seed
  for (let i = PNG_HEADER.length; i < size; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    bytes[i] = state & 0xff
  }
  return bytes
}

/** `Base64.encodeToString(..., Base64.DEFAULT)`: 76-char lines plus a line feed. */
function toBase64(bytes: Uint8Array): string {
  const lines = Buffer.from(bytes).toString('base64').match(/.{1,76}/g) ?? []
  return lines.map((line) => line + '\n').join('')
}

interface NativeCall {
  method: string
  url: string
  headers: Record<string, string>
  responseType?: string
}

const nativeCalls: NativeCall[] = []

function normalizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      out[String(key).toLowerCase()] = String(value)
    }
  }
  return out
}

/** CapacitorHttp.request, backed by a real HTTP call to the local WebDAV stub. */
async function nativeRequest(options: any): Promise<unknown> {
  const url = String(options.url)
  const method = String(options.method ?? 'GET').toUpperCase()
  const headers = normalizeHeaders(options.headers)
  nativeCalls.push({ method, url, headers, responseType: options.responseType })

  const body =
    options.data === undefined || options.data === null
      ? undefined
      : typeof options.data === 'string'
        ? options.data
        : JSON.stringify(options.data)
  const res = await fetch(url, { method, headers, body })
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
  const responseHeaders: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  const bytes = new Uint8Array(await res.arrayBuffer())

  // What the real plugin does with the body:
  //  - JSON + arraybuffer is parsed (a truncated Range chunk stays text);
  //  - any other binary body arrives as Base64.DEFAULT output;
  //  - text requests arrive as UTF-8 text.
  const isJson = contentType.includes('json')
  const wantsBinary = options.responseType === 'arraybuffer' || options.responseType === 'blob'
  let data: unknown
  if (wantsBinary && !isJson) {
    data = toBase64(bytes)
  } else if (wantsBinary) {
    const text = new TextDecoder().decode(bytes)
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  } else {
    data = new TextDecoder().decode(bytes)
  }

  return { status: res.status, headers: responseHeaders, data, url }
}

/** Native streamed upload: the chunks are base64 and land as one real PUT. */
const uploadSessions = new Map<
  string,
  { url: string; headers: Record<string, string>; chunks: string[] }
>()

g.androidBridge = {}
g.Capacitor = {
  PluginHeaders: [
    {
      name: 'CapacitorHttp',
      methods: [
        { name: 'request', rtype: 'promise' },
        { name: 'get', rtype: 'promise' },
        { name: 'post', rtype: 'promise' },
      ],
    },
    {
      name: 'PickDirectory',
      methods: [
        { name: 'uploadStart', rtype: 'promise' },
        { name: 'uploadChunk', rtype: 'promise' },
        { name: 'uploadEnd', rtype: 'promise' },
      ],
    },
  ],
  nativePromise: async (plugin: string, method: string, options: any) => {
    if (plugin === 'CapacitorHttp' && method === 'request') return nativeRequest(options)
    if (plugin === 'PickDirectory') {
      const opts = options ?? {}
      if (method === 'uploadStart') {
        uploadSessions.set(opts.sessionId, {
          url: String(opts.url),
          headers: normalizeHeaders(opts.headers),
          chunks: [],
        })
        return undefined
      }
      const session = uploadSessions.get(opts.sessionId)
      if (!session) throw new Error('upload session missing')
      if (method === 'uploadChunk') {
        session.chunks.push(String(opts.content))
        return undefined
      }
      if (method === 'uploadEnd') {
        const parts = session.chunks.map((chunk) => Buffer.from(chunk, 'base64'))
        const bytes = Buffer.concat(parts)
        const headers = { ...session.headers }
        delete headers['content-length']
        const res = await fetch(session.url, { method: 'PUT', headers, body: bytes })
        return { status: res.status, bytesWritten: bytes.length }
      }
    }
    throw new Error(`unexpected native call: ${plugin}.${method}`)
  },
}

/* ------------------------------------------------------------------ *
 * Local WebDAV server
 * ------------------------------------------------------------------ */

interface Stub {
  url: string
  requests: string[]
  put(path: string, bytes: Uint8Array | string): void
  get(path: string): Uint8Array | undefined
  stop(): void
}

async function startWebdavStub(): Promise<Stub> {
  const files = new Map<string, Uint8Array>()
  const stub: Stub = {
    url: '',
    requests: [],
    put(path, bytes) {
      files.set(path, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes)
    },
    get(path) {
      return files.get(path)
    },
    stop() {
      server.closeAllConnections()
      server.close()
    },
  }

  const contentTypeOf = (path: string) =>
    path.endsWith('.json') ? 'application/json' : path.endsWith('.png') ? 'image/png' : 'application/octet-stream'

  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname).replace(
      /^\/+/,
      '',
    )
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
      const names = [...files.keys()]
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
      const file = files.get(path)
      if (!file) {
        res.writeHead(404).end()
        return
      }
      const contentType = contentTypeOf(path)
      const range = req.headers.range
      const match = typeof range === 'string' ? /bytes=(\d+)-(\d*)/.exec(range) : null
      if (!match) {
        res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(file.length) })
        res.end(req.method === 'HEAD' ? undefined : Buffer.from(file))
        return
      }
      const start = Number(match[1])
      const end = Math.min(match[2] ? Number(match[2]) : file.length - 1, file.length - 1)
      if (start >= file.length) {
        res.writeHead(416).end()
        return
      }
      const slice = file.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${file.length}`,
        'Content-Length': String(slice.length),
      })
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(slice))
      return
    }
    if (req.method === 'PUT') {
      files.set(path, new Uint8Array(body))
      res.writeHead(201).end()
      return
    }
    if (req.method === 'DELETE') {
      files.delete(path)
      res.writeHead(204).end()
      return
    }
    res.writeHead(405).end()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return stub
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const { db } = await import('../src/db')
const { useAppStore } = await import('../src/store')
const { logger } = await import('../src/utils/logger')
const { encodePngDataUrl, pdfHash, serializeManifest, MANIFEST_PATH, NOTEBOOK_FORMAT_VERSION } =
  await import('../src/utils/sync')
const { DEFAULT_SETTINGS } = await import('../src/types')
type Notebook = import('../src/types').Notebook
type Page = import('../src/types').Page

const BASE = 'base'

function lightPage(id: string): Page {
  return {
    id,
    template: 'blank',
    width: 100,
    height: 100,
    pdf: { name: 'doc.pdf', pageNumber: 1 },
  } as Page
}

function remoteNotebook(id: string, name: string, updatedAt: number, pageIds: string[]): Notebook {
  return {
    id,
    name,
    folderId: null,
    pages: pageIds.map(lightPage),
    createdAt: updatedAt,
    updatedAt,
  }
}

function notebookFile(nb: Notebook): string {
  return JSON.stringify({ version: NOTEBOOK_FORMAT_VERSION, exportedAt: 1, notebook: nb })
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const stub = await startWebdavStub()

  const images = new Map([
    ['p1', makePng(300_000, 1)],
    ['p2', makePng(300_000, 2)],
    ['p3', makePng(300_000, 3)],
  ])
  const nb = remoteNotebook('nb-e2e', 'E2E PDF', 1000, [...images.keys()])
  const pdfs = Object.fromEntries(
    [...images.entries()].map(([pageId, bytes]) => [pageId, pdfHash(encodePngDataUrl(bytes))]),
  )
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    serializeManifest({
      version: 3,
      updatedAt: 1000,
      folders: { updatedAt: 0 },
      notebooks: [{ id: nb.id, name: nb.name, updatedAt: 1000, deleted: false, pdfs }],
    }),
  )
  stub.put(`${BASE}/notebooks/${nb.id}.json`, notebookFile(nb))
  for (const [pageId, bytes] of images) stub.put(`${BASE}/pdfs/${pageId}.png`, bytes)

  await db.putSettings({
    ...DEFAULT_SETTINGS,
    cloud: {
      ...DEFAULT_SETTINGS.cloud,
      enabled: true,
      autoSync: false,
      webdavUrl: stub.url,
      webdavPath: BASE,
    },
  })
  await useAppStore.getState().init()
  logger.clear()

  // Every progress update the UI would render during the run, in order.
  const progress: { completed: number; total: number; percent: number | null }[] = []
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.syncProgress && state.syncProgress !== previous.syncProgress) {
      progress.push({
        completed: state.syncProgress.completed,
        total: state.syncProgress.total,
        percent: state.syncProgress.percent,
      })
    }
  })

  console.log('== a pull downloads every PDF bitmap through the Android bridge ==')

  const result = await useAppStore.getState().syncNow('manual')
  unsubscribe()

  assert(result !== null && result.errors.length === 0, 'run: finished without errors')
  assert(stub.requests.some((r) => r === `GET ${BASE}/notebooks/${nb.id}.json`), 'run: pulled the notebook body')

  const stored = await db.getNotebook(nb.id)
  assert(stored !== undefined, 'run: the pulled notebook reached IndexedDB')
  for (const [pageId, bytes] of images) {
    const page = stored?.pages.find((p) => p.id === pageId)
    assert(
      page?.pdf?.dataUrl === encodePngDataUrl(bytes),
      `run: ${pageId} bitmap persisted byte-for-byte from the wrapped base64 body`,
    )
  }

  const bitmapCalls = nativeCalls.filter(
    (call) => call.url.endsWith('.png') && call.responseType === 'arraybuffer',
  )
  const ranged = bitmapCalls.filter((call) => call.headers['range'])
  assert(ranged.length > 0, 'bridge: the PNG really travelled as chunked Range requests')

  const downloads = logger
    .getLogs()
    .filter((entry) => entry.message.startsWith('Sync downloaded PDF bitmap'))
  assert(downloads.length === images.size, `log: every page logged its download (${downloads.length}/3)`)

  console.log('== the progress bar advances page by page ==')

  const completes = progress.map((p) => p.completed)
  assert(
    completes.every((value, i) => i === 0 || value >= completes[i - 1]),
    'progress: completed never goes backwards',
  )
  const last = progress[progress.length - 1]
  assert(last?.percent === 100, 'progress: the run ends at 100%')
  const distinct = new Set(completes).size
  assert(
    distinct >= images.size + 1,
    `progress: one step per file and per PDF page (${distinct} distinct steps for 1 notebook + 3 pages)`,
  )
  assert(
    progress.every((p) => (p.percent ?? 0) >= 0 && (p.percent ?? 0) <= 100) &&
      progress.every((p, i) => i === 0 || p.total >= progress[i - 1].total),
    'progress: percentages stay in range and the total never shrinks',
  )

  // Keep the previous snapshot array out of the second phase.
  progress.length = 0

  console.log('== a page whose image is not a PNG still advances the bar ==')

  const junk = remoteNotebook('nb-junk', 'Junk PDF', 2000, ['good', 'junk'])
  stub.put(
    `${BASE}/notebooks/${junk.id}.json`,
    notebookFile(junk),
  )
  const manifestEntry = {
    id: junk.id,
    name: junk.name,
    updatedAt: 2000,
    deleted: false,
    pdfs: { good: pdfHash(encodePngDataUrl(images.get('p1')!)), junk: pdfHash(encodePngDataUrl(images.get('p2')!)) },
  }
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    serializeManifest({
      version: 3,
      updatedAt: 2000,
      folders: { updatedAt: 0 },
      notebooks: [
        { id: nb.id, name: nb.name, updatedAt: 1000, deleted: false, pdfs },
        manifestEntry,
      ],
    }),
  )
  stub.put(`${BASE}/pdfs/good.png`, images.get('p1')!)
  // A WebDAV/Koofr error page served with 200: no image, but the run must not stall.
  stub.put(`${BASE}/pdfs/junk.png`, '<html>Hotlinking not allowed</html>')

  const progress2: { completed: number; total: number; percent: number | null }[] = []
  const unsubscribe2 = useAppStore.subscribe((state, previous) => {
    if (state.syncProgress && state.syncProgress !== previous.syncProgress) {
      progress2.push({
        completed: state.syncProgress.completed,
        total: state.syncProgress.total,
        percent: state.syncProgress.percent,
      })
    }
  })
  const second = await useAppStore.getState().syncNow('manual')
  unsubscribe2()

  assert(second !== null && second.errors.length === 0, 'junk run: the pull still succeeds')

  const junkStored = await db.getNotebook(junk.id)
  assert(
    junkStored?.pages.find((p) => p.id === 'good')?.pdf?.dataUrl === encodePngDataUrl(images.get('p1')!),
    'junk run: the valid page kept its bitmap',
  )
  assert(
    junkStored?.pages.find((p) => p.id === 'junk')?.pdf?.dataUrl === undefined,
    'junk run: the non-PNG body is not stored as a background',
  )
  assert(
    logger
      .getLogs()
      .some((entry) =>
        entry.message.includes(
          'PDF background image is not a PNG (nb-junk/junk): 35 bytes, first bytes 3c 68 74 6d 6c 3e 48 6f 74 6c 69 6e 6b 69 6e 67',
        ),
      ),
    'junk run: the log reports the size and the leading bytes of the body',
  )

  const finalJunk = progress2[progress2.length - 1]
  assert(finalJunk?.percent === 100, 'junk run: the bar still reaches 100%')
  const distinct2 = new Set(progress2.map((p) => p.completed)).size
  assert(
    distinct2 >= 3,
    `junk run: the failed page counted as a step too (${distinct2} distinct steps for 1 pull + 2 pages)`,
  )
  assert(
    progress2.some((p) => p.completed === p.total && p.total >= 3),
    'junk run: the last step equals the total work (nothing is left pending in the bar)',
  )

  console.log('== a stroke-only remote edit reuses the local PDF bitmaps ==')

  // Same pages and the same image hashes, only `updatedAt` moved: this is what
  // a stroke on another device looks like. The bitmaps are already on this
  // device, so not one `pdfs/<pageId>.png` may be transferred again.
  const edited = { ...nb, updatedAt: 3000 }
  stub.put(`${BASE}/notebooks/${nb.id}.json`, notebookFile(edited))
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    serializeManifest({
      version: 3,
      updatedAt: 3000,
      folders: { updatedAt: 0 },
      notebooks: [
        { id: nb.id, name: nb.name, updatedAt: 3000, deleted: false, pdfs },
        manifestEntry,
      ],
    }),
  )

  const beforeReuse = stub.requests.length
  const nativeBeforeReuse = nativeCalls.length
  const reuseRun = await useAppStore.getState().syncNow('manual')
  const reuseRequests = stub.requests.slice(beforeReuse)

  assert(reuseRun !== null && reuseRun.errors.length === 0, 'reuse run: finished without errors')
  assert(
    reuseRun?.pulled.length === 1 && reuseRun.pulled[0] === nb.name,
    'reuse run: the edited notebook was pulled',
  )
  assert(
    reuseRequests.some((r) => r === `GET ${BASE}/notebooks/${nb.id}.json`),
    'reuse run: the notebook body was downloaded',
  )
  assert(
    reuseRequests.every((r) => !r.includes('/pdfs/')),
    `reuse run: no PDF bitmap was downloaded again (${reuseRequests.filter((r) => r.includes('/pdfs/')).join(', ')})`,
  )
  assert(
    nativeCalls.slice(nativeBeforeReuse).filter((call) => call.url.includes('.png')).length === 0,
    'reuse run: the Android bridge issued no bitmap request',
  )
  const afterReuse = await db.getNotebook(nb.id)
  for (const [pageId, bytes] of images) {
    assert(
      afterReuse?.pages.find((p) => p.id === pageId)?.pdf?.dataUrl === encodePngDataUrl(bytes),
      `reuse run: ${pageId} kept its byte-identical bitmap`,
    )
  }

  console.log('== only the PDF page whose image changed is downloaded ==')

  const changedBytes = makePng(320_000, 4)
  const pdfs2 = { ...pdfs, p2: pdfHash(encodePngDataUrl(changedBytes)) }
  stub.put(`${BASE}/pdfs/p2.png`, changedBytes)
  stub.put(`${BASE}/notebooks/${nb.id}.json`, notebookFile({ ...nb, updatedAt: 4000 }))
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    serializeManifest({
      version: 3,
      updatedAt: 4000,
      folders: { updatedAt: 0 },
      notebooks: [
        { id: nb.id, name: nb.name, updatedAt: 4000, deleted: false, pdfs: pdfs2 },
        manifestEntry,
      ],
    }),
  )

  const beforeChange = stub.requests.length
  const changeRun = await useAppStore.getState().syncNow('manual')
  const changeRequests = stub.requests.slice(beforeChange)
  const changedPdfRequests = changeRequests.filter((r) => r.includes('/pdfs/'))

  assert(changeRun !== null && changeRun.errors.length === 0, 'changed page run: finished without errors')
  assert(
    changedPdfRequests.length > 0 && changedPdfRequests.every((r) => r.endsWith('/pdfs/p2.png')),
    `changed page run: only p2 was transferred (${changedPdfRequests.join(', ')})`,
  )
  const afterChange = await db.getNotebook(nb.id)
  assert(
    afterChange?.pages.find((p) => p.id === 'p1')?.pdf?.dataUrl === encodePngDataUrl(images.get('p1')!),
    'changed page run: the unchanged pages kept their local bitmaps',
  )
  assert(
    afterChange?.pages.find((p) => p.id === 'p2')?.pdf?.dataUrl === encodePngDataUrl(changedBytes),
    'changed page run: the changed page got the new bitmap',
  )

  console.log('== a local edit is pushed without re-uploading the PDFs ==')

  // The push path must keep working with the reuse added to pulls: a local edit
  // uploads the notebook JSON only (the manifest hashes match the remote
  // images), keeps the pages' PDF metadata and never uploads a PNG again.
  const localCopy = await db.getNotebook(nb.id)
  assert(localCopy !== undefined, 'push run: the local notebook is available')
  const localEdit: Notebook = {
    ...localCopy!,
    pages: localCopy!.pages.map((page, index) =>
      index === 0 ? { ...page, rotation: 90, updatedAt: Date.now() } : page,
    ),
  }
  await useAppStore.getState().persistNotebook(localEdit)

  const beforePush = stub.requests.length
  const nativeBeforePush = nativeCalls.length
  const pushRun = await useAppStore.getState().syncNow('manual')
  const pushRequests = stub.requests.slice(beforePush)

  assert(pushRun !== null && pushRun.errors.length === 0, 'push run: finished without errors')
  assert(
    pushRun?.pushed.length === 1 && pushRun.pushed[0] === nb.name,
    `push run: the local edit was pushed (${pushRun?.pushed.join(', ') || 'none'})`,
  )
  assert(pushRun?.pulled.length === 0, 'push run: the edit was not pulled over')
  assert(
    pushRequests.every((r) => !r.includes('/pdfs/')),
    `push run: no PDF image was re-uploaded (${pushRequests.filter((r) => r.includes('/pdfs/')).join(', ')})`,
  )
  assert(
    nativeCalls.slice(nativeBeforePush).filter((call) => call.url.includes('.png')).length === 0,
    'push run: the Android bridge issued no bitmap upload',
  )

  const manifestFile = stub.get(`${BASE}/${MANIFEST_PATH}`)
  const pushedBody = JSON.parse(
    new TextDecoder().decode(stub.get(`${BASE}/notebooks/${nb.id}.json`)!),
  ) as { notebook: Notebook }
  assert(
    pushedBody.notebook.pages.every((page) => !page.pdf?.dataUrl),
    'push run: the remote notebook JSON carries no inline bitmap',
  )
  assert(pushedBody.notebook.updatedAt === localEdit.updatedAt, 'push run: the remote body has the local edit')
  assert(pushedBody.notebook.pages[0]?.rotation === 90, 'push run: the edit itself reached the server')

  type StoredManifest = {
    updatedAt: number
    folders: { updatedAt: number }
    notebooks: { id: string; name: string; updatedAt: number; deleted: boolean; pdfs?: Record<string, string> }[]
  }
  const pushedManifest = JSON.parse(new TextDecoder().decode(manifestFile!)) as StoredManifest
  const pushedEntry = pushedManifest.notebooks.find((entry) => entry.id === nb.id)
  assert(
    pushedEntry?.updatedAt === localEdit.updatedAt,
    'push run: the manifest entry follows the pushed body',
  )
  assert(
    JSON.stringify(pushedEntry?.pdfs) === JSON.stringify(pdfs2),
    'push run: the PDF hashes survive the push',
  )

  console.log('== an unchanged second run syncs nothing ==')

  // Everything above is already on both sides: the next run must be a no-op.
  // Re-downloading the notebooks or their PDF bitmaps here is the "syncs every
  // page again" regression, which costs a full transfer per stroke on mobile.
  const requestsBeforeIdleRun = stub.requests.length
  const nativeBeforeIdleRun = nativeCalls.length
  const idle = await useAppStore.getState().syncNow('manual')
  const idleRequests = stub.requests.slice(requestsBeforeIdleRun)
  const idleNative = nativeCalls.slice(nativeBeforeIdleRun)

  assert(idle !== null && idle.errors.length === 0, 'idle run: finished without errors')
  assert(
    idle?.pulled.length === 0 && idle?.pushed.length === 0,
    `idle run: nothing was pushed or pulled (${idle?.pushed.length ?? -1} pushed, ${idle?.pulled.length ?? -1} pulled)`,
  )
  assert(
    idleRequests.every((r) => !r.includes('/pdfs/')),
    `idle run: no PDF bitmap was downloaded again (${idleRequests.filter((r) => r.includes('/pdfs/')).join(', ')})`,
  )
  assert(
    idleRequests.every((r) => !r.includes('/notebooks/')),
    `idle run: no notebook body was downloaded or uploaded again (${idleRequests.filter((r) => r.includes('/notebooks/')).join(', ')})`,
  )
  assert(
    idleNative.filter((call) => call.url.includes('.png')).length === 0,
    'idle run: the Android bridge issued no bitmap request',
  )

  console.log('== accepting the server copy reuses the local PDF bitmaps ==')

  // A real conflict (local and remote both newer than the baseline). Choosing
  // "use server" must apply the remote body without re-downloading the PDF
  // pages this device already has.
  const conflictLocal = await db.getNotebook(nb.id)
  const conflictingEdit: Notebook = {
    ...conflictLocal!,
    pages: conflictLocal!.pages.map((page, index) =>
      index === 0 ? { ...page, rotation: 180, updatedAt: Date.now() } : page,
    ),
  }
  await useAppStore.getState().persistNotebook(conflictingEdit)
  const remoteConflict = { ...pushedBody.notebook, updatedAt: localEdit.updatedAt + 1000 }
  stub.put(`${BASE}/notebooks/${nb.id}.json`, notebookFile(remoteConflict))
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    JSON.stringify({
      ...pushedManifest,
      updatedAt: remoteConflict.updatedAt,
      notebooks: pushedManifest.notebooks.map((entry) =>
        entry.id === nb.id ? { ...entry, updatedAt: remoteConflict.updatedAt } : entry,
      ),
    }),
  )

  const conflictRun = await useAppStore.getState().syncNow('manual')
  assert(
    conflictRun?.conflicts.length === 1,
    `conflict run: both edits are reported as a conflict (${conflictRun?.conflicts.length ?? -1})`,
  )

  const beforeResolve = stub.requests.length
  const nativeBeforeResolve = nativeCalls.length
  await useAppStore.getState().resolveConflicts({ [nb.id]: 'useServer' })
  const resolveRequests = stub.requests.slice(beforeResolve)

  assert(
    resolveRequests.every((r) => !r.includes('/pdfs/')),
    `conflict resolve: no PDF bitmap was downloaded (${resolveRequests.filter((r) => r.includes('/pdfs/')).join(', ')})`,
  )
  assert(
    nativeCalls.slice(nativeBeforeResolve).filter((call) => call.url.includes('.png')).length === 0,
    'conflict resolve: the Android bridge issued no bitmap request',
  )
  const resolved = await db.getNotebook(nb.id)
  assert(
    resolved?.updatedAt === remoteConflict.updatedAt,
    'conflict resolve: the server copy replaced the local edit',
  )
  assert(resolved?.pages[0]?.rotation !== 180, 'conflict resolve: the local rotation was discarded')
  for (const [pageId, bytes] of [['p1', images.get('p1')!], ['p3', images.get('p3')!]] as const) {
    assert(
      resolved?.pages.find((p) => p.id === pageId)?.pdf?.dataUrl === encodePngDataUrl(bytes),
      `conflict resolve: ${pageId} kept its local bitmap`,
    )
  }

  console.log('== restoring from the cloud reuses the local PDF bitmaps ==')

  // "Restore from cloud" (trash) reads a notebook outside the sync plan. A
  // notebook trashed while the cloud keeps the copy stores no body in the trash
  // entry, so it must keep its bitmaps locally: restoring it downloads the
  // notebook JSON and no `pdfs/<pageId>.png`.
  await useAppStore.getState().deleteNotebook(nb.id, 'local')
  const trashed = useAppStore.getState().trash.find((item) => item.id === nb.id)
  assert(trashed?.cloudKeepsCopy === true, 'trash restore: the notebook waits for a cloud restore')
  assert(
    (await db.getNotebook(nb.id)) === undefined,
    'trash restore: the local notebook body was removed',
  )

  // The remote body lost p3 while the notebook sat in the trash: the restore
  // must reuse p1/p2 and must not keep the bitmap of a page that is gone.
  stub.put(
    `${BASE}/notebooks/${nb.id}.json`,
    notebookFile({
      ...remoteConflict,
      pages: remoteConflict.pages.filter((page) => page.id !== 'p3'),
    }),
  )

  const beforeRestore = stub.requests.length
  const nativeBeforeRestore = nativeCalls.length
  await useAppStore.getState().restoreFromCloud(nb.id)
  const restoreRequests = stub.requests.slice(beforeRestore)

  assert(
    restoreRequests.some((r) => r === `GET ${BASE}/notebooks/${nb.id}.json`),
    'trash restore: the notebook body was downloaded',
  )
  assert(
    restoreRequests.every((r) => !r.includes('/pdfs/')),
    `trash restore: no PDF bitmap was downloaded (${restoreRequests.filter((r) => r.includes('/pdfs/')).join(', ')})`,
  )
  assert(
    nativeCalls.slice(nativeBeforeRestore).filter((call) => call.url.includes('.png')).length === 0,
    'trash restore: the Android bridge issued no bitmap request',
  )
  assert(
    useAppStore.getState().notebooks.some((n) => n.id === nb.id),
    'trash restore: the notebook is back in the list',
  )
  assert(
    !useAppStore.getState().trash.some((item) => item.id === nb.id),
    'trash restore: the trash entry is gone',
  )
  const restoredFromCloud = await db.getNotebook(nb.id)
  assert(restoredFromCloud !== undefined, 'trash restore: the notebook is back in IndexedDB')
  for (const [pageId, bytes] of [
    ['p1', images.get('p1')!],
    ['p2', changedBytes],
  ] as const) {
    assert(
      restoredFromCloud?.pages.find((p) => p.id === pageId)?.pdf?.dataUrl === encodePngDataUrl(bytes),
      `trash restore: ${pageId} kept its byte-identical bitmap`,
    )
  }
  assert(
    restoredFromCloud?.pages.some((page) => page.id === 'p3') === false,
    'trash restore: the page removed remotely is gone',
  )
  assert(
    (await db.getPagePdfDataUrl('p3')) === undefined,
    'trash restore: the bitmap of the removed page is pruned',
  )

  console.log('== a stale manifest timestamp is healed instead of pulling forever ==')

  // A manifest entry that does not match the body it describes (written by an
  // older client) never equals the baseline again, so without healing the same
  // notebook would be pulled, with all its pages, on every sync. The body is
  // left untouched: only the entry timestamp is ahead of it.
  const currentManifest = JSON.parse(
    new TextDecoder().decode(stub.get(`${BASE}/${MANIFEST_PATH}`)!),
  ) as StoredManifest
  const currentEntry = currentManifest.notebooks.find((entry) => entry.id === nb.id)
  const staleUpdatedAt = (currentEntry?.updatedAt ?? 0) + 1000
  stub.put(
    `${BASE}/${MANIFEST_PATH}`,
    JSON.stringify({
      ...currentManifest,
      updatedAt: staleUpdatedAt,
      notebooks: currentManifest.notebooks.map((entry) =>
        entry.id === nb.id ? { ...entry, updatedAt: staleUpdatedAt } : entry,
      ),
    }),
  )

  const beforeStale = stub.requests.length
  const staleRun = await useAppStore.getState().syncNow('manual')
  assert(staleRun?.pulled.length === 1, 'stale entry: the body is read once')
  assert(
    stub.requests.slice(beforeStale).every((r) => !r.includes('/pdfs/')),
    'stale entry: the pull reuses the local bitmaps',
  )

  const requestsBeforeHealed = stub.requests.length
  const healedRun = await useAppStore.getState().syncNow('manual')
  const healedRequests = stub.requests.slice(requestsBeforeHealed)
  assert(
    healedRun?.pulled.length === 0 && healedRun?.pushed.length === 0,
    `stale entry: the healed manifest leaves nothing to sync (${healedRun?.pulled.length ?? -1} pulled)`,
  )
  assert(
    healedRequests.every((r) => !r.includes('/notebooks/') && !r.includes('/pdfs/')),
    `stale entry: no body or bitmap is transferred again (${healedRequests.filter((r) => r.includes('/notebooks/') || r.includes('/pdfs/')).join(', ')})`,
  )

  console.log('== purging a trashed notebook releases its kept bitmaps ==')

  // The bitmaps kept for a cloud restore must not outlive the trash entry, so a
  // purge drops them from `pdfImages`.
  const keptPageId = restoredFromCloud!.pages[0]!.id
  assert(
    (await db.getPagePdfDataUrl(keptPageId)) !== undefined,
    'trash purge: the notebook still owns its bitmap',
  )
  await useAppStore.getState().deleteNotebook(nb.id, 'local')
  assert(
    (await db.getPagePdfDataUrl(keptPageId)) !== undefined,
    'trash purge: the trash keeps the bitmap for the restore',
  )
  await useAppStore.getState().purgeTrashItem(nb.id)
  assert(
    (await db.getPagePdfDataUrl(keptPageId)) === undefined,
    'trash purge: purging the entry drops the kept bitmap',
  )

  console.log('== deleting a folder keeps the bitmaps of its notebooks ==')

  // Deleting a folder with "cloud keeps the copy" trashes its notebooks without
  // a body, so their bitmaps must survive just like a direct notebook delete.
  const folder = await useAppStore.getState().addFolder('Folder with PDF')
  await useAppStore.getState().moveNotebook(junk.id, folder.id)
  await useAppStore.getState().deleteFolder(folder.id, 'local')
  assert(
    useAppStore.getState().trash.find((item) => item.id === junk.id)?.cloudKeepsCopy === true,
    'folder delete: the child notebook waits for a cloud restore',
  )
  assert(
    (await db.getPagePdfDataUrl('good')) !== undefined,
    'folder delete: the child notebook keeps its PDF bitmap',
  )
  const beforeFolderRestore = stub.requests.length
  await useAppStore.getState().restoreFromCloud(junk.id)
  assert(
    !stub.requests.slice(beforeFolderRestore).includes(`GET ${BASE}/pdfs/good.png`),
    'folder delete: restoring the child notebook reuses its bitmap',
  )
  assert(
    (await db.getNotebook(junk.id))?.pages.find((p) => p.id === 'good')?.pdf?.dataUrl ===
      encodePngDataUrl(images.get('p1')!),
    'folder delete: the restored notebook has its bitmap back',
  )

  stub.stop()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
