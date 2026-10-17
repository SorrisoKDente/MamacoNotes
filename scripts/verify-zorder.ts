/**
 * Verification script for Layer Element Z-Ordering (Images/Strokes/Text).
 *
 * Exercises the feature end-to-end at the pure-logic level, mirroring how the
 * production code consumes the z-order helpers:
 *
 *  1. Render sequence: `renderPageContent` (canvas), `drawLayer`
 *     (thumbnail/export) all draw via `layerItems`; assert the visual order for
 *     a legacy page (no `order`) and for an explicitly arranged layer.
 *  2. The reported bug: a stroke created after an image must land ON TOP of it,
 *     so you can write over an image without creating a new layer.
 *  3. Hit-testing: `hitTestTopItem` scans `layerItems` bottom->top and returns
 *     the topmost hit (a z-aware pick, not "last array pushed").
 *  4. `arrangeLayer`: bring to front / send to back across mixed kinds
 *     (image + stroke + text) in one selection, keeping relative order.
 *  5. Persistence: `normalizePage` (the IndexedDB load / sync path) preserves
 *     the per-element `order`.
 *
 * Run: npx tsx scripts/verify-zorder.ts
 */
import type { ImageElement, Layer, Stroke, TextElement } from '../src/types'
import { arrangeLayer, layerItems, makeLayer, makePage, nextLayerOrder, normalizePage } from '../src/types'

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

function mkStroke(id: string, order?: number): Stroke {
  return {
    id,
    kind: 'pen',
    color: '#000000',
    size: 3,
    points: [{ x: 0, y: 0, pressure: 1 }],
    ...(order !== undefined ? { order } : {}),
  }
}

function mkImage(id: string, order?: number): ImageElement {
  return {
    id,
    name: `${id}.png`,
    dataUrl: 'data:image/png;base64,fake',
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    rotation: 0,
    ...(order !== undefined ? { order } : {}),
  }
}

function mkText(id: string, order?: number): TextElement {
  return {
    id,
    text: 'Hello',
    x: 0,
    y: 0,
    width: 60,
    rotation: 0,
    fontSize: 16,
    fontFamily: 'sans-serif',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    color: '#000000',
    backgroundColor: null,
    align: 'left',
    marker: 'none',
    direction: 'horizontal',
    createdAt: Date.now(),
    ...(order !== undefined ? { order } : {}),
  }
}

/**
 * Mirrors `renderPageContent` / `drawLayer`: walk `layerItems` bottom -> top and
 * emit element ids in the exact order they are painted. Consecutive strokes are
 * flushed as a run (the renderer batches them for the erasure-mask pass), which
 * does not change the resulting order.
 */
function drawOrder(layer: Layer): string[] {
  const out: string[] = []
  const run: string[] = []
  const flush = () => {
    out.push(...run)
    run.length = 0
  }
  for (const item of layerItems(layer)) {
    if (item.kind === 'stroke') {
      run.push(item.item.id)
      continue
    }
    flush()
    out.push(item.item.id)
  }
  flush()
  return out
}

/** Mirrors `hitTestTopItem`: scan top-most first, return the first hit. */
function topItem(layer: Layer, hits: Set<string>): string | null {
  const items = layerItems(layer)
  for (let i = items.length - 1; i >= 0; i--) {
    if (hits.has(items[i].item.id)) return items[i].item.id
  }
  return null
}

console.log('== Layer Element Z-Order Verification ==')

{
  // 1a. Legacy page (no `order` anywhere) must keep the pre-existing group
  //     order so old notes render exactly as they did before.
  const legacy = makeLayer('legacy', {
    strokes: [mkStroke('s1'), mkStroke('s2')],
    images: [mkImage('i1')],
    texts: [mkText('t1')],
  })
  assert(
    drawOrder(legacy).join(',') === 's1,s2,i1,t1',
    'legacy page (no order) still renders strokes -> images -> texts',
  )

  // 1b. Explicit orders interleave all three kinds freely.
  const z = makeLayer('z', {
    strokes: [mkStroke('s1', 5)],
    images: [mkImage('i1', 1), mkImage('i2', 9)],
    texts: [mkText('t1', 7)],
  })
  assert(
    drawOrder(z).join(',') === 'i1,s1,t1,i2',
    'render sequence follows explicit z-order across strokes/images/texts',
  )
}

