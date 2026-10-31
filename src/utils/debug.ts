/**
 * Tiny always-on trace ring buffer for hard-to-reproduce drawing bugs
 * (e.g. "the second stroke disappears"). Recording a few hundred strings is
 * free; nothing is printed unless `localStorage.mamaco.debug === '1'`.
 *
 * In DevTools: `__mamacoLog()` dumps the buffer, `localStorage.mamaco.debug='1'`
 * (then reproduce) also mirrors every entry to the console.
 */
const MAX = 400
const events: string[] = []
const started = typeof performance !== 'undefined' ? performance.now() : 0

function mirror(): boolean {
  try {
    return localStorage.getItem('mamaco.debug') === '1'
  } catch {
    return false
  }
}

export function trace(...parts: unknown[]): void {
  const t = ((performance.now() - started) / 1000).toFixed(3)
  const line = `${t}s ${parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' ')}`
  events.push(line)
  if (events.length > MAX) events.shift()
  if (mirror()) console.log('[mamaco]', line)
}

export function dumpTrace(): string[] {
  return events.slice()
}

if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__mamacoLog = dumpTrace
}
