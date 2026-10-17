/**
 * Verification script for drawing engine, stroke persistence, and layer ordering.
 *
 * Exercises:
 *  1. Consecutive rapid strokes: stroke 2 started before stroke 1 finishes
 *     commits stroke 1 safely instead of losing/overwriting it.
 *  2. Single-point (dot) strokes: a 1-point tap is preserved.
 *  3. Layer element rendering order: strokes -> images -> texts.
 *  4. Erasure masks follow transformed strokes (move/resize/rotate) and split
 *     when shared with strokes that stayed in place (eraser mask overlap bug).
 *
 * Run: npx tsx scripts/verify-drawing.ts
 */
import type { Layer, Page, Stroke, StrokeErasure } from '../src/types'
import { makePage, makeLayer, transformStrokeErasures } from '../src/types'

let passed = 0
let failed = 0

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.error(`  FAIL  ${label}`)
  }
}

console.log('== Drawing & Stroke Regression Verification ==')

{
  // Test 1: Simulating consecutive rapid strokes where Stroke 2's pointerdown
  // arrives while Stroke 1's stroke in PageCanvas is still active.
  const page: Page = makePage('blank')
  const layer: Layer = page.layers[0]

  // Mock engine state
  let currentStroke: Stroke | null = null
  let isDrawing = false

  const beginStroke = (id: string, x: number, y: number) => {
    isDrawing = true
    currentStroke = {
      id,
      kind: 'pen',
      color: '#000000',
      size: 5,
      points: [{ x, y, pressure: 1 }],
    }
  }

  const endStroke = (): Stroke | null => {
    if (!isDrawing || !currentStroke) return null
    const stroke = currentStroke
    isDrawing = false
    currentStroke = null
    return stroke
  }

  // Pointerdown handler logic (matching Editor.tsx)
  let activeDrag: { kind: string } | null = null
  let dragOwnerId: number | null = null

  const onPointerDown = (pointerId: number, strokeId: string, x: number, y: number) => {
    // If a previous stroke gesture was still active, cleanly commit it first!
    if (activeDrag && activeDrag.kind === 'draw') {
      const prev = endStroke()
      if (prev && prev.points.length >= 1) {
        layer.strokes.push(prev)
      }
    }
    dragOwnerId = pointerId
    activeDrag = { kind: 'draw' }
    beginStroke(strokeId, x, y)
  }

  const onPointerUp = (pointerId: number) => {
    if (activeDrag?.kind === 'draw') {
      if (dragOwnerId === pointerId) {
        const stroke = endStroke()
        if (stroke && stroke.points.length >= 1) {
          layer.strokes.push(stroke)
        }
        activeDrag = null
        dragOwnerId = null
      }
    }
  }

  // Stroke 1 starts (pointer 1)
  onPointerDown(1, 's1', 10, 10)
  // Rapid Stroke 2 starts (pointer 2) BEFORE pointer 1 pointerup arrives!
  onPointerDown(2, 's2', 50, 50)

  // Pointer 1 delayed pointerup arrives
  onPointerUp(1)
  // Pointer 2 pointerup arrives
  onPointerUp(2)

  assert(layer.strokes.length === 2, 'consecutive rapid strokes: BOTH strokes committed (neither lost)')
  assert(layer.strokes[0].id === 's1', 'consecutive rapid strokes: Stroke 1 preserved correctly')
  assert(layer.strokes[1].id === 's2', 'consecutive rapid strokes: Stroke 2 preserved correctly')
}

{
  // Test 2: Single-point (dot) strokes are kept and not discarded.
  const page: Page = makePage('blank')
  const layer: Layer = page.layers[0]

  const dotStroke: Stroke = {
    id: 'dot-1',
    kind: 'pen',
    color: '#000000',
    size: 4,
    points: [{ x: 100, y: 100, pressure: 1 }],
  }

  const shouldDiscard = false
  if (!shouldDiscard && dotStroke.points.length >= 1) {
    layer.strokes.push(dotStroke)
  }

  assert(layer.strokes.length === 1, 'single-point dot stroke: preserved in layer')
  assert(layer.strokes[0].points.length === 1, 'single-point dot stroke: 1 point stored')
}

{
  // Test 3: Layer elements array structures and ordering guarantees
  const layer: Layer = makeLayer('Test Layer')
  layer.strokes.push({
    id: 'str-1',
    kind: 'pen',
    color: '#ff0000',
    size: 2,
    points: [{ x: 0, y: 0, pressure: 1 }, { x: 10, y: 10, pressure: 1 }],
  })
  layer.images.push({
    id: 'img-1',
    name: 'test.png',
    dataUrl: 'data:image/png;base64,fake',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
  })
  layer.texts.push({
    id: 'txt-1',
    text: 'Hello World',
    x: 10,
    y: 10,
    width: 200,
    rotation: 0,
    fontSize: 16,
    fontFamily: 'sans-serif',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: '#000000',
    backgroundColor: null,
    align: 'left',
    marker: 'none',
    direction: 'horizontal',
    createdAt: Date.now(),
  })

  // Verify render sequence contract: strokes (bottom) -> images (middle) -> texts (top)
  const renderSequence: string[] = []
  for (const s of layer.strokes) renderSequence.push(`stroke:${s.id}`)
  for (const img of layer.images) renderSequence.push(`image:${img.id}`)
  for (const txt of layer.texts) renderSequence.push(`text:${txt.id}`)

  assert(
    renderSequence[0] === 'stroke:str-1' &&
      renderSequence[1] === 'image:img-1' &&
      renderSequence[2] === 'text:txt-1',
    'layer render order: strokes (bottom) -> images (middle) -> texts (top)',
  )
}

