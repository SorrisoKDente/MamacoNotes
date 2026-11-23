import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * Detects connection-level failures (as opposed to HTTP errors, which arrive as
 * Response objects and never reach this check). These are transient by nature,
 * so the caller may safely retry them. Authentication/4xx/5xx are NEVER
 * considered connection errors: they are handled as regular HTTP responses.
 */
export function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    lower.includes('failed to connect') ||
    lower.includes('connect timed out') ||
    lower.includes('connection timed out') ||
    lower.includes('network is unreachable') ||
    lower.includes('network error') ||
    lower.includes('network unreachable') ||
    lower.includes('failed to fetch') ||
    lower.includes('unexpected end of stream') ||
    lower.includes('socketexception') ||
    lower.includes('socket timeout') ||
    lower.includes('the request timed out') ||
    lower.includes('timed out') ||
    lower.includes('timeout exceeded') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enetunreach') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('unable to resolve host') ||
    lower.includes('host lookup failed') ||
    lower.includes('load failed') ||
    lower.includes('the internet connection appears to be offline')
  )
}

/**
 * Detects if an error is likely a browser-level CORS or Mixed Content failure.
 * These usually arrive as a generic "Failed to fetch" TypeError.
 */
export function isBrowserFetchError(err: unknown): boolean {
  if (Capacitor.isNativePlatform() || (typeof window !== 'undefined' && (window as any).inkfolioDesktop)) return false
  const msg = err instanceof Error ? err.message : String(err)
  return msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('load failed')
}

/**
 * Retries `fn` on connection errors only (3 attempts, backoff 500ms -> 1s).
 * HTTP 4xx/5xx and authentication failures never reach the retry path: they
 * are returned by fetch as responses (not thrown), so `fn` resolves normally.
 * Browser-level fetch errors (CORS) are NOT retried to avoid long hangs.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delays = [500, 1000],
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < retries && isConnectionError(err)) {
        if (isBrowserFetchError(err)) break // Don't retry CORS/Mixed Content errors
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export type CustomFetchInit = RequestInit & {
  /**
   * Capacitor native only: how the plugin must hand the body back.
   * `'arraybuffer'` returns base64 (binary-safe). The default (`'json'`) decodes
   * a non-JSON body as UTF-8 text, which irreversibly corrupts binary images.
   */
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob'
}

export async function customFetch(url: string, init?: CustomFetchInit): Promise<Response> {
  if (Capacitor.isNativePlatform()) {
    let data: any = init?.body
    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      if (data instanceof Uint8Array) {
        data = new TextDecoder().decode(data)
      } else {
        data = new TextDecoder().decode(new Uint8Array(data))
      }
    } else if (data instanceof Blob) {
      data = await data.text()
    }

    const headers: Record<string, string> = {}
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value
        })
      } else if (Array.isArray(init.headers)) {
        init.headers.forEach(([key, value]) => {
          headers[key] = value
        })
      } else {
        Object.assign(headers, init.headers)
      }
    }

    const res = await withRetry(() =>
      CapacitorHttp.request({
        url,
        method: init?.method ?? 'GET',
        headers,
        data,
        ...(init?.responseType ? { responseType: init.responseType } : {}),
      }),
    )

    const responseHeaders = new Headers()
    if (res.headers) {
      for (const [key, value] of Object.entries(res.headers)) {
        responseHeaders.append(key, value as string)
      }
    }

    // Binary bodies arrive base64 (`responseType: 'arraybuffer'`); re-encoding
    // the raw string as UTF-8 would corrupt every non-ASCII byte, so decode with
    // the same rules the chunked download uses.
    const bodyBytes = () =>
      decodeCapacitorData(res.data, isJsonContentType(res.headers as Record<string, unknown>)) ??
      new Uint8Array()
    const bodyArrayBuffer = () => {
      const bytes = bodyBytes()
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    }

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: '',
      url,
      headers: responseHeaders,
      text: () => Promise.resolve(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      json: () => Promise.resolve(res.data),
      blob: () => Promise.resolve(new Blob([bodyArrayBuffer()])),
      arrayBuffer: () => Promise.resolve(bodyArrayBuffer()),
    } as Response
  }

  return withRetry(() => fetch(url, init))
}

