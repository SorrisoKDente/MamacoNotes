import type { CloudSettings } from '../types'
import { t } from '../i18n'
import { logger } from './logger'
import { customFetch, downloadText } from './http'
import { Capacitor } from '@capacitor/core'
import { uploadFileStreaming } from './chunkedIo'

const NOTEBOOKS_DIR = 'notebooks'
const FOLDERS_DIR = 'folders'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  txt: 'text/plain',
  json: 'application/json',
}

function joinUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, '')
  const cleanPath = path.replace(/^\/+/, '')
  return cleanBase + '/' + cleanPath
}

function authHeader(settings: CloudSettings): string {
  if (settings.webdavUsername && settings.webdavPassword) {
    return 'Basic ' + btoa(`${settings.webdavUsername}:${settings.webdavPassword}`)
  }
  return ''
}

const PROPFIND_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'

interface KoofrMount {
  id: string
  name: string
  isPrimary?: boolean
}

interface KoofrInfo {
  apiBase: string
  mountId: string
  mountName: string
}

function koofrApiBase(settings: CloudSettings): string | null {
  let host = ''
  try {
    host = new URL(settings.webdavUrl).hostname
  } catch {
    return null
  }
  if (host === 'app.koofr.net' || host === 'storage.rcs-rds.ro') {
    try {
      return new URL(settings.webdavUrl).origin
    } catch {
      return null
    }
  }
  return null
}

const koofrInfoCache = new WeakMap<CloudSettings, KoofrInfo>()

function koofrAuthError(status: number): Error {
  return new Error(t('error.koofrAuthFailed', { status }))
}

function webdavAuthError(status: number): Error {
  return new Error(t('error.webdavAuthFailed', { status }))
}

async function koofrFetch<T>(
  apiBase: string,
  path: string,
  settings: CloudSettings,
  init?: RequestInit,
): Promise<{ status: number; data?: T }> {
  // Use customFetch to bypass CORS on Android
  const res = await customFetch(apiBase + path, {
    ...init,
    headers: {
      Authorization: authHeader(settings),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw koofrAuthError(res.status)
  }
  const data =
    res.status === 204 ? undefined : ((await res.json().catch(() => undefined)) as T | undefined)
  return { status: res.status, data }
}

async function koofrListDirectory(
  settings: CloudSettings,
  dirPath: string,
): Promise<string[]> {
  const { apiBase, mountId } = await koofrInfo(settings)
  const { status, data } = await koofrFetch<any[]>(
    apiBase,
    `/api/v2/mounts/${encodeURIComponent(mountId)}/files/list?path=${encodeURIComponent(dirPath)}`,
    settings,
  )
  if (status !== 200) return []
  return (data || []).map((item) => item.name).filter(Boolean)
}

async function koofrInfo(settings: CloudSettings): Promise<KoofrInfo> {
  const cached = koofrInfoCache.get(settings)
  if (cached) return cached
  const apiBase = koofrApiBase(settings)
  if (!apiBase) throw new Error(t('error.koofrServerNotRecognized'))
  const { status, data } = await koofrFetch<{ mounts?: KoofrMount[] }>(
    apiBase,
    '/api/v2/mounts',
    settings,
  )
  if (status !== 200) throw new Error(t('error.koofrListFoldersFailed', { status }))
  const mounts = data?.mounts ?? []
  const primary = mounts.find((m) => m.isPrimary) ?? mounts[0]
  if (!primary) throw new Error(t('error.koofrNoRootMount'))
  const info: KoofrInfo = { apiBase, mountId: primary.id, mountName: primary.name }
  koofrInfoCache.set(settings, info)
  return info
}

async function koofrFileExists(settings: CloudSettings, dirPath: string): Promise<boolean> {
  const { apiBase, mountId } = await koofrInfo(settings)
  const { status } = await koofrFetch(
    apiBase,
    `/api/v2/mounts/${encodeURIComponent(mountId)}/files/info?path=${encodeURIComponent(dirPath)}`,
    settings,
  )
  return status === 200
}

async function koofrCreateFolderTree(settings: CloudSettings, dirPath: string): Promise<void> {
  const { apiBase, mountId } = await koofrInfo(settings)
  const segments = dirPath.split('/').filter(Boolean)
  let parent = '/'
  for (const segment of segments) {
    const full = parent === '/' ? `/${segment}` : `${parent}/${segment}`
    if (!(await koofrFileExists(settings, full))) {
      const { status } = await koofrFetch<unknown>(
        apiBase,
        `/api/v2/mounts/${encodeURIComponent(mountId)}/files/folder?path=${encodeURIComponent(parent)}`,
        settings,
        {
          method: 'POST',
          body: JSON.stringify({ name: segment }),
        },
      )
      if (status !== 200 && status !== 201 && !(await koofrFileExists(settings, full))) {
        throw new Error(t('error.koofrCreateFolderFailed', { path: full, status }))
      }
    }
    parent = full
  }
}

async function effectiveBaseUrl(settings: CloudSettings): Promise<string> {
  const apiBase = koofrApiBase(settings)
  if (!apiBase) return settings.webdavUrl
  const info = await koofrInfo(settings)
  return `${info.apiBase}/dav/${encodeURIComponent(info.mountName)}`
}

async function directoryExists(settings: CloudSettings, dirPath: string): Promise<boolean> {
  const apiBase = koofrApiBase(settings)
  if (apiBase) {
    return koofrFileExists(settings, dirPath)
  }

  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, dirPath)
  try {
    const res = await customFetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: authHeader(settings),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: PROPFIND_BODY,
    })
    if (res.ok || res.status === 207) return true
    const g = await customFetch(url, { headers: { Authorization: authHeader(settings) } })
    return g.ok || g.status === 207
  } catch {
    return false
  }
}

