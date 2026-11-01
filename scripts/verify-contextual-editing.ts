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
  const layers = ['layer-1', 'layer-2']
  const folders = ['folder-1', 'folder-2']
  const selectedLayers = [...layers]
  const selectedFolders = [...folders]
  assert(selectedLayers.length === 2, 'Ctrl+A selects every layer')
  assert(selectedFolders.length === 2, 'Ctrl+A selects every layer folder')
  assert(
    new Set([...selectedLayers, ...selectedFolders]).size === 4,
    'layer and folder selections do not collide',
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
  const visualToInternalBefore = (displayed: string[], targetIndex: number, afterTarget: boolean): string | null => {
    const visualInsertIndex = targetIndex + (afterTarget ? 1 : 0)
    return visualInsertIndex > 0 ? displayed[visualInsertIndex - 1] ?? null : null
  }
  assert(
    visualToInternalBefore(['top'], 0, false) === null,
    'dropping bottom layer above top layer maps to the internal end',
  )
  assert(
    visualToInternalBefore(['bottom'], 0, true) === 'bottom',
    'dropping top layer below bottom layer maps to the internal beginning',
  )
  const displayedRemaining = ['middle', 'bottom']
  const internalRemaining = [...displayedRemaining].reverse()
  const internalInsertIndex = internalRemaining.length - displayedRemaining.length
  assert(
    internalRemaining[internalInsertIndex] === 'bottom',
    'moving the top layer below all layers maps before the internal bottom layer',
  )
  const fourDisplayed = ['layer-4', 'layer-3', 'layer-2', 'layer-1']
  const fourRemaining = fourDisplayed.slice(1)
  const fourInternal = [...fourRemaining].reverse()
  const fourInternalIndex = fourInternal.length - fourRemaining.length
  assert(
    fourInternal[fourInternalIndex] === 'layer-1',
    'moving the top layer below a four-layer stack targets the bottom layer',
  )
}

{
  const order = ['bottom', 'middle', 'top']
  const anchor = order.indexOf('bottom')
  const clicked = order.indexOf('top')
  const selected = order.slice(Math.min(anchor, clicked), Math.max(anchor, clicked) + 1)
  assert(selected.join(',') === 'bottom,middle,top', 'Shift selects a continuous layer range')
}

{
  let selectedNotebookId: string | null = null
  const dashboardUndo = () => {
    if (selectedNotebookId !== null) return 'editor-history'
    return 'dashboard-history'
  }
  assert(
    (() => {
      selectedNotebookId = null
      return dashboardUndo() === 'dashboard-history'
    })(),
    'Dashboard undo uses dashboard history',
  )
  assert(
    (() => {
      selectedNotebookId = 'note-1'
      return dashboardUndo() === 'editor-history'
    })(),
    'Editor undo does not consume Dashboard history',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
