/**
 * Regression verification for P1-4: syncing without PDFs in the notebook JSON.
 *
 * Proves that:
 *  1. a push uploads each page PDF as `pdfs/<pageId>.png` and the notebook JSON
 *     carries no base64 bitmap, only `{ name, pageNumber }`
 *  2. the manifest keeps a hash per page, so a later push (a stroke changed the
 *     notebook) re-uploads the JSON but ZERO PDF images
 *  3. a pull rehydrates `page.pdf.dataUrl` from the remote image
 *  4. removing a page deletes its remote image (no orphan files)
 *  5. a non-PNG dataUrl stays inline instead of being lost
 *  6. old-format remote notebooks (inline dataUrl, no hashes) still pull fine
 *  7. deleting a notebook removes its remote images
 *
 * Run: npx tsx scripts/verify-sync-pdfs.ts
 */
import {
  encodePngDataUrl,
  pdfHash,
  runSync,
  serializeManifest,
  MANIFEST_PATH,
} from '../src/utils/sync'
import { normalizePage } from '../src/types'
import type {
  CloudSyncState,
  Folder,
  Notebook,
  NotebookSummary,
  Page,
  SyncManifest,
} from '../src/types'
import type { Transport } from '../src/utils/webdav'
import { RemoteFileNotFoundError } from '../src/utils/webdav'

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

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6])

function makePage(id: string, dataUrl?: string): Page {
  return normalizePage({
    id,
    template: 'blank',
    width: 100,
    height: 100,
    ...(dataUrl ? { pdf: { dataUrl, name: 'doc.pdf', pageNumber: 1 } } : {}),
    createdAt: 1,
    updatedAt: 1,
  })
}

function makeNotebook(id: string, name: string, updatedAt: number, pages: Page[]): Notebook {
  return { id, name, folderId: null, pages, createdAt: updatedAt, updatedAt }
}

function makeSummary(nb: Notebook): NotebookSummary {
  return {
    id: nb.id,
    name: nb.name,
    folderId: nb.folderId,
    createdAt: nb.createdAt,
    updatedAt: nb.updatedAt,
    pageCount: nb.pages.length,
  }
}

function makeState(overrides: Partial<CloudSyncState> = {}): CloudSyncState {
  return {
    id: 'main',
    lastSyncAt: null,
    foldersHash: 'empty',
    foldersUpdatedAt: 0,
    notebooks: {},
    tombstones: {},
    localOnlyDeleted: {},
    ...overrides,
  }
}

class FakeTransport implements Transport {
  files = new Map<string, string>()
  binaries = new Map<string, Uint8Array>()
  uploads: { path: string; contentType: string; size: number }[] = []

  async ensureDirectory(_dirPath: string): Promise<void> {}

  async listDirectory(dirPath: string): Promise<string[]> {
    const prefix = dirPath.endsWith('/') ? dirPath : dirPath + '/'
    return [...this.files.keys(), ...this.binaries.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .filter((name) => !name.includes('/'))
  }

  async uploadFile(
    filePath: string,
    bytes: Uint8Array | Blob,
    contentType: string,
  ): Promise<void> {
    const data = bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes
    this.uploads.push({ path: filePath, contentType, size: data.byteLength })
    if (contentType === 'image/png') this.binaries.set(filePath, data)
    else this.files.set(filePath, new TextDecoder().decode(data))
  }

  async downloadFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath)
    if (content === undefined) throw new RemoteFileNotFoundError(filePath)
    return content
  }

  async downloadBinaryFile(filePath: string): Promise<Uint8Array> {
    const bytes = this.binaries.get(filePath)
    if (bytes === undefined) throw new RemoteFileNotFoundError(filePath)
    return new Uint8Array(bytes)
  }

  async deleteRemoteFile(filePath: string): Promise<void> {
    this.files.delete(filePath)
    this.binaries.delete(filePath)
  }
}

function seedManifest(
  transport: FakeTransport,
  basePath: string,
  manifest: SyncManifest,
): void {
  transport.files.set(`${basePath}/${MANIFEST_PATH}`, serializeManifest(manifest))
}

function uploadedJson(transport: FakeTransport, path: string): any {
  const text = transport.files.get(path)
  if (text === undefined) throw new Error(`missing uploaded file: ${path}`)
  return JSON.parse(text)
}

console.log('== pdfHash ==')

{
  const a = encodePngDataUrl(PNG_A)
  const b = encodePngDataUrl(PNG_B)
  assert(pdfHash(a) === pdfHash(a), 'hash is stable for the same dataUrl')
  assert(pdfHash(a) !== pdfHash(b), 'hash changes when the image changes')
  assert(pdfHash(a) !== pdfHash(a + 'x'), 'hash changes when the length changes')
}