export async function ensureDirectory(
  settings: CloudSettings,
  dirPath: string,
): Promise<void> {
  const apiBase = koofrApiBase(settings)
  if (apiBase) {
    await koofrCreateFolderTree(settings, dirPath)
    if (await koofrFileExists(settings, dirPath)) return
    const info = await koofrInfo(settings).catch(() => null)
    throw new Error(
      t('error.koofrFolderNotVisible', {
        dirPath,
        davUrl: `${koofrApiBase(settings)}/dav`,
        mountName: info?.mountName ?? '',
      }),
    )
  }

  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, dirPath)
  const res = await customFetch(url, {
    method: 'MKCOL',
    headers: { Authorization: authHeader(settings) },
  })
  if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
  if (res.status === 201) return
  if (res.status === 405 || res.ok) {
    if (await directoryExists(settings, dirPath)) return
    const trailing = await customFetch(`${url}/`, {
      method: 'MKCOL',
      headers: { Authorization: authHeader(settings) },
    })
    if (trailing.status === 201 || (await directoryExists(settings, dirPath))) return
    throw new Error(
      t('error.remoteFolderCreateFailed', { dirPath, basePath: settings.webdavPath }),
    )
  }
  throw new Error(t('error.createDirFailed', { dirPath, status: res.status }))
}

export async function ensureRemoteStructure(
  settings: CloudSettings,
): Promise<{ ok: boolean; message: string }> {
  try {
    await ensureDirectory(settings, settings.webdavPath)
    await ensureDirectory(settings, `${settings.webdavPath}/${NOTEBOOKS_DIR}`)
    await ensureDirectory(settings, `${settings.webdavPath}/${FOLDERS_DIR}`)
    return { ok: true, message: t('error.foldersCreated') }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function listDirectory(
  settings: CloudSettings,
  dirPath: string,
): Promise<string[]> {
  const apiBase = koofrApiBase(settings)
  if (apiBase) {
    return koofrListDirectory(settings, dirPath)
  }

  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, dirPath)
  const res = await customFetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader(settings),
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: PROPFIND_BODY,
  })
  if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
  if (!res.ok) return []
  const text = await res.text()
  const names: string[] = []
  const re = /<d:displayname[^>]*>([^<]*)<\/d:displayname>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    names.push(m[1])
  }
  return names.filter((n) => n)
}

export async function uploadFile(
  settings: CloudSettings,
  filePath: string,
  bytes: Uint8Array | Blob,
  contentType: string,
): Promise<void> {
  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, filePath)
  const headers = {
    Authorization: authHeader(settings),
    'Content-Type': contentType,
  }
  try {
    if (Capacitor.isNativePlatform()) {
      // Stream the body chunk-by-chunk through the native plugin instead of
      // sending the whole payload across the Capacitor bridge (which crashes
      // with OutOfMemoryError for large notebooks).
      const content =
        bytes instanceof Blob ? await bytes.text() : new TextDecoder().decode(bytes)
      const status = await uploadFileStreaming(url, headers, content)
      if (status >= 200 && status < 300) return
      if (status === 401 || status === 403) throw webdavAuthError(status)
      if (status === 404) {
        throw new Error(
          t('error.uploadFailed404', { filePath, basePath: settings.webdavPath }),
        )
      }
      throw new Error(t('error.uploadFailed', { filePath, status }))
    }

    const res = await customFetch(url, {
      method: 'PUT',
      headers,
      body: bytes instanceof Blob ? bytes : new Uint8Array(bytes),
    })
    if (!res.ok && res.status !== 201 && res.status !== 204) {
      if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
      if (res.status === 404) {
        throw new Error(
          t('error.uploadFailed404', { filePath, basePath: settings.webdavPath }),
        )
      }
      throw new Error(t('error.uploadFailed', { filePath, status: res.status }))
    }
  } catch (err) {
    logger.error(`Upload failed: ${filePath}`, err)
    throw err
  }
}

