import type { ShortcutActionId, ShortcutMap } from '../types'
import { t } from '../i18n'

export function normalizeKey(e: KeyboardEvent): string {
  let key = e.key.toLowerCase()
  if (key === 'control') key = 'ctrl'
  else if (key === ' ') key = 'space'
  else if (key === '+') key = '='
  else if (key === 'arrowup') key = 'up'
  else if (key === 'arrowdown') key = 'down'
  else if (key === 'arrowleft') key = 'left'
  else if (key === 'arrowright') key = 'right'
  else if (key === 'escape') key = 'esc'

  const isModifier = key === 'ctrl' || key === 'shift' || key === 'alt' || key === 'meta'
  if (isModifier) return key

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  if (parts.length === 0) return key
  const filteredParts = parts.filter((p) => p !== key)
  if (filteredParts.length === 0) return key
  return filteredParts.join('+') + '+' + key
}

export function findShortcutAction(
  shortcuts: ShortcutMap,
  normalized: string,
): ShortcutActionId | null {
  for (const [action, shortcut] of Object.entries(shortcuts) as [ShortcutActionId, string][]) {
    if (shortcut.toLowerCase() === normalized) return action
  }
  return null
}

export function shortcutLabel(action: ShortcutActionId): string {
  return t('shortcut.' + action)
}