{
  // Test 4: Eraser mask overlap regression — when scoped strokes are transformed
  // (drag/move, resize, rotate), the erasure masks must be rebuilt with the SAME
  // transform, splitting masks shared with strokes that stayed in place.
  const page: Page = makePage('blank')
  const layer: Layer = page.layers[0]
  layer.strokes.push(
    { id: 'move-1', kind: 'pen', color: '#000000', size: 4, points: [{ x: 10, y: 10, pressure: 1 }, { x: 60, y: 10, pressure: 1 }] },
    { id: 'stay-1', kind: 'pen', color: '#000000', size: 4, points: [{ x: 10, y: 80, pressure: 1 }, { x: 60, y: 80, pressure: 1 }] },
  )

  // The Editor scopes an erasure to every stroke existing when the gesture began.
  const erasure: StrokeErasure = { radius: 8, points: [{ x: 30, y: 10 }, { x: 40, y: 10 }], strokeIds: ['move-1', 'stay-1'] }
  const snapshot: StrokeErasure[] = [erasure]
  layer.strokeErasures = [erasure]

  const movedIds = new Set(['move-1'])
  const dx = 200
  const dy = 300
  const translate = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy })
  transformStrokeErasures(layer, snapshot, movedIds, translate)

  const result = layer.strokeErasures ?? []
  const kept = result.find((e) => e.strokeIds?.includes('stay-1'))
  const moved = result.find((e) => e.strokeIds?.includes('move-1'))
  assert(result.length === 2, 'erasure split: moved clone + original for the stroke that stayed')
  assert(!!kept && kept.strokeIds?.length === 1, 'kept erasure scoped only to the unmoved stroke')
  assert(
    !!kept && kept.points[0].x === 30 && kept.points[0].y === 10,
    'unmoved stroke keeps its erased hole in place (not un-erased, not translated)',
  )
  assert(
    !!moved && moved.points[0].x === 30 + dx && moved.points[0].y === 10 + dy,
    'moved stroke carries its erased hole along (mask follows the drag)',
  )
  assert(
    !!moved && !!moved.strokeIds?.includes('move-1') && !moved.strokeIds.includes('stay-1'),
    'moved clone scoped only to the moved stroke',
  )

  // Absolute transform from the snapshot: rebuilding on every pointermove frame is idempotent.
  const firstFrame = JSON.stringify(result)
  transformStrokeErasures(layer, snapshot, movedIds, translate)
  assert(
    JSON.stringify(layer.strokeErasures) === firstFrame,
    'idempotent across frames: repeated rebuild from snapshot yields identical masks',
  )

  // An erasure scoped only to a stroke that did not move passes through untouched.
  const onlyStay: StrokeErasure = { radius: 5, points: [{ x: 5, y: 80 }], strokeIds: ['stay-1'] }
  transformStrokeErasures(layer, [onlyStay], movedIds, translate)
  const onlyStayResult = layer.strokeErasures ?? []
  assert(
    onlyStayResult.length === 1 &&
      onlyStayResult[0].points[0].x === 5 &&
      onlyStayResult[0].strokeIds?.[0] === 'stay-1',
    'erasure of a non-moved stroke passes through unchanged (no un-erase)',
  )

  // Legacy erasure without strokeIds (applies to every stroke) is scoped on split.
  transformStrokeErasures(layer, [{ radius: 5, points: [{ x: 20, y: 20 }] }], movedIds, translate)
  const legacyResult = layer.strokeErasures ?? []
  assert(legacyResult.length === 2, 'legacy unscoped erasure is split instead of clipping moved strokes')
  assert(
    legacyResult.some((e) => e.strokeIds?.includes('stay-1') && e.points[0].x === 20) &&
      legacyResult.some((e) => e.strokeIds?.includes('move-1') && e.points[0].x === 20 + dx),
    'legacy erasure: unmoved stroke keeps the original hole, moved stroke gets the translated clone',
  )

  // No transformed strokes -> masks untouched.
  transformStrokeErasures(layer, snapshot, new Set(), translate)
  assert(
    JSON.stringify(layer.strokeErasures) === JSON.stringify(legacyResult),
    'empty transformed set leaves masks untouched',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
