export function isNativePlatform(): boolean {
  const capacitorGlobal = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
  // Check both the function call and the presence of the Capacitor object
  return !!(
    (capacitorGlobal.Capacitor && capacitorGlobal.Capacitor.isNativePlatform && capacitorGlobal.Capacitor.isNativePlatform()) ||
    capacitorGlobal.Capacitor
  )
}

export function isElectron(): boolean {
  return !!(window as any).inkfolioDesktop
}

/**
 * Returns true if the fullscreen button should be shown.
 * It should show on Web (PWA) and Desktop (Electron), but NOT on native mobile apps (APK).
 */
export function shouldShowFullscreen(): boolean {
  // If it's native (Android APK via Capacitor), hide it because native handling is better or F11 doesn't make sense.
  if (isNativePlatform()) {
    return false
  }
  // Show on Web or Electron
  return true
}
