/**
 * Extracts the benchmark page for the P0-1 page-cache measurement.
 *
 * Reads a Mamaco backup, picks the PDF page with the most strokes (the worst
 * case for per-frame drawing) and writes `public/bench-p0-1-page.json`, which
 * `bench/p0-1.html` loads in a real Chromium canvas (see `scripts/bench-p0-1.md`
 * or the header of `bench/p0-1.ts`).
 *
 * Run: npx tsx scripts/bench-p0-1.ts [backup.json] [output.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '../src/types'

const DEFAULT_BACKUP = 'E:/Documentos/日本語/Mamaco Notes/mamaco-notes-backup-2026-11-13-201413.json'

interface BackupNotebook {
  name: string
  pages?: Page[]
}

interface Backup {
  notebooks?: BackupNotebook[]
}

const backupPath = process.argv[2] ?? DEFAULT_BACKUP
const outPath = process.argv[3] ?? path.resolve('public/bench-p0-1-page.json')

const raw = fs.readFileSync(backupPath, 'utf8')
const backup = JSON.parse(raw) as Backup
const notebooks = backup.notebooks ?? []

interface Candidate {
  notebook: string
  page: Page
  strokes: number
  pdfBytes: number
}

let best: Candidate | null = null
let pdfPages = 0
let totalPages = 0

for (const notebook of notebooks) {
  for (const page of notebook.pages ?? []) {
    totalPages++
    if (!page.pdf) continue
    pdfPages++
    const strokes = page.layers.reduce((sum, layer) => sum + layer.strokes.length, 0)
    const pdfBytes = page.pdf.dataUrl.length
    if (!best || strokes > best.strokes) best = { notebook: notebook.name, page, strokes, pdfBytes }
  }
}

if (!best) {
  console.error('No PDF page found in the backup.')
  process.exit(1)
}

const fixture = {
  source: {
    notebook: best.notebook,
    pageId: best.page.id,
    width: best.page.width,
    height: best.page.height,
    strokes: best.strokes,
    pdfBytes: best.pdfBytes,
    backupBytes: raw.length,
    totalPages,
    pdfPages,
  },
  page: best.page,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(fixture))

const layers = best.page.layers.map(
  (layer) =>
    `${layer.id}:${layer.strokes.length} strokes, visible=${layer.visible}, opacity=${layer.opacity}`,
)

console.log('== P0-1 benchmark fixture ==')
console.log(`backup       ${backupPath} (${(raw.length / 1024 / 1024).toFixed(1)} MB)`)
console.log(`pages        ${totalPages} total, ${pdfPages} with PDF`)
console.log(`worst page   ${best.notebook} / ${best.page.id} (${best.page.width}x${best.page.height})`)
console.log(`strokes      ${best.strokes}`)
console.log(`pdf raster   ${(best.pdfBytes / 1024).toFixed(0)} KB data URL`)
console.log(`layers       ${layers.join(' | ')}`)
console.log(`written      ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`)
