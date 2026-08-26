/**
 * Verification script for the mobile sync download fix.
 *
 * The Android CapacitorHttp IGNORES `responseType: 'arraybuffer'` whenever the
 * response Content-Type is `application/json` (HttpRequestHandler.readData,
 * "backward compatibility" branch): the body is always parsed first. A complete
 * JSON body arrives as a JS object/array (previously decoded as empty -> the
 * "Unexpected end of JSON input" error); a truncated Range chunk arrives as the
 * raw string; non-JSON content arrives as base64.
 *
 * This script simulates that behavior end-to-end (native path -> CapacitorHttp
 * web plugin -> mocked global fetch that mimics the Android server side) and
 * asserts `downloadText` reconstructs the correct text in every case.
 *
 * Run: npx tsx scripts/verify-download.ts
 */
import { Capacitor } from '@capacitor/core'
import { decodeCapacitorData, downloadText, isConnectionError, withRetry } from '../src/utils/http'

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

// Force the native download path: `downloadText` checks `Capacitor.isNativePlatform()`.
// In @capacitor/core 8.5 `isNativePlatform()` reads a platform value captured in a
// closure at module load (`getPlatformId(win)`), so overriding `Capacitor.getPlatform`
// does NOT change it. Override `isNativePlatform` itself; the CapacitorHttp plugin
// (registered at module load, platform 'web' in Node) keeps using the web
// implementation -> global fetch.
;(Capacitor as { isNativePlatform: () => boolean }).isNativePlatform = () => true

// The web plugin decodes `arraybuffer` responses with FileReader (absent in Node).
class FakeFileReader {
  result = ''
  onload: (() => void) | null = null
  onerror: ((err: unknown) => void) | null = null

  readAsDataURL(blob: Blob): void {
    blob
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        }
        this.result = 'data:application/octet-stream;base64,' + btoa(bin)
        this.onload?.()
      })
      .catch((err) => this.onerror?.(err))
  }
}
;(globalThis as { FileReader: unknown }).FileReader = FakeFileReader

type FakeFile = {
  contentType: string
  content: string
  supportsRange: boolean
}

function installFetchSimulator(files: Record<string, FakeFile>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const file = files[url.pathname]
    if (!file) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    const headers = (init?.headers ?? {}) as Record<string, string>
    const range = headers['Range'] ?? headers['range']
    if (!file.supportsRange || !range) {
      return new Response(file.content, { status: 200, headers: { 'content-type': file.contentType } })
    }
    const m = /bytes=(\d+)-(\d+)/.exec(range)
    if (!m) return new Response('Bad Range', { status: 400 })
    const start = parseInt(m[1], 10)
    const end = Math.min(parseInt(m[2], 10), file.content.length - 1)
    return new Response(file.content.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-type': file.contentType,
        'content-range': `bytes ${start}-${end}/${file.content.length}`,
      },
    })
  }) as typeof fetch
}

const foldersJson = JSON.stringify([
  { id: 'f1', name: 'Trabalho', updatedAt: 123 },
  { id: 'f2', name: 'Pessoal', updatedAt: 456 },
])

const bigText = `linha ${'x'.repeat(5000)}\n`.repeat(300)
const bigBytes = new TextEncoder().encode(bigText).length