const DOWNLOAD_CHUNK = 128 * 1024
const MIN_DOWNLOAD_CHUNK = 16 * 1024
/**
 * Upper bound for one Range request. The chunk is grown after every successful
 * request so a large notebook/image needs a handful of bridge calls instead of
 * dozens, while a single chunk stays far below the whole-body response that
 * used to OOM the Android bridge: 1 MiB of bytes crosses the bridge as ~1.4 MiB
 * of base64 and is decoded back to 1 MiB, so one request peaks at a few MB in
 * the WebView — the notebook/image itself (which the download has to hold
 * anyway) is what dominates, not the chunk. Bitmap downloads share one budget of
 * 3 in flight across overlapping notebook pulls (`PDF_BITMAP_DOWNLOADS` in
 * `sync.ts`), so the transient overhead stays around 10 MB, under the ~32 MB
 * bridge limit.
 */
const MAX_DOWNLOAD_CHUNK = 1024 * 1024

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function isBase64Text(s: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0
}

function isJsonContentType(headers: Record<string, unknown> | undefined): boolean {
  if (!headers) return false
  const ct = headers['Content-Type'] ?? headers['content-type']
  return typeof ct === 'string' && ct.toLowerCase().includes('application/json')
}

/**
 * Decodes the `data` field that CapacitorHttp returns for a response.
 *
 * On Android, CapacitorHttp IGNORES `responseType: 'arraybuffer'` whenever the
 * response Content-Type is `application/json` — it parses the body into a JS
 * value first (see HttpRequestHandler.readData, "backward compatibility"
 * branch). Therefore, for JSON files (manifest/folders/notebooks):
 *   - a complete body arrives as an object/array  → reconstruct with JSON.stringify;
 *   - a truncated Range chunk (invalid JSON) arrives as the raw string.
 * For non-JSON content the body arrives as a base64 string (responseType
 * arraybuffer/blob). The two string formats are told apart by the base64
 * alphabet so the correct bytes come out in every case.
 *
 * `isJson` must be true when the response Content-Type is `application/json`
 * (the same condition Capacitor itself uses to pick the parse branch): in that
 * case a string is ALWAYS raw text, never base64. Without this, a Range chunk
 * that lands entirely inside a base64 image `dataUrl` in the notebook JSON
 * (all base64-alphabet characters, length divisible by 4) was mistaken for an
 * arraybuffer payload and base64-decoded into binary garbage — corrupting the
 * reassembled JSON with raw control characters ("Bad control character in
 * string literal in JSON") or shortening it ("Unexpected end of JSON input").
 */
function decodeCapacitorData(data: unknown, isJson = false): Uint8Array | null {
  if (typeof data === 'string') {
    if (isJson) {
      return new TextEncoder().encode(data)
    }
    if (isBase64Text(data)) {
      try {
        return base64ToBytes(data)
      } catch {
        // Not base64 in practice — fall through to raw text.
      }
    }
    return new TextEncoder().encode(data)
  }
  if (data !== null && typeof data === 'object') {
    return new TextEncoder().encode(JSON.stringify(data))
  }
  if (typeof data === 'number' || typeof data === 'boolean') {
    return new TextEncoder().encode(JSON.stringify(data))
  }
  return null
}

export { decodeCapacitorData }

export function validateContentRange(
  contentRange: string | null | undefined,
  offset: number,
  byteLength: number,
): number {
  const match = typeof contentRange === 'string'
    ? /bytes (\d+)-(\d+)\/(\d+)/.exec(contentRange)
    : null
  if (!match) {
    throw new Error('Invalid ranged download: missing Content-Range header')
  }
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  if (start !== offset) {
    throw new Error(`Invalid ranged download: expected byte ${offset}, received byte ${start}`)
  }
  const expectedLength = end - start + 1
  if (expectedLength !== byteLength) {
    throw new Error(
      `Invalid ranged download length: expected ${expectedLength} bytes, received ${byteLength}`,
    )
  }
  if (end >= total || total <= 0) {
    throw new Error(`Invalid ranged download total: ${contentRange}`)
  }
  return total
}

