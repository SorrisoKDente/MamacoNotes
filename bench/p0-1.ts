/**
 * P0-1 benchmark: per-frame drawing cost on a real PDF page, page bitmap cache
 * ON (current code) vs OFF (pre-P0-1 behaviour, when PDF pages always took the
 * full render path while a stroke was active).
 *
 * It runs the real `PageCanvas` from `src/renderer/canvas.ts` against a real
 * page extracted from a backup (`scripts/bench-p0-1.ts` writes the fixture), in
 * Chromium with a real 2D canvas — no mocks, so PDF rasterization, stroke
 * tracing and blitting cost what they cost in the app.
 *
 * How "OFF" is produced without touching the source: the cache is only served
 * while `drawing` is true (`shouldUsePageCache`). Setting `drawing = false`
 * right before `render()` (and restoring it after) makes `tryCachedPage` take
 * `full(pdf-stroke)`, the exact pre-P0-1 path: background + PDF raster + every
 * committed stroke + the live stroke, every frame.
 *
 * Every frame also issues a 1×1 `getImageData` readback so the GPU work is
 * flushed and counted (otherwise the browser can defer it past `performance.now`
 * and both numbers would look artificially small).
 *
 * The two configurations are interleaved over two passes (A/B/A/B) so JIT and
 * machine warm-up do not favour one of them, and the last frame of every pass
 * is compared pixel by pixel to prove the cache changes speed, not content.
 *
 * Run: npm run dev, then open
 *   http://127.0.0.1:5173/bench/p0-1.html?dpr=0&frames=180&passes=2
 * `dpr=0` uses the window DPR; a number forces it. Every page-sized bitmap is
 * blitted 1:1 in device pixels (`blitPageBitmap`), so the pixel mismatch between
 * the cached and direct paths must stay near zero at **fractional** scales too —
 * `dpr=1.25`, `dpr=1.5` and `dpr=2` are the regression check for the PDF
 * "trembling while writing" bug (they used to differ by ~15% of the page).
 * Results are exposed as `window.__bench` / `window.__benchPromise`.
 */
import { PageCanvas } from '../src/renderer/canvas'
import type { PageGrid } from '../src/renderer/canvas'
import type { Page } from '../src/types'

interface FixtureSource {
  notebook: string
  pageId: string
  width: number
  height: number
  strokes: number
  pdfBytes: number
  backupBytes: number
  totalPages: number
  pdfPages: number
}

interface Fixture {
  source: FixtureSource
  page: Page
}

interface Stats {
  frames: number
  mean: number
  median: number
  p95: number
  min: number
  max: number
  total: number
}

interface PixelDiff {
  mismatchRatio: number
  maxChannelDiff: number
  meanChannelDiff: number
}

interface PassResult {
  cacheEnabled: boolean
  cacheBuildMs: number
  stats: Stats
  frameMs: number[]
  /** Raw RGBA of the last frame; stripped out of the JSON result. */
  pixels: Uint8ClampedArray
}

interface BenchResult {
  source: FixtureSource
  env: {
    devicePixelRatio: number
    zoom: number
    frames: number
    passes: number
    pagePixels: number
  }
  off: { stats: Stats; cacheBuildMs: number; passes: PassResult[] }
  on: { stats: Stats; cacheBuildMs: number; passes: PassResult[] }
  speedup: number
  pixelDiffs: { on: PixelDiff[]; off: PixelDiff[] }
  /** False when the cached preview differs from a direct render beyond budget. */
  pixelOk: boolean
  error?: string
}

const params = new URLSearchParams(location.search)
const stage = document.getElementById('stage') as HTMLDivElement
const out = document.getElementById('out') as HTMLPreElement

const FRAMES = Number(params.get('frames') ?? 180)
const PASSES = Math.max(1, Number(params.get('passes') ?? 2))
const DPR_OVERRIDE = Number(params.get('dpr') ?? 0)
const ZOOM = 1
const TOLERANCE = 2
/** Fractional pan on purpose: phase 0 would not exercise the subpixel grid. */
const PAN_X = 13.37
const PAN_Y = 7.77
/** Pixel parity budget between the cached and the direct path (see `pageGrid`). */
const MAX_MISMATCH_RATIO = 0.001

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function summarize(frameMs: number[]): Stats {
  const sorted = [...frameMs].sort((a, b) => a - b)
  const total = frameMs.reduce((sum, ms) => sum + ms, 0)
  return {
    frames: frameMs.length,
    mean: total / Math.max(1, frameMs.length),
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    total,
  }
}

function mean(samples: number[]): number {
  return samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)
}

/** A wavy stroke across the upper half of the page, one sample per frame. */
function strokePoints(page: Page, count: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1)
    points.push({
      x: 80 + t * (page.width - 160),
      y: 260 + Math.sin(t * Math.PI * 3) * 90,
    })
  }
  return points
}

