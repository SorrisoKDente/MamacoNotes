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
  3. **Content Level**: For each visible layer, it draws **Images -> Texts -> Strokes** in that specific order.
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
- **Direct DOM**: High-frequency UI updates (like the tool cursor) bypass React using refs and direct style manipulation.
- **Coalesced Events**: Uses `getCoalescedEvents` for high-precision stylus input smoothing.
