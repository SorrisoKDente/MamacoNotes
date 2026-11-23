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

  stub.stop()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