console.log('== push: PDFs leave the notebook JSON ==')

const aDataUrl = encodePngDataUrl(PNG_A)
const bDataUrl = encodePngDataUrl(PNG_B)
const pdfNotebook = makeNotebook('nb-pdf', 'PDF', 2000, [
  makePage('p1', aDataUrl),
  makePage('p2', bDataUrl),
  makePage('p3'),
])
const transport = new FakeTransport()
const folders: Folder[] = []

{
  const out = await runSync({
    basePath: 'base',
    folders,
    notebooks: [makeSummary(pdfNotebook)],
    state: makeState(),
    transport,
    getNotebook: async (id) => (id === pdfNotebook.id ? pdfNotebook : undefined),
  })
  assert(out.result.errors.length === 0, 'push: no errors')
  const json = uploadedJson(transport, 'base/notebooks/nb-pdf.json')
  const raw = transport.files.get('base/notebooks/nb-pdf.json')!
  assert(!raw.includes('base64'), 'push: notebook JSON no longer embeds PDF bitmaps')
  assert(
    json.notebook.pages[0].pdf.name === 'doc.pdf' &&
      json.notebook.pages[0].pdf.pageNumber === 1 &&
      json.notebook.pages[0].pdf.dataUrl === undefined,
    'push: page keeps pdf metadata without dataUrl',
  )
  assert(
    new Uint8Array(transport.binaries.get('base/pdfs/p1.png') ?? []).every(
      (byte, i) => byte === PNG_A[i],
    ) && transport.binaries.get('base/pdfs/p1.png')?.length === PNG_A.length,
    'push: pdfs/p1.png holds the exact PNG bytes',
  )
  assert(transport.binaries.has('base/pdfs/p2.png'), 'push: pdfs/p2.png uploaded')
  assert(!transport.binaries.has('base/pdfs/p3.png'), 'push: page without PDF uploads nothing')
  const manifest = JSON.parse(transport.files.get('base/manifest.json')!) as SyncManifest
  const entry = manifest.notebooks.find((n) => n.id === 'nb-pdf')
  assert(
    entry?.pdfs?.['p1'] === pdfHash(aDataUrl) && entry?.pdfs?.['p2'] === pdfHash(bDataUrl),
    'push: manifest records one hash per page PDF',
  )
  assert(
    Object.keys(entry?.pdfs ?? {}).length === 2,
    'push: manifest only lists pages that have a PDF',
  )
}

console.log('== push after a stroke: no PDF re-upload ==')

let pushedState: CloudSyncState
{
  const edited = { ...pdfNotebook, updatedAt: 3000 }
  const first = await runSync({
    basePath: 'base',
    folders,
    notebooks: [makeSummary(pdfNotebook)],
    state: makeState(),
    transport,
    getNotebook: async () => pdfNotebook,
  })
  pushedState = first.nextState
  transport.uploads.length = 0
  const out = await runSync({
    basePath: 'base',
    folders,
    notebooks: [makeSummary(edited)],
    state: pushedState,
    transport,
    getNotebook: async () => edited,
  })
  assert(out.result.errors.length === 0, 'stroke push: no errors')
  const pdfUploads = transport.uploads.filter((u) => u.contentType === 'image/png')
  assert(pdfUploads.length === 0, 'stroke push: ZERO PDF images uploaded')
  assert(
    transport.uploads.some((u) => u.path === 'base/notebooks/nb-pdf.json'),
    'stroke push: notebook JSON is still uploaded',
  )
  const manifest = JSON.parse(transport.files.get('base/manifest.json')!) as SyncManifest
  const entry = manifest.notebooks.find((n) => n.id === 'nb-pdf')
  assert(entry?.pdfs?.['p1'] === pdfHash(aDataUrl), 'stroke push: PDF hashes are preserved')
}

console.log('== pull: PDFs are rehydrated ==')

{
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state: makeState(),
    transport,
    getNotebook: async () => undefined,
  })
  assert(out.result.errors.length === 0, 'pull: no errors')
  const nb = out.pulledNotebooks.find((n) => n.id === 'nb-pdf')
  assert(nb !== undefined, 'pull: notebook downloaded')
  const p1 = nb?.pages.find((p) => p.id === 'p1')
  assert(p1?.pdf?.dataUrl === aDataUrl, 'pull: p1 dataUrl rebuilt byte-for-byte from pdfs/p1.png')
  assert(
    nb?.pages.find((p) => p.id === 'p2')?.pdf?.dataUrl === bDataUrl,
    'pull: p2 dataUrl rebuilt',
  )
  assert(
    nb?.pages.find((p) => p.id === 'p3')?.pdf === undefined,
    'pull: page without PDF stays without one',
  )
}

