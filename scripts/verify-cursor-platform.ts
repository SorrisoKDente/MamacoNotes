import {
  isMousePointer,
  isPenPointer,
  isToolCursorHidden,
  isTouchPointer,
  shouldShowToolCursor,
  shouldUseCursorOnlyPointerPath,
} from '../src/utils/cursor'
import { shouldShowFullscreen } from '../src/utils/platform'
import type { ToolKind } from '../src/types'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

console.log('== Cursor and Fullscreen Regression Verification ==')

for (const tool of ['pen', 'highlighter', 'eraser'] as ToolKind[]) {
  assert(
    shouldUseCursorOnlyPointerPath(tool, 'mouse', false),
    `${tool} hover uses the lightweight cursor path`,
  )
  assert(
    !shouldUseCursorOnlyPointerPath(tool, 'mouse', true),
    `${tool} drag keeps the drawing path`,
  )
}

assert(!shouldUseCursorOnlyPointerPath('select', 'mouse', false), 'select hover keeps selection hit testing')
assert(!shouldUseCursorOnlyPointerPath('pen', 'touch', false), 'touch input keeps gesture processing')
assert(isMousePointer('mouse') && isMousePointer(''), 'mouse pointer variants are recognized')
assert(isPenPointer('pen'), 'pen pointer is recognized separately')
assert(isTouchPointer('touch'), 'touch pointer is recognized separately')
const cursorSettings = {
  hideToolCursor: false,
  hidePenCursor: false,
  hideHighlighterCursor: true,
  hideEraserCursor: false,
}
assert(!isToolCursorHidden('pen', cursorSettings), 'pen cursor remains visible when enabled')
assert(isToolCursorHidden('highlighter', cursorSettings), 'highlighter cursor follows its individual setting')
assert(!isToolCursorHidden('eraser', cursorSettings), 'eraser cursor remains visible when enabled')
assert(isToolCursorHidden('pen', { ...cursorSettings, hideToolCursor: true }), 'master cursor setting hides every tool')
assert(shouldShowToolCursor('pen', true, false), 'tool cursor is shown outside pan mode')
assert(!shouldShowToolCursor('pen', true, true), 'tool cursor is hidden while pan shortcut is active')
assert(!shouldShowToolCursor('text', true, false), 'non-drawing tools do not show tool cursor')

const originalWindow = globalThis.window
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { Capacitor: { isNativePlatform: () => false } },
})
assert(shouldShowFullscreen(), 'browser fullscreen is enabled')

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { Capacitor: { isNativePlatform: () => true } },
})
assert(!shouldShowFullscreen(), 'native fullscreen button remains hidden')

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: originalWindow,
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
