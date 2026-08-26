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
 * Retries `fn` on connection errors only (3 attempts, backoff 500ms -> 1s).
 * HTTP 4xx/5xx and authentication failures never reach the retry path: they
 * are returned by fetch as responses (not thrown), so `fn` resolves normally.
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
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export async function customFetch(url: string, init?: RequestInit): Promise<Response> {
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
      }),
    )

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: '',
      url,
      headers: new Headers(res.headers),
      text: () => Promise.resolve(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      json: () => Promise.resolve(res.data),
      blob: () => Promise.resolve(new Blob([res.data])),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).buffer),
    } as Response
  }

  return withRetry(() => fetch(url, init))
}

const DOWNLOAD_CHUNK = 512 * 1024

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

/**
 * Downloads a text resource on native platforms using HTTP Range requests
 * (responseType 'arraybuffer' returns base64, so the server-side content never
 * crosses the bridge in a single large call — avoiding the Android OOM for big
 * notebook JSON downloads). On web/desktop it falls back to plain fetch.
 */
export async function downloadText(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  if (Capacitor.isNativePlatform()) {
    const allHeaders = { ...headers }
    let offset = 0
    let total: number | null = null
    let chunks: Uint8Array[] = []

    for (;;) {
      const end = offset + DOWNLOAD_CHUNK - 1
      const res = await withRetry(() =>
        CapacitorHttp.request({
          url,
          method: 'GET',
          headers: { ...allHeaders, Range: `bytes=${offset}-${end}` },
          responseType: 'arraybuffer',
        }),
      )

      const isJson = isJsonContentType(res.headers as Record<string, unknown>)

      // Server ignored Range and returned the whole body in one shot.
      if (res.status === 200) {
        const bytes = decodeCapacitorData(res.data, isJson)
        const text = bytes ? new TextDecoder('utf-8').decode(bytes) : ''
        return { ok: true, status: 200, text }
      }

      if (res.status !== 206) {
        return { ok: res.status >= 200 && res.status < 300, status: res.status, text: '' }
      }

      const bytes = decodeCapacitorData(res.data, isJson)
      if (!bytes || bytes.length === 0) break
      chunks.push(bytes)

      const contentRange = res.headers?.['Content-Range'] ?? res.headers?.['content-range']
      const m = typeof contentRange === 'string' ? /bytes \d+-\d+\/(\d+)/.exec(contentRange) : null
      if (m) total = parseInt(m[1], 10)

      offset += bytes.length
      if (total !== null && offset >= total) break
      if (bytes.length < DOWNLOAD_CHUNK) break
    }

    const decoder = new TextDecoder('utf-8')
    let text = ''
    for (const chunk of chunks) {
      text += decoder.decode(chunk, { stream: true })
    }
    text += decoder.decode()
    return { ok: true, status: 206, text }
  }

  const res = await withRetry(() => fetch(url, { headers }))
  if (!res.ok) return { ok: false, status: res.status, text: '' }
  return { ok: true, status: res.status, text: await res.text() }
}
