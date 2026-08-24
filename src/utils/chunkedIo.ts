import { registerPlugin } from '@capacitor/core'

/**
 * Custom Capacitor plugin (package `pick-directory`, see `plugins/`).
 *
 * All file operations are chunked: the content never crosses the JS <-> native
 * bridge in a single large call, which would otherwise crash with an
 * OutOfMemoryError on Android for big backups (images/PDFs stored as data URLs).
 */
export const PickDirectory = registerPlugin<{
  pick: () => Promise<{ path: string }>
  writeChunk: (options: { uri: string; filename: string; content: string; append: boolean }) => Promise<void>
  readChunk: (options: { uri: string; filename: string; offset: number; length: number }) => Promise<{ data: string; end: boolean }>
  getFileInfo: (options: { uri: string; filename: string }) => Promise<{ size: number }>
  openFilePicker: () => Promise<{ uri: string }>
  readUriChunk: (options: { uri: string; offset: number; length: number }) => Promise<{ data: string; end: boolean }>
  getUriFileInfo: (options: { uri: string }) => Promise<{ size: number }>
  uploadStart: (options: {
    sessionId: string
    url: string
    headers: Record<string, string>
    totalLength: number
  }) => Promise<void>
  uploadChunk: (options: { sessionId: string; content: string }) => Promise<void>
  uploadEnd: (options: { sessionId: string }) => Promise<{ status: number }>
}>('PickDirectory')

export const CHUNK_SIZE = 512 * 1024

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
 * Writes `content` to `filename` inside the SAF directory `uri`, sending each
 * chunk through the bridge separately. The first chunk truncates the file and
 * the following ones append, so a partial write never corrupts a later one.
 */
export async function writeFileChunked(
  uri: string,
  filename: string,
  content: string,
): Promise<void> {
  const total = content.length
  let offset = 0
  let first = true
  while (offset < total) {
    let end = Math.min(offset + CHUNK_SIZE, total)
    // Never split a surrogate pair across chunks, or the UTF-8 round-trip breaks.
    if (end < total) {
      const high = content.charCodeAt(end - 1)
      const low = content.charCodeAt(end)
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        end -= 1
      }
    }
    await PickDirectory.writeChunk({
      uri,
      filename,
      content: content.slice(offset, end),
      append: !first,
    })
    first = false
    offset = end
  }
}

/**
 * PUTs `content` to `url` streaming each chunk through the native plugin
 * (HttpURLConnection). Content never crosses the bridge in a single large call,
 * avoiding the Android OutOfMemoryError for big notebook JSON uploads.
 */
export async function uploadFileStreaming(
  url: string,
  headers: Record<string, string>,
  content: string,
): Promise<number> {
  const sessionId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const totalLength = new TextEncoder().encode(content).length
  await PickDirectory.uploadStart({ sessionId, url, headers, totalLength })
  let offset = 0
  while (offset < content.length) {
    let end = Math.min(offset + CHUNK_SIZE, content.length)
    // Never split a surrogate pair across chunks.
    if (end < content.length) {
      const high = content.charCodeAt(end - 1)
      const low = content.charCodeAt(end)
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        end -= 1
      }
    }
    await PickDirectory.uploadChunk({
      sessionId,
      content: content.slice(offset, end),
    })
    offset = end
  }
  const { status } = await PickDirectory.uploadEnd({ sessionId })
  return status
}

export async function readBackupFileFromDirectory(uri: string, filename: string): Promise<string> {  const { size } = await PickDirectory.getFileInfo({ uri, filename })
  return decodeChunked(size, (offset, length) =>
    PickDirectory.readChunk({ uri, filename, offset, length }),
  )
}

export async function readBackupFileFromUri(uri: string): Promise<string> {
  const { size } = await PickDirectory.getUriFileInfo({ uri })
  return decodeChunked(size, (offset, length) =>
    PickDirectory.readUriChunk({ uri, offset, length }),
  )
}

/** Returns whether `filename` already exists inside the SAF directory `uri`. */
export async function fileExistsInDirectory(uri: string, filename: string): Promise<boolean> {
  try {
    await PickDirectory.getFileInfo({ uri, filename })
    return true
  } catch {
    return false
  }
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
