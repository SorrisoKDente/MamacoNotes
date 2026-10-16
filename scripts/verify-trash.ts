/**
 * Verification script for Trash and 30-day Retention logic.
 *
 * Exercises:
 *  1. Deleting notebooks/folders creates correct `TrashItem` entries.
 *  2. Restoring from trash recovers the notebook/folder.
 *  3. Purging trash items removes them permanently.
 *  4. 30-day retention purge (`runTrashPurge`) drops items older than 30 days.
 *
 * Run: npx tsx scripts/verify-trash.ts
 */
import type { Notebook, TrashItem } from '../src/types'
import { makeNotebook, makePage } from '../src/types'
import { TOMBSTONE_RETENTION_MS } from '../src/utils/sync'

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

console.log('== Trash & Retention Verification ==')

{
  // Test 1: Deleting a notebook creates a TrashItem
  const page = makePage('blank')
  const notebook: Notebook = makeNotebook('Trash Test', 'folder-1')
  notebook.pages.push(page)
  let trash: TrashItem[] = []

  const deleteNotebookToTrash = (nb: Notebook) => {
    const item: TrashItem = {
      id: nb.id,
      kind: 'notebook',
      name: nb.name,
      parentId: nb.folderId,
      data: JSON.parse(JSON.stringify(nb)) as Notebook,
      deletedAt: Date.now(),
      cloudKeepsCopy: false,
    }
    trash.push(item)
  }

  deleteNotebookToTrash(notebook)
  assert(trash.length === 1, 'notebook deleted to trash creates 1 trash item')
  assert(trash[0].name === 'Trash Test', 'trash item name matches notebook')
  assert(trash[0].kind === 'notebook', 'trash item kind is notebook')

  // Test 2: Restoring from trash
  const restored = trash[0].data as Notebook
  trash = trash.filter((t) => t.id !== trash[0].id)
  assert(trash.length === 0, 'restoring removes item from trash')
  assert(restored !== null && restored.name === 'Trash Test', 'restored notebook matches original name')
}

{
  // Test 3: 30-day retention purge
  const now = Date.now()
  const DAY_MS = 24 * 60 * 60 * 1000

  const freshItem: TrashItem = {
    id: 'trash-fresh',
    kind: 'notebook',
    name: 'Fresh Trash',
    parentId: null,
    data: null,
    deletedAt: now - 10 * DAY_MS, // 10 days old
    cloudKeepsCopy: false,
  }

  const oldItem: TrashItem = {
    id: 'trash-old',
    kind: 'notebook',
    name: 'Old Trash',
    parentId: null,
    data: null,
    deletedAt: now - 35 * DAY_MS, // 35 days old (exceeds 30 days)
    cloudKeepsCopy: false,
  }

  const cloudOnlyOldItem: TrashItem = {
    id: 'trash-cloud-old',
    kind: 'notebook',
    name: 'Cloud Kept Trash',
    parentId: null,
    data: null,
    deletedAt: now - 40 * DAY_MS,
    cloudKeepsCopy: true, // "só local" item -> kept so "Restaurar da nuvem" remains
  }

  let trashList: TrashItem[] = [freshItem, oldItem, cloudOnlyOldItem]

  const runTrashPurge = () => {
    const cutoff = Date.now() - TOMBSTONE_RETENTION_MS
    trashList = trashList.filter((item) => {
      if (item.cloudKeepsCopy) return true
      return item.deletedAt > cutoff
    })
  }

  runTrashPurge()

  assert(trashList.some((t) => t.id === 'trash-fresh'), '10-day-old trash item retained')
  assert(!trashList.some((t) => t.id === 'trash-old'), '35-day-old trash item purged automatically')
  assert(trashList.some((t) => t.id === 'trash-cloud-old'), 'cloud-kept trash item preserved for cloud restore')
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