function mount(page: Page): { pc: PageCanvas; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  canvas.style.width = `${page.width}px`
  canvas.style.height = `${page.height}px`
  canvas.style.display = 'block'
  stage.appendChild(canvas)
  const pc = new PageCanvas({
    canvas,
    page,
    zoom: ZOOM,
    panX: PAN_X,
    panY: PAN_Y,
    callbacks: { onStrokeEnd: () => {}, onRequestRerender: () => {} },
  })
  if (DPR_OVERRIDE > 0) pc.devicePixelRatio = DPR_OVERRIDE
  pc.setDocument([page], [{ x: 0, y: 0 }], 'separate', 0)
  pc.render()
  return { pc, canvas }
}

/** Internals used only to warm/drive the renderer from the benchmark. */
type PageCanvasInternals = {
  getPdfCanvas(page: Page, dataUrl: string): HTMLCanvasElement | null
  getPageCache(page: Page, grid: PageGrid): HTMLCanvasElement | null
}

async function waitPdf(pc: PageCanvas, page: Page): Promise<void> {
  const internals = pc as unknown as PageCanvasInternals
  for (let attempt = 0; attempt < 200; attempt++) {
    if (internals.getPdfCanvas(page, page.pdf!.dataUrl)) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('PDF raster never became ready')
}

function flush(ctx: CanvasRenderingContext2D): void {
  ctx.getImageData(0, 0, 1, 1)
}

function comparePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): PixelDiff {
  const length = Math.min(a.length, b.length)
  let mismatched = 0
  let maxChannelDiff = 0
  let totalDiff = 0
  for (let i = 0; i < length; i++) {
    const diff = Math.abs(a[i] - b[i])
    if (diff > TOLERANCE) mismatched++
    if (diff > maxChannelDiff) maxChannelDiff = diff
    totalDiff += diff
  }
  return {
    mismatchRatio: length === 0 ? 0 : mismatched / length,
    maxChannelDiff,
    meanChannelDiff: length === 0 ? 0 : totalDiff / length,
  }
}

async function runOnce(
  page: Page,
  points: { x: number; y: number }[],
  cacheEnabled: boolean,
): Promise<PassResult> {
  const { pc, canvas } = mount(page)
  await waitPdf(pc, page)

  const internals = pc as unknown as PageCanvasInternals
  pc.invalidatePageCache()
  const buildStart = performance.now()
  internals.getPageCache(page, pc.pageGridFor(page))
  flush(pc.ctx)
  const cacheBuildMs = performance.now() - buildStart

  pc.updateRect(true)
  const first = pc.toScreenCoords(points[0].x, points[0].y)
  pc.beginStroke('pen', '#111111', 3, first.x, first.y)

  const frameMs: number[] = []
  for (let i = 1; i < points.length; i++) {
    const p = pc.toScreenCoords(points[i].x, points[i].y)
    pc.extendStroke(p.x, p.y)
    // Off = pre-P0-1: PDF pages never took the cached path during a stroke.
    if (!cacheEnabled) pc.drawing = false
    const start = performance.now()
    pc.render()
    flush(pc.ctx)
    frameMs.push(performance.now() - start)
    if (!cacheEnabled) pc.drawing = true
  }

  const pixels = pc.ctx.getImageData(0, 0, canvas.width, canvas.height).data
  canvas.remove()
  return { cacheEnabled, cacheBuildMs, stats: summarize(frameMs), frameMs, pixels }
}

function formatStats(label: string, stats: Stats): string {
  return [
    `${label.padEnd(26)} ${stats.mean.toFixed(2)} ms/frame mean | ` +
      `${stats.median.toFixed(2)} median | ${stats.p95.toFixed(2)} p95 | ` +
      `${stats.min.toFixed(2)} min | ${stats.max.toFixed(2)} max`,
    `${''.padEnd(26)} ${stats.total.toFixed(0)} ms total for ${stats.frames} frames`,
  ].join('\n')
}

function formatDiffs(diffs: PixelDiff[]): string {
  return diffs
    .map(
      (diff) =>
        `≠${(diff.mismatchRatio * 100).toFixed(3)}% (>${TOLERANCE}/255) max ${diff.maxChannelDiff} mean ${diff.meanChannelDiff.toFixed(3)}`,
    )
    .join(' | ')
}

