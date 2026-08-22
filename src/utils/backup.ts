import type { AppSettings, Folder, Notebook } from '../types'

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
  return { ...settings, saveDirectoryHandle: null, saveDirectory: '' }
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
  const payload = JSON.stringify(buildBackupPayload(folders, notebooks, settings), null, 2)

  if (desktop().saveFile) {
    try {
      return await desktop().saveFile!(BACKUP_FILENAME, payload)
    } catch {
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
