import { Capacitor } from '@capacitor/core'

export async function customFetch(url: string, init?: RequestInit): Promise<Response> {
  if (Capacitor.isNativePlatform()) {
    const { CapacitorHttp } = await import('@capacitor/core')

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
