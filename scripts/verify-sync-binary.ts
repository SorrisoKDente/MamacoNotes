/**
 * Regression verification for the BINARY sync path on Android (P1-4 follow-up).
 *
 * The fake `@capacitor/core` below models what the real Android plugin does:
 *   - `responseType: 'arraybuffer' | 'blob'` → the body arrives as a base64
 *     string (binary-safe);
 *   - anything else for a non-JSON body → the body arrives as UTF-8 text, which
 *     is LOSSY for binary data (invalid bytes become U+FFFD). This is exactly
 *     why Koofr downloads were corrupting the PNG: `Response.arrayBuffer()`
 *     re-encoded that lossy text instead of decoding base64.
 *   - JSON content-types are parsed by the plugin even with `arraybuffer`.
 *   - `PickDirectory.uploadChunk` receives base64 chunks of the PUT body.
 *
 * Proves that a PNG survives:
 *  1. the generic WebDAV binary download (chunked Range requests)
 *  2. the generic path when the server ignores Range and returns the whole body
 *  3. the Koofr Content API binary download (the path that was corrupting)
 *  4. `downloadNotebook` (the pull rehydration used by sync and trash restore)
 *     on both transports, byte-identical to the original `dataUrl`
 *  5. the Android chunked upload (`pdfs/<pageId>.png`), across chunk boundaries
 *  6. a 404 still surfaces as `RemoteFileNotFoundError` on both transports
 *
 * Run: npx tsx scripts/verify-sync-binary.ts
 */
import type { CloudSettings, Notebook, Page } from '../src/types'

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

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Deterministic PNG-like payload; > DOWNLOAD_CHUNK (128 KiB) on purpose. */
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

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
}

function contentTypeOf(path: string): string {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

/* ------------------------------------------------------------------ *
 * Fake server
 * ------------------------------------------------------------------ */

interface FakeFile {
  bytes: Uint8Array
  /** false simulates a server that ignores `Range` and returns 200 + body. */
  ranges: boolean
}

const files = new Map<string, FakeFile>()

const DAV_ROOT = 'https://dav.example.com/notes'
const KOOFR_URL = 'https://app.koofr.net/dav/Primary'

interface NativeRequest {
  url: string
  method: string
  headers: Record<string, string>
  responseType?: string
}

const requests: NativeRequest[] = []

function normalizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      out[String(key).toLowerCase()] = String(value)
    }
  }
  return out
}

/** CapacitorHttp's `data` field for a body, following the real plugin rules. */
function encodeBody(bytes: Uint8Array, contentType: string, responseType?: string): unknown {
  const isBinary = responseType === 'arraybuffer' || responseType === 'blob'
  if (isBinary && !contentType.includes('json')) return toBase64(bytes)
  const text = new TextDecoder('utf-8').decode(bytes) // lossy for binary
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return text
}

function ok(bytes: Uint8Array, contentType: string, responseType?: string) {
  return {
    status: 200,
    headers: { 'Content-Type': contentType },
    data: encodeBody(bytes, contentType, responseType),
    url: '',
  }
}

function notFound() {
  return { status: 404, headers: {}, data: '', url: '' }
}