export async function downloadFile(
  settings: CloudSettings,
  filePath: string,
): Promise<string> {
  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, filePath)
  try {
    const headers = { Authorization: authHeader(settings) }
    if (Capacitor.isNativePlatform()) {
      // Chunked Range download: the remote content is fetched in pieces
      // (arraybuffer/base64) and reassembled in JS, avoiding the bridge OOM.
      const res = await downloadText(url, headers)
      if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
      if (!res.ok) {
        throw new Error(t('error.downloadFailed', { filePath, status: res.status }))
      }
      return res.text
    }
    const res = await customFetch(url, { headers })
    if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
    if (!res.ok) throw new Error(t('error.downloadFailed', { filePath, status: res.status }))
    return res.text()
  } catch (err) {
    logger.error(`Download failed: ${filePath}`, err)
    throw err
  }
}

export async function deleteRemoteFile(
  settings: CloudSettings,
  filePath: string,
): Promise<void> {
  const base = await effectiveBaseUrl(settings)
  const url = joinUrl(base, filePath)
  const res = await customFetch(url, {
    method: 'DELETE',
    headers: { Authorization: authHeader(settings) },
  })
  if (res.status === 401 || res.status === 403) throw webdavAuthError(res.status)
  if (!res.ok && res.status !== 404) {
    throw new Error(t('error.deleteFailed', { filePath, status: res.status }))
  }
}

export async function testWebdavConnection(
  settings: CloudSettings,
): Promise<{ ok: boolean; message: string }> {
  try {
    const apiBase = koofrApiBase(settings)
    if (apiBase) {
      // For Koofr, test via API to avoid PROPFIND on Android
      await koofrInfo(settings)
      const basePathExists = await koofrFileExists(settings, settings.webdavPath)
      return {
        ok: true,
        message: basePathExists
          ? t('error.connectionOkBaseExists')
          : t('error.connectionOkBaseMissing', { path: settings.webdavPath }),
      }
    }

    const base = await effectiveBaseUrl(settings)
    const res = await customFetch(joinUrl(base, ''), {
      method: 'PROPFIND',
      headers: {
        Authorization: authHeader(settings),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: PROPFIND_BODY,
    })
    if (!res.ok && res.status !== 207) {
      logger.error('WebDAV connection test failed', { status: res.status, url: settings.webdavUrl })
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: webdavAuthError(res.status).message }
      }
      return {
        ok: false,
        message: t('error.webdavAccessFailed', { status: res.status }),
      }
    }
    const basePathExists = await directoryExists(settings, settings.webdavPath)
    return {
      ok: true,
      message: basePathExists
        ? t('error.connectionOkBaseExists')
        : t('error.connectionOkBaseMissing', { path: settings.webdavPath }),
    }
  } catch (e) {
    logger.error('WebDAV connection test exception', e)
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export interface Transport {
  ensureDirectory: (dirPath: string) => Promise<void>
  listDirectory: (dirPath: string) => Promise<string[]>
  uploadFile: (filePath: string, bytes: Uint8Array | Blob, contentType: string) => Promise<void>
  downloadFile: (filePath: string) => Promise<string>
  deleteRemoteFile: (filePath: string) => Promise<void>
}

export function makeTransport(settings: CloudSettings): Transport {
  return {
    ensureDirectory: (dirPath) => ensureDirectory(settings, dirPath),
    listDirectory: (dirPath) => listDirectory(settings, dirPath),
    uploadFile: (filePath, bytes, contentType) =>
      uploadFile(settings, filePath, bytes, contentType),
    downloadFile: (filePath) => downloadFile(settings, filePath),
    deleteRemoteFile: (filePath) => deleteRemoteFile(settings, filePath),
  }
}

export { MIME_MAP }
