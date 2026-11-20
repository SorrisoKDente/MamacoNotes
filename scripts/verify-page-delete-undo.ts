/**
 * Verification script for undoing a page deletion.
 *
 * Root cause it guards against: `deletePage` spliced the page out of the
 * notebook and `putNotebook` deleted its record and its `pdfImages` bitmap in
 * the same transaction, with no way back — the local trash only holds notebooks
 * and folders. The store now keeps the last deletion in `pageDeleteUndo` and
 * `undoPageDelete()` reinserts the pages at their original indices, and Ctrl+Z
 * (`undo()`) consumes that pending deletion instead of popping a stroke entry.
 *
 * Stroke undo entries are positional (`pageIndex`), so a page-list operation
 * must discard them: otherwise pressing Ctrl+Z after a deletion writes an old
 * snapshot onto whichever page shifted into that index (data loss).
 *
 * This script proves:
 *  1. `deletePage` removes the page and keeps it in `pageDeleteUndo`
 *  2. `undoPageDelete` restores it at the original index, with its PDF bitmap,
 *     persisted again in the database
 *  3. deleting several pages at once is undone as a single step, in order
 *  4. dismissing the bar clears the pending deletion (undo becomes a no-op)
 *  5. leaving the notebook drops the pending deletion
 *  6. Ctrl+Z (`undo()`) right after a deletion restores the page
 *  7. a page-list change discards stroke undo entries, so Ctrl+Z can never
 *     overwrite the page that shifted into the removed index
 *
 * Run: npx tsx scripts/verify-page-delete-undo.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { useAppStore } from '../src/store'
import { makeNotebook, makePage } from '../src/types'
import type { Notebook, Page } from '../src/types'

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

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const store = () => useAppStore.getState()

function ids(notebook: Notebook | null): string {
  return (notebook?.pages ?? []).map((p) => p.id).join(',')
}

/** Seeds a fresh 3-page notebook (middle page carries a PDF background). */
async function seed(name: string, pdfPage = 1): Promise<{ nb: Notebook; pages: Page[] }> {
  const nb = makeNotebook(name, null)
  const pages = [makePage('blank'), makePage('blank'), makePage('blank')]
  if (pdfPage >= 0) pages[pdfPage].pdf = { dataUrl: PNG, name: 'doc.pdf', pageNumber: pdfPage + 1 }
  nb.pages = pages
  await db.putNotebook(nb)
  await store().init()
  await store().selectNotebook(nb.id)
  return { nb, pages }
}

async function main(): Promise<void> {
  console.log('== single page ==')
  {
    const { nb, pages } = await seed('single')
    const [p1, p2, p3] = pages

    await store().deletePage(1)
    const afterDelete = store().activeNotebook
    assert(afterDelete?.pages.length === 2, 'deletePage removes the page from the notebook')
    assert(ids(afterDelete) === [p1.id, p3.id].join(','), 'remaining pages keep their order')
    const pending = store().pageDeleteUndo
    assert(pending?.notebookId === nb.id, 'deletion is kept for an immediate undo')
    assert(pending?.pages[0]?.index === 1, 'pending deletion remembers the original index')
    assert(pending?.pages[0]?.page.id === p2.id, 'pending deletion keeps the removed page')
    assert((await db.getNotebook(nb.id))?.pages.length === 2, 'deleted page is gone from storage')

    await store().undoPageDelete()
    const restored = store().activeNotebook
    assert(ids(restored) === [p1.id, p2.id, p3.id].join(','), 'undo restores the page at its original index')
    assert(restored?.pages[1]?.pdf?.dataUrl === PNG, 'undo restores the PDF background bitmap')
    assert(restored?.pages[1]?.layers.length === p2.layers.length, 'undo restores the page layers')
    assert(store().pageDeleteUndo === null, 'undo clears the pending deletion')
    assert(store().currentPageIndex === 1, 'undo selects the restored page')
    const afterUndo = await db.getNotebook(nb.id)
    assert(afterUndo?.pages.length === 3, 'restored page is persisted')
    assert(afterUndo?.pages[1]?.id === p2.id, 'persisted page lands on the right index')
    assert(afterUndo?.pages[1]?.pdf?.dataUrl === PNG, 'PDF bitmap is persisted again (pdfImages)')
  }

  console.log('== multiple pages ==')
  {
    const { pages } = await seed('multiple')
    const [p1, p2, p3] = pages
    store().setPageSelection([0, 2])
    await store().deleteSelectedPages()
    const nb = store().activeNotebook
    assert(ids(nb) === p2.id, 'two pages removed, one left')
    assert(store().pageDeleteUndo?.pages.length === 2, 'both removed pages are kept for undo')
    await store().undoPageDelete()
    assert(
      ids(store().activeNotebook) === [p1.id, p2.id, p3.id].join(','),
      'undo reinserts both pages in their original order',
    )
    assert((await db.getNotebook(nb!.id))?.pages.length === 3, 'both restored pages are persisted')
  }

  console.log('== dismiss and notebook switch ==')
  {
    await seed('dismiss')
    await store().deletePage(0)
    assert(store().pageDeleteUndo !== null, 'deletion is pending after the delete')
    store().dismissPageDeleteUndo()
    assert(store().pageDeleteUndo === null, 'dismiss clears the pending deletion')
    await store().undoPageDelete()
    assert(store().activeNotebook?.pages.length === 2, 'undo after dismiss does nothing')

    await store().deletePage(0)
    await store().selectNotebook(null)
    assert(store().pageDeleteUndo === null, 'leaving the notebook drops the pending deletion')
  }

  console.log('== ctrl+z right after a deletion ==')
  {
    const { nb, pages } = await seed('ctrl-z')
    const [p1, p2, p3] = pages
    await store().deletePage(1)
    await store().undo()
    assert(
      ids(store().activeNotebook) === [p1.id, p2.id, p3.id].join(','),
      'undo() restores the deleted page instead of popping a stroke entry',
    )
    assert(store().pageDeleteUndo === null, 'undo() closes the undo bar')
    assert(
      (await db.getNotebook(nb.id))?.pages.length === 3,
      'page restored by undo() is persisted',
    )
  }

  console.log('== stroke history cannot hit a shifted page ==')
  {
    const { nb, pages } = await seed('stale-history')
    const [p1, , p3] = pages
    // A stroke undo entry for the middle page, then that page is removed.
    store().selectPage(1)
    store().pushUndo()
    assert(store().canUndo === true, 'stroke undo entry exists before the deletion')

    await store().deletePage(1)
    assert(store().canUndo === false, 'deleting a page discards stale stroke undo entries')

    store().dismissPageDeleteUndo()
    await store().undo()
    const afterUndo = store().activeNotebook
    assert(
      ids(afterUndo) === [p1.id, p3.id].join(','),
      'Ctrl+Z after the deletion does not resurrect the old middle page',
    )
    assert(afterUndo?.pages[1]?.id === p3.id, 'the page that shifted into the index keeps its content')
    assert((await db.getNotebook(nb.id))?.pages.length === 2, 'storage keeps the two remaining pages')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

void main()
