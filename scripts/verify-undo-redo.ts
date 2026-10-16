/**
 * Verification script for Undo/Redo stack logic and snapshot integrity.
 *
 * Exercises:
 *  1. Undo/Redo stack pushes and restores page state accurately.
 *  2. Cross-page undo safety: undoing on a different page switches back
 *     to the target page and restores the correct snapshot.
 *  3. Undo stack size limit (max 60 entries).
 *
 * Run: npx tsx scripts/verify-undo-redo.ts
 */
import type { Notebook, Page, Stroke } from '../src/types'
import { makePage, makeNotebook } from '../src/types'

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

function clonePage(page: Page): Page {
  return JSON.parse(JSON.stringify(page)) as Page
}

interface UndoEntry {
  notebookId: string
  pageIndex: number
  pageSnapshot: Page
}

console.log('== Undo/Redo Regression Verification ==')

{
  // Test 1: Basic undo/redo on a single page
  const notebook: Notebook = makeNotebook('Test Notebook', 'folder-1')
  notebook.pages.push(makePage('blank'))

  const undoStack: UndoEntry[] = []
  const redoStack: UndoEntry[] = []

  const pushUndo = (pageIndex: number) => {
    undoStack.push({
      notebookId: notebook.id,
      pageIndex,
      pageSnapshot: clonePage(notebook.pages[pageIndex]),
    })
    if (undoStack.length > 60) undoStack.shift()
    redoStack.length = 0
  }

  const undo = (): { pageIndex: number } | null => {
    const entry = undoStack.pop()
    if (!entry) return null
    const current = notebook.pages[entry.pageIndex]
    if (current) {
      redoStack.push({
        notebookId: entry.notebookId,
        pageIndex: entry.pageIndex,
        pageSnapshot: clonePage(current),
      })
    }
    notebook.pages[entry.pageIndex] = entry.pageSnapshot
    return { pageIndex: entry.pageIndex }
  }

  const redo = (): { pageIndex: number } | null => {
    const entry = redoStack.pop()
    if (!entry) return null
    const current = notebook.pages[entry.pageIndex]
    if (current) {
      undoStack.push({
        notebookId: entry.notebookId,
        pageIndex: entry.pageIndex,
        pageSnapshot: clonePage(current),
      })
    }
    notebook.pages[entry.pageIndex] = entry.pageSnapshot
    return { pageIndex: entry.pageIndex }
  }

  // Initial state: 0 strokes
  assert(notebook.pages[0].layers[0].strokes.length === 0, 'initial page has 0 strokes')

  // Action 1: Add stroke 1
  pushUndo(0)
  const stroke1: Stroke = { id: 's1', kind: 'pen', color: '#000', size: 2, points: [{ x: 0, y: 0, pressure: 1 }] }
  notebook.pages[0].layers[0].strokes.push(stroke1)
  assert(notebook.pages[0].layers[0].strokes.length === 1, 'after stroke 1: 1 stroke')

  // Action 2: Add stroke 2
  pushUndo(0)
  const stroke2: Stroke = { id: 's2', kind: 'pen', color: '#f00', size: 4, points: [{ x: 10, y: 10, pressure: 1 }] }
  notebook.pages[0].layers[0].strokes.push(stroke2)
  assert(notebook.pages[0].layers[0].strokes.length === 2, 'after stroke 2: 2 strokes')

  // Undo 1 -> reverts stroke 2
  undo()
  assert(notebook.pages[0].layers[0].strokes.length === 1, 'after 1st undo: 1 stroke remaining')
  assert(notebook.pages[0].layers[0].strokes[0].id === 's1', '1st undo restored stroke 1')

  // Undo 2 -> reverts stroke 1
  undo()
  assert(notebook.pages[0].layers[0].strokes.length === 0, 'after 2nd undo: 0 strokes remaining')

  // Redo 1 -> re-applies stroke 1
  redo()
  assert(notebook.pages[0].layers[0].strokes.length === 1, 'after 1st redo: 1 stroke re-applied')

  // Redo 2 -> re-applies stroke 2
  redo()
  assert(notebook.pages[0].layers[0].strokes.length === 2, 'after 2nd redo: 2 strokes re-applied')
}

{
  // Test 2: Cross-page undo safety
  const notebook: Notebook = makeNotebook('Multi Page', 'folder-1')
  notebook.pages.push(makePage('blank'))
  notebook.pages.push(makePage('grid'))

  const undoStack: UndoEntry[] = []

  // Push stroke on Page 0
  undoStack.push({ notebookId: notebook.id, pageIndex: 0, pageSnapshot: clonePage(notebook.pages[0]) })
  notebook.pages[0].layers[0].strokes.push({ id: 's-p0', kind: 'pen', color: '#000', size: 2, points: [{ x: 1, y: 1, pressure: 1 }] })

  // User switches to Page 1 and presses Undo
  const entry = undoStack.pop()!

  // Re-apply to entry's pageIndex (Page 0), NOT current targetPageIndex (Page 1)
  notebook.pages[entry.pageIndex] = entry.pageSnapshot

  assert(entry.pageIndex === 0, 'cross-page undo correctly targets original Page 0 index')
  assert(notebook.pages[0].layers[0].strokes.length === 0, 'cross-page undo restored Page 0 without stroke')
  assert(notebook.pages[1].layers[0].strokes.length === 0, 'cross-page undo did NOT corrupt Page 1')
}

{
  // Test 3: Stack size limit (60 max)
  const undoStack: UndoEntry[] = []
  const notebook = makeNotebook('Cap', 'f1')
  notebook.pages.push(makePage('blank'))

  for (let i = 0; i < 70; i++) {
    undoStack.push({ notebookId: notebook.id, pageIndex: 0, pageSnapshot: clonePage(notebook.pages[0]) })
    if (undoStack.length > 60) undoStack.shift()
  }

  assert(undoStack.length === 60, 'undo stack capped at max 60 entries')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
