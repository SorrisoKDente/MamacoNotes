# Architecture: Drawing Engine (Renderer)

**English** | [Português](drawing-engine.pt-BR.md)

This document describes the design and implementation of the drawing and rendering engine in Mamaco Notes.

## 1. Overview
`Editor.tsx` instantiates **one** `PageCanvas` (`src/renderer/canvas.ts`) on a `<canvas>`. This engine is responsible for rendering all visual elements, handling coordinate systems, and managing complex gestures.

## 2. Rendering Pipeline
- **Flow**: `render()` -> `renderSinglePage()` (`separate` mode) or `renderContinuous()` (vertical/horizontal).
- **Z-Order**:
  1. **Page Level**: Background template and PDF are drawn first.
  2. **Layer Level**: Iterates `page.layers` from bottom (index 0) to top.
  3. **Content Level**: For each visible layer, its strokes/images/texts are drawn in per-element z-order (`order`; without it, the legacy fallback **Strokes -> Images -> Texts**). See `layerItems` in `src/types.ts`. Consecutive strokes are batched for the erasure-mask pass.
- **Active Stroke**: The current in-progress stroke is drawn on top of everything for immediate feedback.

## 3. Coordinate Systems
- `toPageCoords`: Converts screen pixels to page-relative coordinates.
- `toDocumentCoords`: Converts screen pixels to absolute document coordinates (across multiple pages).
- `toScreenCoords`: Converts internal coordinates back to screen pixels for UI overlays.
- These conversions automatically account for **Pan, Zoom, Page Offset, and Page Rotation**.

## 4. Interaction & Gestures
All gestures are implemented via `PointerEvent` handlers in `Editor.tsx`.

### Drag Modes
Identified by `dragRef.kind`:
- `pan`, `draw`, `erase`, `select-move/resize/rotate`, `region-draw/move`, `text-rotate/resize`, `page-rotate`, `group-resize/rotate`.

### Multi-touch (Mobile)
- **Threshold**: A second finger only activates pan/pinch after moving > `TWO_FINGER_THRESHOLD` (14px) to prevent palm rejection issues.
- **Ownership**: Only the pointer that started a drag (`dragOwnerIdRef`) can commit it.
- **Gestures**:
  - **2 Fingers**: Pan and Zoom only.
  - **3 Fingers**: Page Rotation.
  - **Double Tap (2 Fingers)**: Undo.
  - **Double Tap (3 Fingers)**: Redo.

## 5. Selection Engine
- **Storage**: Set of IDs (`strokes`, `images`, `texts`) in `selectionRef`.
- **Region Tests**: For images, it tests rotated corners and region boundary intersections.
- **Select Delimited Only**: When active, it splits strokes and crops images at the region boundary (`computeDelimitedSelection`).
- **Snapshot/Esc**: Before a destructive selection (like a crop), a snapshot is saved. Pressing `Esc` restores the page to its original state.

## 6. Optimization
- **RAF Loop**: Drawing is decoupled from events using `requestAnimationFrame`.
- **Eraser mask scale**: The intermediate bitmap used to clip strokes uses the
  page's visible scale (`zoom × DPR`), preventing all strokes from becoming soft
  after the first erase at a non-100% zoom.
- **1:1 page-sized blits**: every page-sized bitmap (composite `pageCache`, PDF
  raster, background template, eraser mask) is sized with `ceil` (`pageBitmapSize`) and
  blitted back at `bitmapSize / scale` (`pageBitmapSpan`/`blitPageBitmap`), so one bitmap
  pixel is exactly one device pixel. Blitting it into `0,0,page.width,page.height` at a
  fractional `zoom × DPR` resampled it twice and shifted the PDF text at every pen-down,
  which looked like the page "trembling" while writing. PDF pages therefore keep using the
  composite cache during strokes, with the sharpness of a direct render.
- **Subpixel phase and rotation** (`pageGrid`/`blitRasterBitmap`): paths are
  anti-aliased by their subpixel position, so a phase-0 bitmap blitted at a
  fractional origin re-filters every existing stroke at pen-down. The composite
  cache and the eraser mask are rasterized with the destination's full linear
  transform (`setTransform(a,b,c,d,tx,ty)`, rotation included) and the same
  fractional translation, then blitted at the integer bitmap origin with an
  identity transform and smoothing off. Scale and phase alone identify the
  bitmap, so whole-pixel pans reuse it and rotated pages get a bitmap covering
  their rotated bounding box; when the destination is finer than the pixel
  budget the grid falls back to an axis-aligned span blit. The bitmap is built
  **clipped to the page** and blitted **unclipped** — clipping both passes
  double-attenuated the page edge.
- **Idle cache warm** (`scheduleCacheWarm`): an idle render that finds a valid
  bitmap for the same content but a stale device grid (pan/zoom) rebuilds it
  after 120 ms of stillness, off the stroke path. The next pen-down then blits
  instead of rebuilding the whole page on the first pointermove.
- **Layout during writing**: The canvas rect is reused between frames and refreshed
  only after resize or scroll invalidates it, avoiding forced layout in the hot path.
- **Direct DOM**: High-frequency UI updates (like the tool cursor) bypass React using refs and direct style manipulation.
- **Coalesced Events**: Uses `getCoalescedEvents` for high-precision stylus input smoothing.