function readFile(path: string, headers: Record<string, string>, responseType?: string) {
  const file = files.get(path)
  if (!file) return notFound()
  const contentType = contentTypeOf(path)
  const range = headers['range']
  if (!range || !file.ranges) {
    return ok(file.bytes, contentType, responseType)
  }
  const match = /bytes=(\d+)-(\d+)/.exec(range)
  if (!match) return ok(file.bytes, contentType, responseType)
  const start = Number(match[1])
  const end = Math.min(Number(match[2]), file.bytes.length - 1)
  if (start > end) return notFound()
  const chunk = file.bytes.subarray(start, end + 1)
  return {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${file.bytes.length}`,
    },
    data: encodeBody(chunk, contentType, responseType),
    url: '',
  }
}

function pathFromUrl(url: string, root: string): string {
  return url.slice(url.indexOf(root) + root.length).replace(/^\/+/, '')
}

/* ------------------------------------------------------------------ *
 * Fake native bridge
 * ------------------------------------------------------------------ */

const uploadSessions = new Map<
  string,
  { url: string; headers: Record<string, string>; chunks: string[] }
>()

async function nativePromise(plugin: string, method: string, options: any): Promise<unknown> {
  if (plugin === 'CapacitorHttp' && method === 'request') {
    const url = String(options.url)
    const headers = normalizeHeaders(options.headers)
    const upper = String(options.method ?? 'GET').toUpperCase()
    requests.push({ url, method: upper, headers, responseType: options.responseType })

    if (url.endsWith('/api/v2/mounts')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        data: { mounts: [{ id: 'm1', name: 'Primary', isPrimary: true }] },
        url,
      }
    }
    if (url.includes('/content/api/v2/mounts/')) {
      const path = new URL(url).searchParams.get('path') ?? ''
      if (upper === 'HEAD') {
        const file = files.get(path)
        return file
          ? { status: 200, headers: { 'content-length': String(file.bytes.length) }, url }
          : notFound()
      }
      return readFile(path, headers, options.responseType)
    }
    if (upper === 'HEAD') {
      const file = files.get(pathFromUrl(url, DAV_ROOT))
      return file
        ? { status: 200, headers: { 'content-length': String(file.bytes.length) }, url }
        : notFound()
    }
    return readFile(pathFromUrl(url, DAV_ROOT), headers, options.responseType)
  }

  if (plugin === 'PickDirectory') {
    const opts = options ?? {}
    if (method === 'uploadStart') {
      uploadSessions.set(opts.sessionId, {
        url: opts.url,
        headers: normalizeHeaders(opts.headers),
        chunks: [],
      })
      return undefined
    }
    if (method === 'uploadChunk') {
      const session = uploadSessions.get(opts.sessionId)
      if (!session) throw new Error('upload session missing')
      session.chunks.push(opts.content)
      return undefined
    }
    if (method === 'uploadEnd') {
      const session = uploadSessions.get(opts.sessionId)
      if (!session) throw new Error('upload session missing')
      const bytes = new Uint8Array(
        session.chunks.reduce((total, chunk) => total + fromBase64(chunk).length, 0),
      )
      let offset = 0
      for (const chunk of session.chunks) {
        const part = fromBase64(chunk)
        bytes.set(part, offset)
        offset += part.length
      }
      // What HttpURLConnection did with the streamed PUT body.
      files.set(pathFromUrl(session.url, DAV_ROOT), { bytes, ranges: true })
      return { status: 201, bytesWritten: bytes.length }
    }
  }

  throw new Error(`unexpected native call: ${plugin}.${method}`)
}

// Must be set BEFORE @capacitor/core is imported: it reads these at module load.
const g = globalThis as any
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
  nativePromise,
}

const { Capacitor } = await import('@capacitor/core')
const { makeTransport, RemoteFileNotFoundError } = await import('../src/utils/webdav')
const { downloadNotebook, encodePngDataUrl, pdfHash } = await import('../src/utils/sync')

const genericSettings: CloudSettings = {
  enabled: true,
  webdavUrl: DAV_ROOT,
  webdavUsername: 'user',
  webdavPassword: 'pass',
  rememberPassword: true,
  webdavPath: 'base',
  autoSync: false,
  lastSyncAt: null,
}

const koofrSettings: CloudSettings = { ...genericSettings, webdavUrl: KOOFR_URL }

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const PNG = makePng(300_000, 42)
const DATA_URL = encodePngDataUrl(PNG)

function lightPage(id: string): Page {
  return {
    id,
    template: 'blank',
    width: 100,
    height: 100,
    pdf: { name: 'doc.pdf', pageNumber: 1 },
  } as Page
}

function notebookWithPage(id: string, pageId: string): Notebook {
  return {
    id,
    name: 'PDF',
    folderId: null,
    pages: [lightPage(pageId)],
    createdAt: 1,
    updatedAt: 1,
  }
}

function seedNotebook(id: string, pageId: string): void {
  files.set(`base/notebooks/${id}.json`, {
    bytes: new TextEncoder().encode(
      JSON.stringify({
        version: 3,
        exportedAt: 1,
        pdfs: { [pageId]: pdfHash(DATA_URL) },
        notebook: notebookWithPage(id, pageId),
      }),
    ),
    ranges: true,
  })
}

console.log('== platform ==')

assert(Capacitor.isNativePlatform(), 'test runs as the Android (native) platform')

console.log('== generic WebDAV: binary download ==')

files.set('base/pdfs/p1.png', { bytes: PNG, ranges: true })
{
  const transport = makeTransport(genericSettings)
  const bytes = await transport.downloadBinaryFile('base/pdfs/p1.png')
  assert(bytes.length === PNG.length, `generic: length intact (${bytes.length} bytes)`)
  assert(bytes.every((byte, i) => byte === PNG[i]), 'generic: chunked PNG bytes are byte-identical')
  const ranged = requests.filter((r) => r.headers['range'])
  assert(ranged.length > 1, 'generic: download really used multiple Range requests')
}

{
  files.set('base/pdfs/norange.png', { bytes: PNG, ranges: false })
  const transport = makeTransport(genericSettings)
  const bytes = await transport.downloadBinaryFile('base/pdfs/norange.png')
  assert(bytes.every((byte, i) => byte === PNG[i]), 'generic: intact when the server ignores Range')
}

console.log('== Koofr: binary download ==')

files.set('base/pdfs/p1.png', { bytes: PNG, ranges: true })
{
  const transport = makeTransport(koofrSettings)
  const bytes = await transport.downloadBinaryFile('base/pdfs/p1.png')
  assert(bytes.length === PNG.length, `koofr: length intact (${bytes.length} bytes)`)
  assert(bytes.every((byte, i) => byte === PNG[i]), 'koofr: PNG bytes are byte-identical')
  const contentCall = requests.filter((r) => r.url.includes('/content/api/')).pop()
  assert(
    contentCall?.responseType === 'arraybuffer',
    'koofr: binary download asks for arraybuffer (base64), never lossy text',
  )
}

console.log('== pull rehydration (downloadNotebook) ==')

for (const [label, settings] of [
  ['generic', genericSettings],
  ['koofr', koofrSettings],
] as const) {
  seedNotebook(`nb-${label}`, `p-${label}`)
  files.set(`base/pdfs/p-${label}.png`, { bytes: PNG, ranges: true })
  const transport = makeTransport(settings)
  const nb = await downloadNotebook('base', transport, `nb-${label}`)
  assert(
    nb.pages[0]?.pdf?.dataUrl === DATA_URL,
    `${label}: page.pdf.dataUrl rebuilt byte-for-byte`,
  )
}

console.log('== upload: PNG leaves the device intact ==')

{
  const transport = makeTransport(genericSettings)
  await transport.uploadFile('base/pdfs/uploaded.png', PNG, 'image/png')
  const stored = files.get('base/pdfs/uploaded.png')
  assert(stored?.bytes.length === PNG.length, 'upload: remote size matches the source PNG')
  assert(
    (stored?.bytes.every((byte, i) => byte === PNG[i]) ?? false),
    'upload: chunked base64 upload lands byte-identical across chunk boundaries',
  )
}

console.log('== missing image stays a 404 ==')

{
  for (const [label, settings] of [
    ['generic', genericSettings],
    ['koofr', koofrSettings],
  ] as const) {
    const transport = makeTransport(settings)
    let notFound = false
    try {
      await transport.downloadBinaryFile('base/pdfs/absent.png')
    } catch (error) {
      notFound = error instanceof RemoteFileNotFoundError
    }
    assert(notFound, `${label}: missing image raises RemoteFileNotFoundError`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