{
  // 2. THE BUG: writing over an image. An image already exists; the next
  //    element created gets `nextLayerOrder` and must paint above it.
  const page = makePage('blank')
  const layer = page.layers[0]
  layer.images.push(mkImage('photo'))
  layer.texts.push(mkText('caption', nextLayerOrder(layer)))
  layer.strokes.push(mkStroke('scribble', nextLayerOrder(layer)))

  assert(
    drawOrder(layer).join(',') === 'photo,caption,scribble',
    'new text/stroke lands ON TOP of an existing image (no new layer needed)',
  )
  layer.strokes.push(mkStroke('more', nextLayerOrder(layer)))
  assert(
    drawOrder(layer).join(',') === 'photo,caption,scribble,more',
    'each new element stays on top of all previous content',
  )
}

{
  // 3. Hit-testing must respect z-order, not the array push order.
  //    Here the IMAGE sits above the TEXT, so a click hitting both must return
  //    the image (the old stroke->image->text scan would have returned text).
  const overlap = makeLayer('overlap', {
    texts: [mkText('txt', 2)],
    images: [mkImage('img', 9)],
  })
  const bothHit = new Set(['txt', 'img'])
  assert(
    topItem(overlap, bothHit) === 'img',
    'hit-test returns the top-most element by z-order (image above text)',
  )

  const single = makeLayer('single', { images: [mkImage('img', 1)] })
  assert(
    topItem(single, new Set(['img', 'ghost'])) === 'img',
    'hit-test ignores ids that are not in the layer',
  )
  assert(topItem(single, new Set(['ghost'])) === null, 'hit-test returns null when nothing was hit')
}

{
  // 4. arrangeLayer across mixed kinds in a single selection.
  const mixed = makeLayer('mixed', {
    strokes: [mkStroke('s1', 0)],
    images: [mkImage('i1', 1), mkImage('i2', 2)],
    texts: [mkText('t1', 3)],
  })
  const sel = {
    strokes: new Set(['s1']),
    images: new Set(['i1']),
    texts: new Set(['t1']),
  }
  assert(
    arrangeLayer(mixed, sel, 'front') && drawOrder(mixed).join(',') === 'i2,s1,i1,t1',
    'bring to front moves a multi-kind selection to the top, keeping relative order',
  )

  const toBack = makeLayer('toBack', {
    strokes: [mkStroke('s1', 0)],
    images: [mkImage('i1', 1)],
    texts: [mkText('t1', 3)],
  })
  const textSel = { strokes: new Set<string>(), images: new Set<string>(), texts: new Set(['t1']) }
  assert(
    arrangeLayer(toBack, textSel, 'back') && drawOrder(toBack).join(',') === 't1,s1,i1',
    'send to back places the text under images and strokes',
  )

  const forward = makeLayer('forward', {
    strokes: [mkStroke('s1', 0)],
    images: [mkImage('i1', 1)],
    texts: [mkText('t1', 2)],
  })
  assert(
    arrangeLayer(forward, { strokes: new Set(['s1']), images: new Set(), texts: new Set() }, 'forward') &&
      drawOrder(forward).join(',') === 'i1,s1,t1',
    'bring forward swaps one step (stroke moves above the image)',
  )

  // Single-element layer: nothing to arrange, must report no change.
  const lone = makeLayer('lone', { images: [mkImage('i1', 0)] })
  assert(!arrangeLayer(lone, { strokes: new Set(), images: new Set(['i1']), texts: new Set() }, 'front'),
    'a single-element layer reports no z-order change')
}

{
  // 5. Persistence: `order` must survive the load/sync path.
  const src = makeLayer('src', {
    strokes: [mkStroke('s1', 7)],
    images: [mkImage('i1', 3)],
    texts: [mkText('t1', 11)],
  })
  const reloaded = normalizePage({
    id: 'page-1',
    template: 'blank',
    width: 800,
    height: 600,
    layers: [src],
  })
  const layer = reloaded.layers[0]
  assert(
    layer.strokes[0].order === 7 && layer.images[0].order === 3 && layer.texts[0].order === 11,
    'normalizePage (persistence/sync) preserves each element order',
  )
  assert(
    drawOrder(layer).join(',') === 'i1,s1,t1',
    'reloaded layer still renders by its stored z-order',
  )
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
