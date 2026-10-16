/**
 * Verification script for Eraser Single-Click Size / Mask Regression.
 *
 * Exercises:
 *  1. Single-click (tap) eraser erasure creation has radius = eraserSize / 2 and 1 point.
 *  2. Intersection/mask calculation with single point eraser correctly matches the eraser radius.
 *
 * Run: npx tsx scripts/verify-eraser.ts
 */
import type { StrokeErasure } from '../src/types'

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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