/**
 * Streams a remote resource, handing each received chunk to `onChunk`. On
 * native platforms it uses HTTP Range requests (responseType 'arraybuffer'
 * returns base64, so the server-side content never crosses the bridge in a
 * single large call — avoiding the Android OOM for big downloads). On
 * web/desktop it falls back to plain fetch.
 */
async function readResource(
  url: string,
  headers: Record<string, string>,
  onChunk: (bytes: Uint8Array) => void,
): Promise<{ ok: boolean; status: number }> {
  if (Capacitor.isNativePlatform()) {
    const allHeaders = { ...headers }
    let offset = 0
    let total: number | null = null
    let chunkSize = DOWNLOAD_CHUNK

    for (;;) {
      let res: Awaited<ReturnType<typeof CapacitorHttp.request>>
      let bytes: Uint8Array | null = null
      let rangeError: Error | null = null
      let requested = chunkSize
      for (;;) {
        const end = offset + requested - 1
        res = await withRetry(() =>
          CapacitorHttp.request({
            url,
            method: 'GET',
            headers: {
              ...allHeaders,
              Accept: 'application/octet-stream',
              'Cache-Control': 'no-cache',
              Range: `bytes=${offset}-${end}`,
            },
            responseType: 'arraybuffer',
          }),
        )

        const isJson = isJsonContentType(res.headers as Record<string, unknown>)

        // Server ignored Range and returned the whole body in one shot.
        if (res.status === 200) {
          bytes = decodeCapacitorData(res.data, isJson)
          if (bytes && bytes.length > 0) onChunk(bytes)
          return { ok: true, status: 200 }
        }

        if (res.status !== 206) {
          return { ok: res.status >= 200 && res.status < 300, status: res.status }
        }

        bytes = decodeCapacitorData(res.data, isJson)
        const contentRange = res.headers?.['Content-Range'] ?? res.headers?.['content-range']
        try {
          total = validateContentRange(contentRange, offset, bytes?.length ?? 0)
          rangeError = null
        } catch (error) {
          rangeError = error instanceof Error ? error : new Error(String(error))
        }
        if (!rangeError) break
        if (requested <= MIN_DOWNLOAD_CHUNK) throw rangeError
        requested = Math.max(MIN_DOWNLOAD_CHUNK, Math.floor(requested / 2))
        chunkSize = requested
      }

      if (!bytes || bytes.length === 0) break
      onChunk(bytes)

      offset += bytes.length
      if (total !== null && offset >= total) break
      if (bytes.length < requested) {
        throw new Error(
          `Invalid ranged download: response ended at byte ${offset}, expected ${total ?? 'more data'}`,
        )
      }
      chunkSize = Math.min(MAX_DOWNLOAD_CHUNK, requested * 2)
    }

    return { ok: true, status: 206 }
  }

  const res = await withRetry(() => fetch(url, { headers }))
  if (!res.ok) return { ok: false, status: res.status }
  onChunk(new Uint8Array(await res.arrayBuffer()))
  return { ok: true, status: res.status }
}

/**
 * Downloads a text resource. Chunks are decoded incrementally so a huge
 * notebook JSON never has to exist twice in memory on Android.
 */
export async function downloadText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  const { ok, status } = await readResource(url, headers, (bytes) => {
    text += decoder.decode(bytes, { stream: true })
  })
  if (!ok) return { ok, status, text: '' }
  return { ok: true, status, text: text + decoder.decode() }
}

/** Downloads a binary resource (e.g. a PDF page image) into memory. */
export async function downloadBytes(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; bytes: Uint8Array | null }> {
  const chunks: Uint8Array[] = []
  const { ok, status } = await readResource(url, headers, (bytes) => chunks.push(bytes))
  if (!ok) return { ok: false, status, bytes: null }
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return { ok: true, status, bytes }
}
