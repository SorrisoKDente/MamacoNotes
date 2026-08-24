import { Capacitor, CapacitorHttp } from '@capacitor/core'

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

    const res = await CapacitorHttp.request({
      url,
      method: init?.method ?? 'GET',
      headers,
      data,
    })

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

  return fetch(url, init)
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
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: { ...allHeaders, Range: `bytes=${offset}-${end}` },
        responseType: 'arraybuffer',
      })

      // Server ignored Range and returned the whole body in one shot.
      if (res.status === 200) {
        const text = new TextDecoder('utf-8').decode(
          typeof res.data === 'string' ? base64ToBytes(res.data) : new Uint8Array(0),
        )
        return { ok: true, status: 200, text }
      }

      if (res.status !== 206) {
        return { ok: res.status >= 200 && res.status < 300, status: res.status, text: '' }
      }

      const raw = typeof res.data === 'string' ? res.data : ''
      const bytes = base64ToBytes(raw)
      if (bytes.length === 0) break
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

  const res = await fetch(url, { headers })
  if (!res.ok) return { ok: false, status: res.status, text: '' }
  return { ok: true, status: res.status, text: await res.text() }
}