async function run(): Promise<BenchResult> {
  const response = await fetch('/bench-p0-1-page.json')
  if (!response.ok) {
    throw new Error(`Fixture missing (${response.status}). Run: npx tsx scripts/bench-p0-1.ts`)
  }
  const fixture = (await response.json()) as Fixture
  const page = fixture.page
  const points = strokePoints(page, FRAMES)

  const offPasses: PassResult[] = []
  const onPasses: PassResult[] = []
  for (let pass = 0; pass < PASSES; pass++) {
    // A/B/A/B: interleaving keeps JIT and machine warm-up from favouring a side.
    const off = await runOnce(page, points, false)
    const on = await runOnce(page, points, true)
    offPasses.push(off)
    onPasses.push(on)
    out.textContent =
      `pass ${pass + 1}/${PASSES} — off ${off.stats.mean.toFixed(1)} ms/frame, ` +
      `on ${on.stats.mean.toFixed(1)} ms/frame`
  }
  // Same stroke state at the end of every pass: the images must agree.
  const reference = offPasses[0].pixels
  const onDiffs = onPasses.map((pass) => comparePixels(reference, pass.pixels))
  const offDiffs = offPasses.map((pass) => comparePixels(reference, pass.pixels))
  // Regression gate: the cached preview must be pixel-identical (up to the
  // per-channel tolerance) to a direct render — that is the "tremble" bug.
  // Only the mismatched *area* is gated: a tie in the rasterizer can flip a
  // couple of isolated pixels to a high channel diff without any visual change.
  const pixelOk = onDiffs.every((diff) => diff.mismatchRatio <= MAX_MISMATCH_RATIO)

  const offStats = summarize(offPasses.flatMap((pass) => pass.frameMs))
  const onStats = summarize(onPasses.flatMap((pass) => pass.frameMs))

  console.log(
    [
      '== P0-1 page cache benchmark ==',
      `page          ${fixture.source.notebook} / ${fixture.source.pageId} ` +
        `(${fixture.source.width}x${fixture.source.height}, ${fixture.source.strokes} strokes, PDF)`,
      `stroke        ${FRAMES} points/frames, zoom ${ZOOM}, DPR ${DPR_OVERRIDE > 0 ? DPR_OVERRIDE : window.devicePixelRatio}`,
      '',
      formatStats('cache OFF (pre-P0-1)', offStats),
      formatStats('cache ON (current)', onStats),
      '',
      `speedup       ${(offStats.mean / Math.max(0.001, onStats.mean)).toFixed(2)}x per frame (mean), ` +
        `${(offStats.median / Math.max(0.001, onStats.median)).toFixed(2)}x median`,
      `cache build   ${mean(onPasses.map((pass) => pass.cacheBuildMs)).toFixed(1)} ms one-time spend`,
      '',
      'pixels at the end of the run (cache ON is the point of interest):',
      `  ON  ${formatDiffs(onDiffs)}`,
      `  OFF ${formatDiffs(offDiffs)}`,
      '',
      pixelOk
        ? `PARITY OK     cached preview matches a direct render (<= ${(MAX_MISMATCH_RATIO * 100).toFixed(1)}% >${TOLERANCE}/255)`
        : `PARITY FAIL   cached preview differs from a direct render — the "trembling" bug is back`,
    ].join('\n'),
  )

  const strip = (pass: PassResult) => ({
    cacheEnabled: pass.cacheEnabled,
    cacheBuildMs: pass.cacheBuildMs,
    stats: pass.stats,
    frameMs: pass.frameMs.map((ms) => Number(ms.toFixed(3))),
    pixels: new Uint8ClampedArray(0),
  })

  return {
    source: fixture.source,
    env: {
      devicePixelRatio: DPR_OVERRIDE > 0 ? DPR_OVERRIDE : window.devicePixelRatio,
      zoom: ZOOM,
      frames: FRAMES,
      passes: PASSES,
      pagePixels: page.width * page.height,
    },
    off: { stats: offStats, cacheBuildMs: mean(offPasses.map((pass) => pass.cacheBuildMs)), passes: offPasses.map(strip) },
    on: { stats: onStats, cacheBuildMs: mean(onPasses.map((pass) => pass.cacheBuildMs)), passes: onPasses.map(strip) },
    speedup: offStats.mean / Math.max(0.001, onStats.mean),
    pixelDiffs: { on: onDiffs, off: offDiffs },
    pixelOk,
  }
}

declare global {
  interface Window {
    __bench?: BenchResult
    __benchPromise?: Promise<BenchResult>
  }
}

const promise = run()
window.__benchPromise = promise
promise
  .then((result) => {
    window.__bench = result
    out.textContent = `${out.textContent}\n\n== done ==\n${JSON.stringify(
      { env: result.env, off: result.off.stats, on: result.on.stats, speedup: result.speedup, pixelDiffs: result.pixelDiffs, source: result.source },
      null,
      2,
    )}`
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
    window.__bench = { error: message } as unknown as BenchResult
    out.textContent = `benchmark failed:\n${message}`
    console.error(error)
  })
