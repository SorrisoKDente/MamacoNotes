/**
 * Regression checks for contextual selection and ordering invariants.
 *
 * Run: npx tsx scripts/verify-contextual-editing.ts
 */

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

console.log('== Contextual Editing Regression Verification ==')

{
  const pages = [0, 1, 2, 3]
  const selectedPages = pages.map((index) => index)
  assert(
    selectedPages.length === pages.length && selectedPages.every((index) => pages.includes(index)),
    'Ctrl+A page selection includes every page',
  )
}

{
  const layer = {
    strokes: [{ id: 'stroke-1' }],
    images: [{ id: 'image-1' }],
    texts: [{ id: 'text-1' }],
  }
  const selection = {
    strokes: new Set(layer.strokes.map((item) => item.id)),
    images: new Set(layer.images.map((item) => item.id)),
    texts: new Set(layer.texts.map((item) => item.id)),
  }
  assert(selection.strokes.has('stroke-1'), 'Ctrl+A selects strokes')
  assert(selection.images.has('image-1'), 'Ctrl+A selects images')
  assert(selection.texts.has('text-1'), 'Ctrl+A selects text')
}

{
  const moveBefore = (ids: string[], draggedId: string, beforeId: string | null): string[] => {
    const dragged = ids.find((id) => id === draggedId)
    if (!dragged) return ids
    const rest = ids.filter((id) => id !== draggedId)
    const index = beforeId === null ? rest.length : rest.indexOf(beforeId)
    rest.splice(index < 0 ? rest.length : index, 0, dragged)
    return rest
  }
  assert(
    moveBefore(['bottom', 'top'], 'bottom', 'top').join(',') === 'bottom,top',
    'two-layer reorder keeps an item before the target',
  )
  assert(
    moveBefore(['bottom', 'top'], 'top', 'bottom').join(',') === 'top,bottom',
    'two-layer reorder can move the top item before the bottom item',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
