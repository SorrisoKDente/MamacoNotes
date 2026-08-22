export function isFullscreen(): boolean {
  return !!document.fullscreenElement
}

export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
    } else {
      await document.documentElement.requestFullscreen()
    }
    return true
  } catch {
    return false
  }
}