console.log('== removing a page deletes its remote image ==')

{
  const trimmed = makeNotebook('nb-pdf', 'PDF', 4000, [makePage('p1', aDataUrl)])
  const out = await runSync({
    basePath: 'base',
    folders,
    notebooks: [makeSummary(trimmed)],
    state: pushedState,
    transport,
    getNotebook: async () => trimmed,
  })
  assert(out.result.errors.length === 0, 'remove page: no errors')
  assert(!transport.binaries.has('base/pdfs/p2.png'), 'remove page: orphan image deleted')
  assert(transport.binaries.has('base/pdfs/p1.png'), 'remove page: remaining image kept')
  const manifest = JSON.parse(transport.files.get('base/manifest.json')!) as SyncManifest
  assert(
    JSON.stringify(manifest.notebooks.find((n) => n.id === 'nb-pdf')?.pdfs) ===
      JSON.stringify({ p1: pdfHash(aDataUrl) }),
    'remove page: manifest drops the removed page hash',
  )
}

console.log('== non-PNG dataUrl stays inline (never lost) ==')

{
  const jpeg = 'data:image/jpeg;base64,AAAA'
  const nb = makeNotebook('nb-jpeg', 'Jpeg', 2000, [makePage('pj', jpeg)])
  const t = new FakeTransport()
  const out = await runSync({
    basePath: 'base',
    folders,
    notebooks: [makeSummary(nb)],
    state: makeState(),
    transport: t,
    getNotebook: async () => nb,
  })
  assert(out.result.errors.length === 0, 'fallback: no errors')
  const json = uploadedJson(t, 'base/notebooks/nb-jpeg.json')
  assert(json.notebook.pages[0].pdf.dataUrl === jpeg, 'fallback: unknown dataUrl stays inline')
  const manifest = JSON.parse(t.files.get('base/manifest.json')!) as SyncManifest
  assert(
    manifest.notebooks.find((n) => n.id === 'nb-jpeg')?.pdfs === undefined,
    'fallback: no hash recorded for an inline image',
  )
  assert(t.binaries.size === 0, 'fallback: no pdf image uploaded')
}

console.log('== old-format remote notebook (inline dataUrl) still pulls ==')

{
  const legacy = makeNotebook('nb-legacy', 'Legacy', 2000, [makePage('pl', aDataUrl)])
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 2000,
    folders: { updatedAt: 0 },
    notebooks: [{ id: legacy.id, name: legacy.name, updatedAt: 2000, deleted: false }],
  })
  t.files.set(
    'base/notebooks/nb-legacy.json',
    JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: legacy }),
  )
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state: makeState(),
    transport: t,
    getNotebook: async () => undefined,
  })
  assert(out.result.errors.length === 0, 'legacy pull: no errors')
  assert(
    out.pulledNotebooks[0]?.pages[0]?.pdf?.dataUrl === aDataUrl,
    'legacy pull: inline dataUrl preserved (no pdf files needed)',
  )
  assert(t.binaries.size === 0, 'legacy pull: no binary download attempted')
}

console.log('== deleting a notebook deletes its remote images ==')

{
  const nb = makeNotebook('nb-del', 'Del', 2000, [makePage('pd', aDataUrl)])
  const t = new FakeTransport()
  seedManifest(t, 'base', {
    version: 2,
    updatedAt: 3000,
    folders: { updatedAt: 0 },
    notebooks: [
      {
        id: nb.id,
        name: nb.name,
        updatedAt: 3000,
        deleted: false,
        pdfs: { pd: pdfHash(aDataUrl) },
      },
    ],
  })
  t.files.set(
    'base/notebooks/nb-del.json',
    JSON.stringify({ version: 2, exportedAt: Date.now(), notebook: nb }),
  )
  t.binaries.set('base/pdfs/pd.png', PNG_A)
  const out = await runSync({
    basePath: 'base',
    folders: [],
    notebooks: [],
    state: makeState({ tombstones: { [nb.id]: 1500 } }),
    transport: t,
    getNotebook: async () => undefined,
  })
  assert(out.result.errors.length === 0, 'delete: no errors')
  assert(!t.binaries.has('base/pdfs/pd.png'), 'delete: remote PDF image removed')
  const manifest = JSON.parse(t.files.get('base/manifest.json')!) as SyncManifest
  assert(
    manifest.notebooks.find((n) => n.id === nb.id)?.deleted === true,
    'delete: manifest keeps the tombstone',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
