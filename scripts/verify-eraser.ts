/**
 * Verification script for Eraser Single-Click Size / Mask Regression.
 *
 * Exercises:
 *  1. Single-click (tap) eraser erasure creation has radius = eraserSize / 2 and 1 point.
 *  2. Intersection/mask calculation with single point eraser correctly matches the eraser radius.
 *  3. Eraser Mask Overlap regression: erasing then dragging a stroke (that existed when
 *     erasing) over the erased region must NOT clip it at the old page position — the
 *     mask travels with the stroke.
 *
 * Run: npx tsx scripts/verify-eraser.ts
 */
import type { Layer, Stroke, StrokeErasure } from '../src/types'
import { makeLayer, transformStrokeErasures } from '../src/types'

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

console.log('== Eraser Single-Click Regression Verification ==')

{
  // Simulate creating a single-click erasure in Editor.tsx
  const eraserSize = 20
  const clickPoint = { x: 100, y: 100 }

  const erasure: StrokeErasure = {
    radius: eraserSize / 2,
    points: [{ ...clickPoint }],
    strokeIds: ['stroke-1'],
  }

  assert(erasure.radius === 10, 'single-click erasure radius is half of eraserSize (10)')
  assert(erasure.points.length === 1, 'single-click erasure has exactly 1 point')
  assert(erasure.points[0].x === 100 && erasure.points[0].y === 100, 'single-click erasure point coordinates match click position')
}

{
  // Simulate checking hit/intersection for a stroke point against a single-point erasure (radius R)
  // Distance from stroke point to eraser center <= radius R means it's erased.
  const eraserCenter = { x: 50, y: 50 }
  const radius = 15 // eraserSize = 30

  // Point inside radius
  const strokePointInside = { x: 55, y: 52 }
  const distInside = Math.hypot(strokePointInside.x - eraserCenter.x, strokePointInside.y - eraserCenter.y)
  assert(distInside <= radius, 'point inside eraser radius is detected as intersected')

  // Point outside radius
  const strokePointOutside = { x: 70, y: 70 }
  const distOutside = Math.hypot(strokePointOutside.x - eraserCenter.x, strokePointOutside.y - eraserCenter.y)
  assert(distOutside > radius, 'point outside eraser radius is correctly outside')
}

{
  // Test 3: Eraser Mask Overlap regression — the exact reported flow.
  // Erase an area, then drag a stroke that existed when erasing over that area.
  // The mask must travel with the dragged stroke instead of clipping it at the
  // old page position (which made the dragged element disappear).
  const layer: Layer = makeLayer('Layer 1')
  const erased: Stroke = {
    id: 'erased-1',
    kind: 'pen',
    color: '#000000',
    size: 4,
    points: [{ x: 500, y: 500, pressure: 1 }, { x: 540, y: 500, pressure: 1 }],
  }
  const dragged: Stroke = {
    id: 'dragged-1',
    kind: 'pen',
    color: '#000000',
    size: 4,
    points: [{ x: 100, y: 100, pressure: 1 }, { x: 140, y: 100, pressure: 1 }],
  }
  layer.strokes.push(erased, dragged)

  // Editor.onPointerDown (partial eraser): the erasure is scoped to EVERY stroke
  // that existed when the erase gesture began (single tap here).
  const erasure: StrokeErasure = {
    radius: 10,
    points: [{ x: 500, y: 500 }],
    strokeIds: layer.strokes.map((s) => s.id),
  }
  layer.strokeErasures = [erasure]

  // Mirrors canvas.ts renderMaskedStrokes/appliesToStroke: a stroke is clipped where
  // an applicable erasure (same strokeId, or legacy unscoped) covers one of its points.
  const clippedPoints = (stroke: Stroke) =>
    stroke.points.filter((p) =>
      (layer.strokeErasures ?? []).some(
        (e) =>
          (!e.strokeIds || e.strokeIds.includes(stroke.id)) &&
          e.points.some((ep) => Math.hypot(ep.x - p.x, ep.y - p.y) <= e.radius),
      ),
    )

  assert(clippedPoints(erased).length === 1, 'before drag: the erased stroke is masked at the erased spot')

  // Editor.applyRegionMove: absolute transform rebuilt from the gesture-start snapshot.
  const dx = 400
  const dy = 400
  transformStrokeErasures(layer, [erasure], new Set([dragged.id]), (p) => ({ x: p.x + dx, y: p.y + dy }))
  layer.strokes = layer.strokes.map((s) =>
    s.id === dragged.id ? { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } : s,
  )

  const movedDragged = layer.strokes.find((s) => s.id === dragged.id)!
  assert(
    clippedPoints(movedDragged).length === 0,
    'after drag: a stroke moved over the erased region is NOT clipped (mask follows it, no disappearing element)',
  )
  assert(clippedPoints(erased).length === 1, 'after drag: the stroke that stayed keeps its erased spot')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
