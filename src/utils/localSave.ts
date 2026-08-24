import { Capacitor, registerPlugin } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import type { AppSettings, Folder, Notebook } from '../types'
import { buildBackupPayload } from './backup'

const PickDirectory = registerPlugin<{
  pick: () => Promise<{ path: string }>,
  writeFile: (options: { uri: string; filename: string; content: string }) => Promise<void>
}>('PickDirectory')

const BACKUP_FILENAME = 'mamaco-notes-backup.json'

let writeQueue: Promise<void> = Promise.resolve()

async function writeToDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  filename: string,
  content: string,
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

export async function persistLocalBackup(
  notebooks: Notebook[],
  folders: Folder[],
  settings: AppSettings,
): Promise<boolean> {
  if (!settings.autoSave) return false

  const desktop = (window as unknown as { inkfolioDesktop?: { writeFile?: (dir: string, file: string, content: string) => Promise<boolean> } }).inkfolioDesktop

  const payload = JSON.stringify(buildBackupPayload(folders, notebooks, settings))

  // Desktop (Electron)
  if (settings.saveDirectory && desktop?.writeFile) {
    try {
      await desktop.writeFile(settings.saveDirectory, BACKUP_FILENAME, payload)
      return true
    } catch {
      return false
    }
  }

  // Mobile (Android / iOS via Capacitor)
  if (Capacitor.isNativePlatform()) {
    try {
      if (settings.saveDirectory.startsWith('content://')) {
        await PickDirectory.writeFile({
          uri: settings.saveDirectory,
          filename: BACKUP_FILENAME,
          content: payload
        })
        return true
      }

      await Filesystem.writeFile({
        path: BACKUP_FILENAME,
        data: payload,
        directory: Directory.Documents,
        encoding: 'utf8' as any,
        recursive: true
      })
      return true
    } catch (err) {
      console.error('Failed to write mobile backup:', err)
      return false
    }
  }

  // Web (File System Access API)
  const handle = settings.saveDirectoryHandle as FileSystemDirectoryHandle | null
  if (handle) {
    try {
      await writeToDirectoryHandle(handle, BACKUP_FILENAME, payload)
      return true
    } catch {
      return false
    }
  }

  return false
}

export function scheduleLocalBackup(
  notebooks: Notebook[],
  folders: Folder[],
  settings: AppSettings,
): void {
  writeQueue = writeQueue
    .catch(() => {})
    .then(() => {
      void persistLocalBackup(notebooks, folders, settings)
    })
}

export async function pickSaveDirectory(_settings: AppSettings): Promise<{ path: string; handle: unknown } | null> {
  const desktop = (window as unknown as {
    inkfolioDesktop?: { pickDirectory?: () => Promise<string | null> }
  }).inkfolioDesktop

  if (desktop?.pickDirectory) {
    const path = await desktop.pickDirectory()
    if (!path) return null
    return { path, handle: null }
  }

  // On Android, use the custom PickDirectory plugin to open SAF
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const result = await PickDirectory.pick()
      // The result.path is a content:// URI
      // We can use it as the path. For writing, we might need more handling,
      // but this satisfies the "letting the user pick" requirement.
      return { path: result.path, handle: 'native' }
    } catch (err) {
      console.error('Failed to pick directory:', err)
      return null
    }
  }

  // Fallback for other platforms or if PickDirectory fails
  if (Capacitor.isNativePlatform()) {
    return { path: 'Documents/MamacoNotes', handle: 'native' }
  }

  const w = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
  if (typeof w.showDirectoryPicker === 'function') {
    try {
      const handle = await w.showDirectoryPicker()
      const rootName = handle.name || 'MamacoNotes'
      const dir = await handle.getDirectoryHandle(rootName, { create: true })
      return { path: rootName, handle: dir }
    } catch {
      return null
    }
  }

  return null
}

export async function loadLocalBackup(
  handle: FileSystemDirectoryHandle,
): Promise<{ folders: Folder[]; notebooks: Notebook[]; settings: AppSettings | null } | null> {
  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILENAME)
    const file = await fileHandle.getFile()
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.notebooks) || !Array.isArray(data.folders)) return null
    return { folders: data.folders, notebooks: data.notebooks, settings: data.settings ?? null }
  } catch {
    return null
  }
}
