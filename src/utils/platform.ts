export function isNativePlatform(): boolean {
  const capacitorGlobal = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
  if (!capacitorGlobal.Capacitor) return false
  if (typeof capacitorGlobal.Capacitor.isNativePlatform === 'function') {
    return capacitorGlobal.Capacitor.isNativePlatform()
  }
  return true
}

export function isDesktop(): boolean {
  return !!(window as any).inkfolioDesktop
}

/**
 * Returns true if the fullscreen button should be shown.
 * It should show only in the browser/PWA, not in Electron or native mobile apps.
 */
export function shouldShowFullscreen(): boolean {
  // Capacitor is present in the browser build too, but reports false there.
  if (isNativePlatform()) {
    return false
  }
  return true
}
