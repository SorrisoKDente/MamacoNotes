import { registerPlugin } from '@capacitor/core'

import { alertAction } from '../components/Modals'
import { logger } from './logger'

/**
 * Custom Capacitor plugin (package `pick-directory`, see `plugins/`).
 *
 * All file operations are chunked: the content never crosses the JS <-> native
 * bridge in a single large call, which would otherwise crash with an
 * OutOfMemoryError on Android for big backups (images/PDFs stored as data URLs).
 */
export const PickDirectory = registerPlugin<{
  openFilePicker: () => Promise<{ uri: string }>
  openFileCreator: (options: { filename: string }) => Promise<{ uri: string }>
  writeUriChunk: (options: { uri: string; content: string; append?: boolean }) => Promise<void>
  readUriChunk: (options: { uri: string; offset: number; length: number }) => Promise<{ data: string; end: boolean }>
  getUriFileInfo: (options: { uri: string }) => Promise<{ size: number }>
  uploadStart: (options: {
    sessionId: string
    url: string
    headers: Record<string, string>
  }) => Promise<void>
  uploadChunk: (options: { sessionId: string; content: string }) => Promise<void>
  uploadEnd: (options: { sessionId: string }) => Promise<{ status: number; bytesWritten: number }>
}>('PickDirectory')

// Base64 adds roughly one third to the bridge payload. Keep each native call
// small enough that large notebooks do not freeze the Android WebView.
export const CHUNK_SIZE = 128 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

async function decodeChunked(
  size: number,
  read: (offset: number, length: number) => Promise<{ data: string; end: boolean }>,
): Promise<string> {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  let offset = 0
  while (offset < size) {
    const { data, end } = await read(offset, CHUNK_SIZE)
    if (!data) break
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    text += decoder.decode(bytes, { stream: true })
    offset += binary.length
    if (end || binary.length === 0) break
  }
  text += decoder.decode()
  return text
}

/**
 * PUTs `content` to `url` streaming each chunk through the native plugin
 * (HttpURLConnection). Content never crosses the bridge in a single large call,
 * avoiding the Android OutOfMemoryError for big notebook JSON uploads.
 */
export async function uploadFileStreaming(
  url: string,
  headers: Record<string, string>,
  content: Uint8Array,
): Promise<number> {
  const sessionId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  await PickDirectory.uploadStart({ sessionId, url, headers })
  for (let offset = 0; offset < content.byteLength; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, content.byteLength)
    await PickDirectory.uploadChunk({
      sessionId,
      content: bytesToBase64(content.subarray(offset, end)),
    })
  }
  const { status, bytesWritten } = await PickDirectory.uploadEnd({ sessionId })
  if (bytesWritten !== content.byteLength) {
    throw new Error(
      `Android upload was incomplete: expected ${content.byteLength} bytes, wrote ${bytesWritten}`,
    )
  }
  return status
}

export async function readBackupFileFromUri(uri: string): Promise<string> {
  const { size } = await PickDirectory.getUriFileInfo({ uri })
  return decodeChunked(size, (offset, length) =>
    PickDirectory.readUriChunk({ uri, offset, length }),
  )
}

/** Opens the system document picker and returns the file content (chunked read). */
export async function pickBackupFile(): Promise<string | null> {
  try {
    const { uri } = await PickDirectory.openFilePicker()
    if (!uri) return null
    return await readBackupFileFromUri(uri)
  } catch (err) {
    console.error('Failed to pick backup file:', err)
    return null
  }
}

/** Opens the system "Save As" picker and writes the content in chunks. */
export async function saveBackupFile(filename: string, content: string): Promise<boolean> {
  try {
    logger.info(`Opening native file creator for: ${filename}`)
    const { uri } = await PickDirectory.openFileCreator({ filename })
    if (!uri) {
      logger.warn('Native file creator returned no URI')
      return false
    }

    logger.info(`Native file location chosen: ${uri}. Starting chunked write...`)
    const blob = new Blob([content], { type: 'application/json' })
    const size = blob.size
    let offset = 0

    while (offset < size) {
      const chunk = blob.slice(offset, offset + CHUNK_SIZE)
      const text = await chunk.text()
      await PickDirectory.writeUriChunk({
        uri,
        content: text,
        append: offset > 0,
      })
      offset += chunk.size
    }
    logger.info('Native backup write complete.')
    return true
  } catch (err) {
    logger.error('Failed to save backup file', err)
    void alertAction('Erro ao salvar backup', String(err))
    return false
  }
}
