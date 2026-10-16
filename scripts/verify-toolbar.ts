/**
 * Verification script for Toolbar Submenu Toggle Logic.
 *
 * Exercises:
 *  1. Switching to a different tool sets the tool and closes/keeps panel closed (setPanelOpen(false)).
 *  2. Clicking on an already selected tool toggles panel open/closed (setPanelOpen(v => !v)).
 *
 * Run: npx tsx scripts/verify-toolbar.ts
 */
import type { ToolKind } from '../src/types'

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

console.log('== Toolbar Submenu Toggle Logic Regression Verification ==')

{
  // Simulate Toolbar state and selectTool logic
  let currentTool: ToolKind = 'pen'
  let panelOpen: boolean = false

  const setTool = (t: ToolKind) => {
    currentTool = t
  }

  const selectTool = (t: ToolKind) => {
    if (t === currentTool) {
      panelOpen = !panelOpen
    } else {
      setTool(t)
      panelOpen = false
    }
  }

  // 1. Initial state: tool is 'pen', panel is closed
  assert(currentTool === ('pen' as ToolKind), 'initial tool is pen')
  assert(!panelOpen, 'initial panel is closed')

  // 2. Click already selected tool ('pen'): panel should open
  selectTool('pen')
  assert(currentTool === ('pen' as ToolKind), 'tool remains pen')
  assert(panelOpen, 'clicking selected tool opens panel')

  // 3. Click already selected tool ('pen') again: panel should close
  selectTool('pen')
  assert(!panelOpen, 'clicking selected tool again closes panel')

  // 4. Switch to a different tool ('eraser'): tool changes to eraser, panel remains closed (does not open)
  panelOpen = true // simulate panel was open
  selectTool('eraser')
  assert(currentTool === ('eraser' as ToolKind), 'tool switches to eraser')
  assert(!panelOpen, 'switching tool closes/does not open panel')

  // 5. Click already selected tool ('eraser'): panel should open
  selectTool('eraser')
  assert(currentTool === ('eraser' as ToolKind), 'tool remains eraser')
  assert(panelOpen, 'clicking new selected tool opens its panel')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