async function main(): Promise<void> {
  // 1. JSON body in a single 200 response (server ignores Range): CapacitorHttp
  //    returns a parsed ARRAY. Previously decoded as empty -> JSON.parse('')
  //    threw "Unexpected end of JSON input". Must now reconstruct the JSON text.
  installFetchSimulator({
    '/dav/folders.json': { contentType: 'application/json', content: foldersJson, supportsRange: false },
  })
  {
    const res = await downloadText('https://host/dav/folders.json')
    assert(res.ok && res.status === 200, 'folders.json 200 (ignored Range) ok')
    let parsed: unknown = null
    try {
      parsed = JSON.parse(res.text)
    } catch {
      parsed = null
    }
    assert(Array.isArray(parsed) && (parsed as unknown[]).length === 2, 'folders.json text is valid JSON with 2 folders')
  }

  // 2. JSON body via a 206 that covers the whole file: CapacitorHttp returns a
  //    parsed OBJECT. Must reconstruct with JSON.stringify.
  const manifest = JSON.stringify({ version: 1, files: { a: 'x' } })
  installFetchSimulator({
    '/dav/manifest.json': { contentType: 'application/json', content: manifest, supportsRange: true },
  })
  {
    const res = await downloadText('https://host/dav/manifest.json')
    const parsed = JSON.parse(res.text) as { version: number }
    assert(res.ok && res.status === 206, 'manifest.json single 206 ok')
    assert(parsed.version === 1, 'manifest.json text is valid JSON')
  }

  // 3. Large non-JSON body chunked with Range (bigger than one 512KB chunk):
  //    CapacitorHttp returns base64 for each chunk. Must reassemble exactly.
  installFetchSimulator({
    '/dav/backup.txt': { contentType: 'application/octet-stream', content: bigText, supportsRange: true },
  })
  {
    const res = await downloadText('https://host/dav/backup.txt')
    assert(bigBytes > 512 * 1024, `fixture is bigger than one chunk (${bigBytes} bytes)`)
    assert(res.ok && res.status === 206, 'big text 206 ok')
    assert(res.text === bigText, 'big text reassembled byte-exact')
  }

  // 4. A 404 surfaces as ok:false without throwing.
  installFetchSimulator({})
  {
    const res = await downloadText('https://host/dav/missing.json')
    assert(!res.ok && res.status === 404, '404 -> ok:false, status 404')
  }

  // 5. decodeCapacitorData unit cases (all shapes Android readData can return).
  const dec = new TextDecoder('utf-8')
  {
    const obj = decodeCapacitorData({ id: 1, name: 'x' })
    assert(obj !== null && dec.decode(obj) === '{"id":1,"name":"x"}', 'parsed object -> JSON.stringify')
    const arr = decodeCapacitorData([1, 'a'])
    assert(arr !== null && dec.decode(arr) === '[1,"a"]', 'parsed array -> JSON.stringify')
    const num = decodeCapacitorData(42)
    assert(num !== null && dec.decode(num) === '42', 'number -> JSON.stringify')
    const bool = decodeCapacitorData(true)
    assert(bool !== null && dec.decode(bool) === 'true', 'boolean -> JSON.stringify')
    const raw = decodeCapacitorData('{"id":1,"name":"x",')
    assert(raw !== null && dec.decode(raw) === '{"id":1,"name":"x",', 'truncated JSON raw string -> raw bytes')
    const b64 = btoa('hello world')
    const asText = decodeCapacitorData(b64, true)
    assert(asText !== null && dec.decode(asText) === b64, 'JSON string -> raw text (never base64)')
    const asBytes = decodeCapacitorData(b64, false)
    assert(asBytes !== null && dec.decode(asBytes) === 'hello world', 'non-JSON base64 string -> decoded bytes')
    const empty = decodeCapacitorData('')
    assert(empty !== null && dec.decode(empty) === '', 'empty string -> empty bytes')
    assert(decodeCapacitorData(null) === null, 'null -> null')
  }

  // 6. Native-path regression: a large JSON notebook with an embedded base64
  //    image (bigger than one Range chunk). Simulate the Android readData JSON
  //    branch (parseJSON per chunk) through the web CapacitorHttp plugin
  //    (whose fetch we control) and assert downloadText reassembles the JSON
  //    byte-exact. Regression for the bug where a chunk that lands entirely
  //    inside a base64 dataUrl (all base64-alphabet chars, length % 4 == 0) was
  //    mistaken for an arraybuffer payload and base64-decoded into garbage ->
  //    "Bad control character in string literal in JSON" / "Unexpected end of
  //    JSON input".
  {
    const imageB64 = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(2 * 1024 * 1024)
    const fileText = JSON.stringify({
      version: 2,
      notebook: {
        id: 'n1',
        name: 'caderno com imagem',
        updatedAt: 123,
        pages: [
          {
            id: 'p1',
            layers: [
              {
                id: 'l1',
                images: [
                  { id: 'i1', dataUrl: `data:image/png;base64,${imageB64}`, x: 0, y: 0, width: 10, height: 10 },
                ],
              },
            ],
          },
        ],
      },
    })
    const fileBytes = new TextEncoder().encode(fileText)
    assert(fileBytes.length > 512 * 1024, 'notebook fixture is bigger than one chunk')

    // Replicates Capacitor's HttpRequestHandler.parseJSON (Android).
    const nativeParseJSON = (input: string): unknown => {
      const t = input.trim()
      if (t === 'null') return null
      if (t === 'true') return true
      if (t === 'false') return false
      if (t.length <= 0) return ''
      if (/^\".*\"$/.test(t)) return t.substring(1, t.length - 1)
      if (/^-?\d+$/.test(t)) return parseInt(t, 10)
      if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t)
      try {
        return JSON.parse(t)
      } catch {
        try {
          return JSON.parse(t)
        } catch {
          return t
        }
      }
    }

    // A Response-like object whose .json() returns the Android readData JSON
    // branch result (parseJSON): a truncated Range chunk comes back as the raw
    // string, a complete body as a parsed value — exactly what CapacitorHttp
    // returns on Android for application/json content.
    const fakeJsonResponse = (start: number, end: number): unknown => {
      const raw = new TextDecoder('utf-8').decode(fileBytes.slice(start, end + 1))
      const contentRange = `bytes ${start}-${end}/${fileBytes.length}`
      const headersLike = {
        get: (name: string) => {
          const n = name.toLowerCase()
          if (n === 'content-type') return 'application/json'
          if (n === 'content-range') return contentRange
          return null
        },
        forEach: (cb: (v: string, k: string) => void) => {
          cb('application/json', 'content-type')
          cb(contentRange, 'content-range')
        },
      }
      return {
        ok: true,
        status: 206,
        url: '',
        headers: headersLike,
        json: async () => nativeParseJSON(raw),
        text: async () => raw,
        blob: async () => new Blob([raw]),
        arrayBuffer: async () => new TextEncoder().encode(raw).buffer,
      }
    }

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/dav/notebooks/n1.json') {
        const headers = (init?.headers ?? {}) as Record<string, string>
        const range = headers['Range'] ?? headers['range'] ?? ''
        const m = /bytes=(\d+)-(\d+)/.exec(range)
        if (!m) return new Response('Bad Range', { status: 400 })
        const start = parseInt(m[1], 10)
        const end = Math.min(parseInt(m[2], 10), fileBytes.length - 1)
        return fakeJsonResponse(start, end) as unknown as Response
      }
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }) as typeof fetch

    const res = await downloadText('https://host/dav/notebooks/n1.json')
    assert(res.ok, 'large JSON notebook 206 ok')
    assert(res.text === fileText, 'large JSON notebook reassembled byte-exact')
  }

  // 7. Retry: connection errors are retried; HTTP 4xx/5xx and auth are not.
  {
    const isNative = (Capacitor as { isNativePlatform: () => boolean }).isNativePlatform
    ;(Capacitor as { isNativePlatform: () => boolean }).isNativePlatform = () => false

    assert(
      isConnectionError(new Error('Failed to connect to app.koofr.net/167.235.4.177:443')),
      'isConnectionError: "Failed to connect" is a connection error',
    )
    assert(
      isConnectionError(new Error('network is unreachable')),
      'isConnectionError: "network is unreachable" is a connection error',
    )
    assert(
      isConnectionError(new TypeError('Failed to fetch')),
      'isConnectionError: "Failed to fetch" is a connection error',
    )
    assert(
      !isConnectionError(new Error('Falha de autenticação (401). Verifique o usuário e a senha.')),
      'isConnectionError: auth message is NOT a connection error',
    )
    assert(
      !isConnectionError(new Error('HTTP 500 Internal Server Error')),
      'isConnectionError: 5xx message is NOT a connection error',
    )

    let calls = 0
    await withRetry(
      async () => {
        calls++
        if (calls === 1) throw new Error('Failed to connect')
        return 'ok'
      },
      2,
      [0, 0],
    )
    assert(calls === 2, 'withRetry: retries a connection error and succeeds')

    calls = 0
    let thrown: unknown = null
    try {
      await withRetry(
        async () => {
          calls++
          throw new Error('HTTP 401')
        },
        2,
        [0, 0],
      )
    } catch (e) {
      thrown = e
    }
    assert(calls === 1 && thrown !== null, 'withRetry: does NOT retry a non-connection error')

    let webCalls = 0
    globalThis.fetch = (async () => {
      webCalls++
      if (webCalls === 1) throw new Error('Failed to fetch')
      return new Response('hello', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    }) as typeof fetch
    const res = await downloadText('https://host/dav/hello.txt')
    assert(
      webCalls === 2 && res.ok && res.text === 'hello',
      'downloadText (web): retries a connection error and returns the body',
    )

    webCalls = 0
    globalThis.fetch = (async () => {
      webCalls++
      return new Response('Server Error', { status: 500 })
    }) as typeof fetch
    const bad = await downloadText('https://host/dav/bad.txt')
    assert(
      webCalls === 1 && !bad.ok && bad.status === 500,
      'downloadText (web): 5xx returned as ok:false, NOT retried',
    )

    ;(Capacitor as { isNativePlatform: () => boolean }).isNativePlatform = isNative
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
