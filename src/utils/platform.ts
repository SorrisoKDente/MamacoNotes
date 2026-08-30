export function isNativePlatform(): boolean {
  const capacitorGlobal = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean }
  }
  return !!capacitorGlobal.Capacitor?.isNativePlatform?.()
}

/**
 * Returns true if the fullscreen button should be shown.
 * It should show on Web (PWA) even on mobile, but NOT on native mobile apps (APK).
 */
export function shouldShowFullscreen(): boolean {
  // If it's native (Android APK via Capacitor), hide it because native handling is better or F11 doesn't make sense.
  if (isNativePlatform()) {
    return false
  }
  return true
}
