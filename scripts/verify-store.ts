/**
 * Verification script for the store-level folder normalization.
 *
 * A notebook whose `folderId` references a folder that does not exist locally
 * (e.g. a blank `folders.json` on the cloud, or a backup that lost the folder
 * structure) is INVISIBLE in the sidebar — it is neither a root notebook
 * (`folderId === null`) nor listed under a known folder. This script proves:
 *  1. `normalizeNotebookFolder` resolves such references to `null` (root)
 *  2. `store.init()` applies that normalization to notebooks already persisted
 *     in IndexedDB, so previously-downloaded notes become visible
 *
 * Run: npx tsx scripts/verify-store.ts
 */
import 'fake-indexeddb/auto'
import { db } from '../src/db'
import { normalizeNotebookFolder, useAppStore } from '../src/store'
import { makeFolder, makeNotebook } from '../src/types'

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

console.log('== normalizeNotebookFolder ==')
{
  const ids = new Set(['f1', 'f2'])
  assert(normalizeNotebookFolder({ folderId: 'f1' }, ids) === 'f1', 'existing folder -> kept')
  assert(
    normalizeNotebookFolder({ folderId: 'ghost' }, ids) === null,
    'missing folder -> null (root)',
  )
  assert(normalizeNotebookFolder({ folderId: null }, ids) === null, 'no folder -> null')
  assert(
    normalizeNotebookFolder({ folderId: undefined }, ids) === null,
    'undefined folder -> null',
  )
}

console.log('== store.init() normalization ==')
async function main(): Promise<void> {
  const folderA = makeFolder('日本語', null)
  const folderB = makeFolder('中級2-1', folderA.id)
  const nbInFolder = makeNotebook('漢字中級2-1', folderB.id)
  const nbOrphan = makeNotebook('orphan', 'ghost-folder-id')

  await db.putFolder(folderA)
  await db.putFolder(folderB)
  await db.putNotebook(nbInFolder)
  await db.putNotebook(nbOrphan)

  await useAppStore.getState().init()

  const { folders, notebooks } = useAppStore.getState()
  assert(folders.length === 2, 'folders loaded from db')
  const kept = notebooks.find((n) => n.id === nbInFolder.id)
  const orphan = notebooks.find((n) => n.id === nbOrphan.id)
  assert(kept !== undefined, 'notebook inside an existing folder is present')
  assert(kept?.folderId === folderB.id, 'existing-folder notebook keeps its folderId')
  assert(orphan !== undefined, 'orphan notebook is present (not dropped)')
  assert(orphan?.folderId === null, 'orphan notebook moved to root (folderId null)')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
