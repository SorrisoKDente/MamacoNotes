import { APP_VERSION } from '../types'

export interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
}

export interface UpdateInfo {
  available: boolean
  latestVersion: string
  releaseNotes: string
  url: string
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  // If desktop, use the Electron bridge to check
  if (window.inkfolioDesktop) {
    const res = await window.inkfolioDesktop.checkForUpdates()
    if (!res || !res.updateInfo) return null
    const latestVersion = res.updateInfo.version
    return {
      available: isNewerVersion(latestVersion, APP_VERSION),
      latestVersion,
      releaseNotes: res.updateInfo.releaseNotes || '',
      url: 'https://github.com/SorrisoKDente/MamacoNotes/releases/latest',
    }
  }

  try {
    const response = await fetch(
      'https://api.github.com/repos/SorrisoKDente/MamacoNotes/releases/latest',
    )
    if (!response.ok) return null

    const data: GitHubRelease = await response.json()
    const latestVersion = data.tag_name.replace(/^v/, '')

    return {
      available: isNewerVersion(latestVersion, APP_VERSION),
      latestVersion,
      releaseNotes: data.body,
      url: data.html_url,
    }
  } catch (err) {
    console.error('Failed to check for updates:', err)
    return null
  }
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number)
  const currentParts = current.split('.').map(Number)

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const latestPart = latestParts[i] || 0
    const currentPart = currentParts[i] || 0
    if (latestPart > currentPart) return true
    if (latestPart < currentPart) return false
  }
  return false
}
