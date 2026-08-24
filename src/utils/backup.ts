import { Capacitor } from '@capacitor/core'
import { Directory } from '@capacitor/filesystem'
import write_blob from 'capacitor-blob-writer'
import type { AppSettings, Folder, Notebook } from '../types'
import { writeFileChunked, pickBackupFile } from './chunkedIo'

const BACKUP_FILENAME = 'mamaco-notes-backup.json'

export interface BackupPayload {
  app: string
  exportedAt: string
  folders: Folder[]
  notebooks: Notebook[]
  settings: AppSettings | null
}

interface DesktopBridge {
  saveFile?: (defaultName: string, content: string) => Promise<boolean>
  openFile?: () => Promise<string | null>
}

function desktop(): DesktopBridge {
  return (window as unknown as { inkfolioDesktop?: DesktopBridge }).inkfolioDesktop ?? {}
}

export function sanitizeSettingsForBackup(settings: AppSettings | null | undefined): AppSettings | null {
  if (!settings) return null
  return {
    ...settings,
    saveDirectoryHandle: null,
    saveDirectory: '',
    cloud: {
      ...settings.cloud,
      webdavPassword: '', // Never export the cloud password for security reasons
    },
  }
}

export function buildBackupPayload(
  folders: Folder[],
  notebooks: Notebook[],
  settings?: AppSettings | null,
): BackupPayload {
  return {
    app: 'Mamaco Notes',
    exportedAt: new Date().toISOString(),
    folders,
    notebooks,
    settings: sanitizeSettingsForBackup(settings),
  }
}

export async function exportBackup(
  folders: Folder[],
  notebooks: Notebook[],
  settings?: AppSettings | null,
): Promise<boolean> {
  const payload = JSON.stringify(buildBackupPayload(folders, notebooks, settings))

  if (desktop().saveFile) {
    try {
      return await desktop().saveFile!(BACKUP_FILENAME, payload)
    } catch {
      return false
    }
  }

  // Mobile (Android / iOS): write to the SAF directory chosen by the user, or
  // fall back to the app Documents folder. Both paths stream the content in
  // chunks instead of sending the whole JSON through the Capacitor bridge —
  // Filesystem.writeFile or a custom plugin with a large content string crashes
  // with OutOfMemoryError on Android for big backups (images/PDFs stored as
  // data URLs).
  if (Capacitor.isNativePlatform()) {
    try {
      const dir = settings?.saveDirectory
      if (dir && dir.startsWith('content://')) {
        await writeFileChunked(dir, BACKUP_FILENAME, payload)
      } else {
        await write_blob({
          path: BACKUP_FILENAME,
          directory: Directory.Documents,
          blob: new Blob([payload], { type: 'application/json' }),
          recursive: true,
        })
      }
      return true
    } catch (err) {
      console.error('Failed to export native backup:', err)
      return false
    }
  }

  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = BACKUP_FILENAME
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}

export function parseBackup(text: string): BackupPayload | null {
  try {
    const data = JSON.parse(text)
    if (!data || !Array.isArray(data.notebooks) || !Array.isArray(data.folders)) return null
    return {
      app: data.app ?? 'Mamaco Notes',
      exportedAt: data.exportedAt ?? '',
      folders: data.folders,
      notebooks: data.notebooks,
      settings: data.settings ?? null,
    }
  } catch {
    return null
  }
}

export async function importBackup(): Promise<BackupPayload | null> {
  if (desktop().openFile) {
    try {
      const content = await desktop().openFile!()
      if (!content) return null
      return parseBackup(content)
    } catch {
      return null
    }
  }

  // Mobile (Android / iOS): open the system document picker and read the file
  // in chunks through the native plugin to avoid loading a big backup fully in
  // the WebView memory.
  if (Capacitor.isNativePlatform()) {
    const content = await pickBackupFile()
    if (!content) return null
    return parseBackup(content)
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      file
        .text()
        .then((text) => resolve(parseBackup(text)))
        .catch(() => resolve(null))
    }
    input.click()
  })
}
