**English** | [Português](PROJECT_STRUCTURE.pt-BR.md)

# Project Structure — Mamaco Notes

This document describes how the **Mamaco Notes** project is organized. The goal is to
serve as an **information location map**: any AI (or person) reading this document should
know which file to look in for a specific feature **without having to explore file by
file**.

> Use **section 9 (Information Search Index)** to quickly locate the code for a specific
> feature.

---

> **⚠️ MANDATORY INSTRUCTION FOR ANY AI**
>
> This document is the **source of truth about the project structure**. If you are to
> **change the operation of any part of this structure** — add, remove, rename, or change
> the signature of files, components, stores, `ink:*` events, data types, features,
> flows, or platforms — you **MUST update this document in the same change**. Keep it
> synchronized with the code:
>
> - new/removed/renamed files → **section 4 (File map)**;
> - changes in store fields or actions → **section 5.5 (Store contracts)**;
> - new persisted types/fields or IndexedDB changes → **sections 5.1 and 5.2**;
> - new/changed `ink:*` events → **section 7 (Communication between components)**;
> - new features, tools, or flows → **section 9 (Search index)** and other affected
>   sections;
> - add/remove/move UI strings or create an i18n system → **section 11 (Translation)**.
>
> **Do not finish the task with this document outdated in relation to the code.**

---

## 1. Overview

**Mamaco Notes** is a digital note-taking app with stylus support (Samsung Notes style)
for **Windows and Linux (Electron desktop)**, **browser (PWA)**, and **Android
(Capacitor)**. The user creates notebooks and folders, draws/edits strokes with pen,
highlighter, eraser, inserts text, images, and PDFs, and can sync everything with a
**WebDAV** server (Nextcloud, ownCloud, Koofr, etc.).

The frontend is **React + TypeScript + Vite**. Drawing happens in **Canvas 2D** with a
custom engine (`PageCanvas`). Data is persisted in **IndexedDB** (with optional disk
backup via Electron or File System Access API). The global state uses **Zustand**. The
entire UI is in Portuguese (pt-BR) by default, but supports English (en).

---

## 2. Tech Stack

| Layer | Technology | Where |
|---|---|---|
| UI | React 18 + TypeScript | `src/components/*`, `src/App.tsx` |
| Build / dev server | Vite 6 | `vite.config.ts` |
| Global state | Zustand | `src/store.ts`, `src/uiStore.ts`, `src/textStore.ts` |
| Local persistence | IndexedDB | `src/db.ts` |
| Drawing rendering | Canvas 2D (custom engine) | `src/renderer/canvas.ts` |
| PDF | `pdfjs-dist` | `src/utils/pdf.ts` |
| Desktop | Electron | `electron/main.cjs`, `electron/preload.cjs` |
| Android | Capacitor | `capacitor.config.ts` |
| PWA | `vite-plugin-pwa` | `vite.config.ts` |
| Packaging | electron-builder | `package.json` → `build` |

---

## 3. Entry points and platforms

The app runs in 4 environments and detects each one at startup:

| Platform | Detection | Entry point |
|---|---|---|
| Web / PWA | Absence of `window.inkfolioDesktop` and `window.Capacitor` | `index.html` → `src/main.tsx` |
| Desktop (Electron) | `window.inkfolioDesktop` exists | `electron/main.cjs` loads `index.html` |
| Android (Capacitor) | `window.Capacitor` exists | `capacitor.config.ts` + `dist/` |

Initialization flow:

1. `index.html` → `src/main.tsx` — registers the PWA service worker (web only),
   mounts `<App />`.
2. `src/App.tsx` — calls `useAppStore.init()`; when finished, if cloud sync is
   enabled with auto-sync, it triggers `syncNow()`. It registers global shortcuts,
   `ink:*` event listeners, and the back button listener (Capacitor, via
   `@capacitor/app`, which re-dispatches `ink:esc`).
3. `src/store.ts init()` — loads folders, notebooks, settings, and templates from
   IndexedDB (`db.ts`); creates an initial notebook if none exists.

---

## 4. File map by directory

### Root

| File | Responsibility |
|---|---|
| `package.json` | Scripts (dev, build desktop/win/linux, android), dependencies, electron-builder config (including interactive NSIS installer) |
| `vite.config.ts` | React/PWA plugins, `base: './'`, dev server (port 5173, `allowedHosts` for preview) |
| `tsconfig.json` | TypeScript config (strict) |
| `index.html` | Base HTML; loads `src/main.tsx` |
| `capacitor.config.ts` | Capacitor config (Android) |
| `.gitignore` | Ignored files |
| `server2.mjs` | Empty file (remnant) |

### `src/` — application code (the core)

| File | Responsibility |
|---|---|
| `src/main.tsx` | React Bootstrap + PWA registration |
| `src/App.tsx` | Root component; screen composition (TopBar, Sidebar, PageList, Editor, Toolbar, Modals); init + auto-sync; Escape key → `ink:esc`; Android back button (Capacitor `@capacitor/app`) → `ink:esc` |
| `src/types.ts` | **All domain data types** + `DEFAULT_SETTINGS` + `DEFAULT_SHORTCUTS` + factories (`makePage`, `makeNotebook`, `makeFolder`, `makeLayer`, `makeTextElement`, `uid`, `newId`) + layer helpers (`normalizePage`, `getActiveLayer`) |
| `src/db.ts` | **IndexedDB persistence layer** (object stores: `folders`, `notebooks`, `settings`, `cloudSync`, `templates`); version migration fills missing `order` field in old folders/notebooks and converts old pages (flat arrays) to the layer model (`migrateLayers`) |
| `src/store.ts` | **Main store (Zustand)**: all CRUD for notebooks/folders/pages/templates, layer actions (add/rename/duplicate/delete/reorder/visibility/opacity/lock/active/merge), undo/redo, clipboard, sync, persistence |
| `src/uiStore.ts` | Modal store (`openModal`, `modalData`, `open`, `close`) |
| `src/textStore.ts` | Text editing state (draft, selection, rotation) |
| `src/styles.css` | All app CSS |

#### `src/components/` — React components

| File | Responsibility |
|---|---|
| `TopBar.tsx` | Top bar: sidebar/page toggles (always visible; if panel is hidden by `settings.hideSidebar`/`hidePageList`, the toggle re-shows it), notebook title (renamable), Image/PDF/Page/Export/Sync/Settings/Fullscreen buttons |
| `Sidebar.tsx` | Folder/notebook tree, context menu, **drag-and-drop reordering and moving** (custom DnD via Pointer Events, works with mouse and touch; dragging over a folder moves inside it; insertion position indicator; autoscroll), **multiple selection** (CTRL/Meta click toggles, SHIFT click selects range between anchor and clicked item, **long touch on touchscreens toggles selection**; selection bar with copy/cut/paste/duplicate/delete; hidden page count via `settings.hidePageCount`), resizable bar (`sidebar-resizer` handle, width persisted in `settings.sidebarWidth`, limit 160–min(520, 50% of window)); context menu "…" closes when clicking outside (global `pointerdown` listener) |
| `PageList.tsx` | Page preview (thumbnails), search by number, view mode (V/H/S), drag-drop, per-page menu, multiple page selection (CTRL click toggles, SHIFT click selects range; selection bar with duplicate/export PDF/rotate/delete) |
| `Editor.tsx` | **Largest component (~2900 lines)**: editing canvas, zoom/pan, drawing, eraser, selection, inline text, pointer gestures (including two-finger double tap = Undo), all drags |
| `Toolbar.tsx` | Side toolbar: pen/highlighter/eraser/text/select/move/rotation, undo/redo, per-tool configuration panels |
| `LayersPanel.tsx` | Layers panel (right side): current page layers list (bottom→top inverted in UI), single/multiple selection (CTRL/SHIFT and long touch), drag reordering, inline rename, toggle visibility/lock, opacity, add/duplicate/delete/merge layers; fixed footer with page background color |
| `Modals.tsx` | **All modals**: new notebook, page, template, import image/PDF, export, settings, cloud, move/copy, background color, sync conflicts, prompt, confirmation |

#### `src/renderer/` — drawing engine (Canvas)

| File | Responsibility |
|---|---|
| `canvas.ts` | `PageCanvas` class: renders pages (continuous/separate), layers (visibility/opacity), strokes, images, texts, PDF, templates, selection; coordinate conversion; hit tests |
| `drawUtils.ts` | Pure drawing functions reused by thumbnail/export: `drawTemplate`, `drawLayer`, `drawStroke`, `drawTextOnCanvas` |
| `thumbnail.ts` | Generates page thumbnails (used in PageList and custom templates) |

#### `src/utils/` — support logic

| File | Responsibility |
|---|---|
| `layout.ts` | Offset/position calculation for pages in continuous mode (vertical/horizontal), `pageVisualRect`, `pageUnderPoint` |
| `drawText.ts` | Measuring and drawing text elements (horizontal/vertical, markers, underline/strikethrough) |
| `export.ts` | Page rendering to canvas and PNG/PDF export (generates simple PDF without external library) |
| `pdf.ts` | Rendering PDF files to images via `pdfjs-dist` (`renderPdfPages`) |
| `webdav.ts` | WebDAV transport (PROPFIND/MKCOL/PUT/DELETE fetch), special Koofr support, `makeTransport` |
| `sync.ts` | **Bidirectional synchronization algorithm** (merge, conflicts, tombstone, migration) |
| `backup.ts` | Export/import full JSON backup (folders, notebooks, and settings; sanitizes `saveDirectory`/handle) |
| `localSave.ts` | Automatic backup to disk (Electron) or browser directory (File System Access), in the same format as manual backup (includes settings) |
| `imageErase.ts` | Eraser on images: offscreen canvas erasing session and re-encode at the end |
| `colors.ts` | Color palette and HEX/RGB conversion helpers |
| `fonts.ts` | System fonts list (Local Font Access) with fallback |
| `shortcuts.ts` | Key normalization, shortcut lookup by action, pt-BR labels |
| `fullscreen.ts` | Fullscreen toggle |

#### `src/i18n/` — translation system

| File | Responsibility |
|---|---|
| `languages.ts` | `Language` type (`'pt-BR' | 'en'`), `SUPPORTED_LANGUAGES` (selector options), `detectLanguage()` (auto-detect via `navigator.language`) |
| `ptBR.ts` | pt-BR dictionary (`ptBRMessages`) — source of truth, full text |
| `en.ts` | English dictionary (`enMessages`) — same set of keys |
| `index.ts` | Current state, `t()` (with `{{param}}` interpolation and fallback en → pt-BR → key), `setLanguage()`, `getLanguage()`, `useI18n()` (re-render via `useSyncExternalStore`), `applyDocumentLanguage()` (title + `<html lang>`) |

#### `src/hooks/`

| File | Responsibility |
|---|---|
| `useShortcuts.ts` | `initGlobalShortcuts()` — shortcut map → global action; `useEditorShortcuts()` |
| `useIsMobile.ts` | Mobile detection (media query `(max-width:1024px) and (pointer:coarse)`) |

### `electron/` — desktop

| File | Responsibility |
|---|---|
| `main.cjs` | Main process: window, menu, IPC handlers (`pick-directory`, `write-file`, `read-file`, `save-file`, `open-file`) |
| `preload.cjs` | Bridge `window.inkfolioDesktop` (contextIsolation) |

### Others

| Path | Responsibility |
|---|---|
| `public/` | PWA static icons (favicon, apple-touch-icon, pwa-192/512, maskable) |
| `build-resources/` | Desktop packaging icons (icon.ico, icon.png) |
| `docs/superpowers/specs/` | Approved design documents (bidirectional sync; layers) |
| `docs/superpowers/plans/` | Implementation plans (bidirectional sync; layers) |
| `server2.mjs` | Empty file (remnant) |

---

## 5. Data and state architecture

### 5.1 Data model (definitions in `src/types.ts`)

Hierarchy: **Folder** → **Notebook** → **Page** → **Layer** → (Stroke | ImageElement | TextElement) + PdfBackground (page background, outside layers)

- `Folder { id, name, parentId, createdAt, order? }` — nested folders; `order` is the position among siblings of the same `parentId` (used in drag-and-drop reordering).
- `Notebook { id, name, folderId, pages, createdAt, updatedAt, order? }` — notebook; `order` is the position among notebooks of the same `folderId` (used in drag-and-drop reordering).
- `Page { id, template, width, height, rotation, backgroundColor, layers, activeLayerId, pdf?, createdAt, updatedAt }` — all editable content resides in **layers**; `activeLayerId` persists the active layer (falls back to the last one in the array if null/non-existent). The old flat arrays `strokes`/`images`/`texts` have been **removed**.
- `Layer { id, name, visible, opacity, locked, strokes, images, texts }` — content layer. `layers` array order: **index 0 = bottom** (drawn first), **last = top**. Inside each layer, the sub-drawing order is **images → texts → strokes**. A locked layer (`locked: true`) receives no content and is not editable on the canvas (draw/erase/select/move), but can still be renamed, reordered, duplicated, deleted, hidden, have its opacity adjusted, become active, and participate in a merge.
- `Stroke { id, kind(pen|highlighter), color, size, points[] }` — stroke with pressure.
- `ImageElement { id, name, dataUrl, x, y, width, height, rotation }`.
- `TextElement { id, text, x, y, width, rotation, fontSize, fontFamily, bold, italic, underline, strikethrough, color, backgroundColor, align, marker, direction, createdAt }`.
- `PdfBackground { dataUrl, name, pageNumber }` — PDF used as page background (resides **at page level**, below all layers; not a `Layer`).
- `AppSettings` — all configurations (pen color/size, eraser, modes, shortcuts, `cloud`, hide top bar/tools via `hideTopBar`/`hideToolbar`, hide notebook/page list sidebar via `hideSidebar`/`hidePageList`, hide page count via `hidePageCount`, hide the tool cursor over the page via `hideToolCursor`, ignore a specific update version via `ignoreVersion`, select delimited only via `selectDelimitedOnly`, sidebar width via `sidebarWidth`).
- `CloudSettings` / `CloudSyncState` / `SyncManifest` / `SyncConflictItem` — sync data.

> Whenever you need to change the format of persisted data, start with `src/types.ts`
> and then check normalization in `src/store.ts` (`applySyncChanges`, `init`,
> `replaceAllData` functions) and in `src/db.ts`.
>
> **Layers**: `makePage` creates a page with 1 default layer "Camada 1" (or "Layer 1")
> (`visible: true`, `opacity: 1`, `locked: false`). `normalizePage(page)` (pure function in
> `types.ts`) converts legacy/partial pages: if `layers` is missing/empty, it creates 1
> layer from old flat arrays; normalizes each layer defensively; validates `activeLayerId`
> (fallback last layer) and **removes** legacy flat fields from the result.
> `getActiveLayer(page)` resolves the active layer (or the last one).

### 5.2 Persistence (IndexedDB) — `src/db.ts`

Database `mamaco-notes`, version **5**, with object stores:

| Store | Content | Key |
|---|---|---|
| `folders` | `Folder[]` | `id` |
| `notebooks` | `Notebook[]` (Full JSON, includes pages and drawings) | `id` |
| `settings` | 1 record `{ id:'main', ...AppSettings }` | `id` |
| `cloudSync` | 1 record `CloudSyncState` | `id` |
| `templates` | `PageTemplate[]` (custom templates) | `id` |

All data writes in the app go through `store.ts`, which calls `db.*` and then
`scheduleLocalBackup()` (disk/directory backup).

> **Migration 3 → 4**: when opening the database in the new version, `openDb()` executes
> `migrateOrders()` (idempotent) which fills `order` in old folders/notebooks without the
> field — per `parentId`/`folderId` group, sorting folders by `createdAt` (asc) and
> notebooks by `updatedAt` (desc); records that already have `order` are preserved and
> those without `order` receive values after the largest existing one. In-memory
> normalization continues in `store.ts` (`fillFolderOrder`/`fillNotebookOrder`) for data
> coming from sync/backup.
>
> **Migration 4 → 5 (layers)**: in addition to `migrateOrders`, `openDb()` executes
> `migrateLayers()` (idempotent): it iterates through the `notebooks` object store and
> rewrites each page using `normalizePage` — old pages with flat arrays get a single layer
> with content preserved; pages already with `layers` are not changed. Data coming from
> sync/backup is also normalized on read (`store.ts`/`sync.ts`), so the `SyncManifest` has
> not changed versions.

### 5.3 Stores (Zustand)

- **`useAppStore`** (`src/store.ts`) — main global state:
  - Data: `folders`, `notebooks`, `templates`, `settings`, `dataVersion` (incremented with
    each persistence; used for re-render and auto-sync).
  - Selection/UI: `selectedFolderId`, `selectedNotebookId`, `selectedIds`,
    `currentPageIndex`, `tool`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`,
    `rotationOpen`.
  - CRUD Actions: `createNotebook`, `addPage`, `updatePage`, `deleteNotebook`, `moveFolder`,
    `reorderFolder`, `reorderNotebook`, `duplicateFolder`, etc.
  - Undo/redo: `pushUndo`, `undo`, `redo` (internal stacks, page snapshots, max 60 entries).
  - Cloud: `syncNow()`, `resolveConflicts()`.
  - Persistence: `persistNotebook`, `updateNotebookStorage`, `saveSettings`.
  - **Auto-sync**: `useAppStore.subscribe` watches `dataVersion` and triggers `syncNow()`
    with a 20s debounce (`syncRunning`/`syncQueued` guards).
  - **Session restoration**: a second `useAppStore.subscribe` saves to `localStorage`
    (key `mamaco-notes.last-session`) the `{ notebookId, pageId }` pair whenever the
    current notebook or page changes; `init()` uses this record to reopen the last
    opened note/page (falling back to nothing selected if the record doesn't exist or
    the notebook was deleted).
- **`useUiStore`** (`src/uiStore.ts`) — which modal is open + modal data.
- **`useTextStore`** (`src/textStore.ts`) — text draft, draft position/rotation, selected
  text, editing mode.

### 5.4 Typical data flow

```
Toolbar/Editor/Modals/Sidebar
        │  (calls store action)
        ▼
useAppStore (store.ts) — mutates state + increments dataVersion
        │
        ▼
db.ts (IndexedDB)  ──►  scheduleLocalBackup()  ──►  localSave.ts (disk)
        │
        ▼
useAppStore.subscribe (auto-sync)  ──►  syncNow()  ──►  webdav.ts + sync.ts (cloud)
```

### 5.5 Store contracts (public interface)

> **Contract** = a store's public interface: the state it exposes, the actions that can be
> called, and the guarantees it maintains. Corresponds to the interface declaration at the
> top of each file (`interface AppState`, `interface UiState`, `interface TextUiState`).
> Whoever reads the contract knows what they can consume without reading the
> implementation.
>
> To **add a new field or action**, change the interface + the implementation — components
> depend only on the contract, so the internal implementation can be rewritten without
> breaking consumers. **Any change here requires updating this document.**

#### `useAppStore` (`src/store.ts:189`) — main store

| Group | Contract |
|---|---|
| **Data** | `loaded: boolean`, `folders: Folder[]`, `notebooks: Notebook[]`, `templates: PageTemplate[]`, `settings: AppSettings`, `dataVersion: number` |
| **Selection/UI** | `selectedFolderId`, `selectedNotebookId`, `selectedIds: string[]`, `selectedPageIndices: number[]`, `clipboard: { ids, cut } | null`, `currentPageIndex`, `tool: ToolKind`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`, `canUndo`, `canRedo` |
| **Bootstrap** | `init(): Promise<void>` |
| **Navigation/Selection** | `selectFolder(id)`, `selectNotebook(id)`, `selectPage(index)`, `setTool(tool)`, `setRotationOpen(open)`, `toggleSidebar()`, `togglePageList()`, `toggleLayers()`, `setSidebarOpen(open)`, `setPageListOpen(open)`, `setLayersOpen(open)`, `toggleSearch()` |
| **Selection Editing** | `toggleSelect(id)`, `clearSelection()`, `setSelectedIds(ids)`, `copySelected()`, `cutSelected()`, `pasteClipboard()`, `duplicateSelected()`, `deleteSelected(scope?)` |
| **Page Selection** | `selectedPageIndices`, `toggleSelectPage(index)`, `setPageSelection(indices)`, `clearPageSelection()`, `duplicateSelectedPages()`, `deleteSelectedPages()`, `rotateSelectedPagesBy(delta)` |
| **Folders** | `addFolder(name, parentId?)`, `deleteFolder(id, scope?)`, `renameFolder(id, name)`, `moveFolder(id, newParentId)`, `reorderFolder(id, parentId, beforeId)`, `duplicateFolder(id)`, `copyFolder(id, targetParentId)` |
| **Notebooks** | `createNotebook(name, folderId, template)`, `createNotebookFromTemplate(...)`, `deleteNotebook(id, scope?)`, `moveNotebook(id, folderId)`, `reorderNotebook(id, folderId, beforeId)`, `copyNotebook(id, folderId)`, `duplicateNotebook(id)`, `updateNotebook(notebook)` |
| **Pages** | `addPage(template)`, `addPageAfter(index, template)`, `duplicatePage(index)`, `deletePage(index)`, `movePage(from, to)`, `rotatePage(index)`, `rotatePageBy(index, delta)`, `updatePage(index, patch: Partial<Page>)` |
| **Layers** | `addLayer()`, `renameLayer(index, name)`, `duplicateLayer(index)`, `deleteLayer(index)`, `moveLayer(from, to)`, `setLayerVisible(index, visible)`, `setLayerOpacity(index, opacity)` (0..1), `setLayerLocked(index, locked)`, `setActiveLayer(id)`, `mergeSelectedLayers(indices)` |
| **Configuration** | `setSettings(patch)`, `setShortcut(action, value)`, `setCloud(patch)` |
| **Cloud** | `syncNow(): Promise<SyncResult | null>`, `resolveConflicts(choices: Record<string, ConflictChoice>)` |
| **Persistence/Undo** | `persistNotebook(notebook)`, `pushUndo()`, `undo()`, `redo()` |
| **Import/Templates** | `addImageToPage(dataUrl, name, center?)`, `addPdfToPage(dataUrl, name)`, `importPdfNotebook(...)`, `addTemplate(name, pages)`, `deleteTemplate(id)`, `addPagesFromTemplate(template)`, `applyTemplateToPage(index, template)`, `replaceAllData(folders, notebooks, settings?)` |

**Guarantees**: every data action writes to IndexedDB (`db.ts`), increments `dataVersion`
(triggers re-render and auto-sync), and schedules local backup (`scheduleLocalBackup`).
Page/notebook operations act on the selected notebook/index. Undo/redo use internal
page snapshot stacks (max 60). Folders and notebooks are always sorted by `order`
(`sortFoldersByOrder`/`sortNotebooksByOrder`); `reorderFolder`/`reorderNotebook`
recalculate the `order` of siblings within the same level (`parentId`/`folderId`), and
`moveFolder`/`moveNotebook` delegate to `reorder*` moving to the end of the destination.
Old data without `order` (sync/backup) is normalized by `fillFolderOrder`/`fillNotebookOrder`.

**Layer Guarantees**: every layer action resolves the selected notebook + current page,
calls `pushUndo()`, mutates `page.layers`/`page.activeLayerId`, updates `page.updatedAt`,
and persists via `updateNotebookStorage`. Non-standard actions: with no page or 0 layers
(all), `addLayer`/`duplicateLayer`/`mergeSelectedLayers`/`setActiveLayer` are **not**
blocked when the page is locked (they operate on the structure). `deleteLayer` is
**blocked** when `layers.length <= 1`; when deleting, the active one passes to the closest
layer (preferring the one below). `mergeSelectedLayers` requires ≥ 2 indices: merges
selected layers in bottom→top order, the result occupies the position of the top-most one
(with its `name`/`visible`/`opacity`), becomes **unlocked** (`locked: false`), and becomes
active; non-selected layers preserve relative order. `addImageToPage` resolves the active
layer and **aborts** if it is locked. Layer actions increment `dataVersion` (re-renders
Editor and `LayersPanel`) — they do not use `ink:*` events.

#### `useUiStore` (`src/uiStore.ts:22`) — modals

| Field/Action | Type |
|---|---|
| `openModal` | `ModalName | null` (closed set of 17 values, listed at the top of the file) |
| `modalData` | `Record<string, unknown>` (payload of the open modal) |
| `open(name, data?)` | Opens the modal and stores the payload |
| `close()` | Closes the modal and resets `modalData` |

**Guarantees**: there is **only one open modal at a time**; `modalData` carries the payload
(e.g., the question/answer for `prompt`).

#### `useTextStore` (`src/textStore.ts:3`) — text editing

| Field/Action | Type |
|---|---|
| `draft` | `string` (draft of the text being typed) |
| `draftPos` | `{ x, y } | null` (draft position on the page) |
| `draftRotation` | `number` (draft rotation) |
| `selectedTextId` | `string | null` |
| `editingExisting` | `boolean` (true when editing an existing text) |
| `setDraft(text)`, `setDraftPos(pos)`, `setDraftRotation(rot)`, `selectText(id)`, `setEditingExisting(editing)` | individual setters |
| `reset()` | Resets the entire state at once |

**Guarantees**: `reset()` clears everything — used when confirming/canceling editing, so
`Editor` can call it trusting that no draft state survives.

---

## 6. Drawing engine (renderer)

`Editor.tsx` instantiates **one** `PageCanvas` (`src/renderer/canvas.ts`) on a `<canvas>`.
Key points:

- **Rendering**: `render()` → `renderSinglePage()` (`separate` mode) or
  `renderContinuous()` (vertical/horizontal). The background/template and PDF are drawn at
  **page level** (below everything). Then `renderPageContent()` iterates `page.layers` in
  order (bottom → top) and, for each **visible** layer, applies `ctx.globalAlpha =
  layer.opacity` and draws, in order, the **images → texts → strokes** of that layer
  (`ctx.save`/`restore` per layer). The current stroke (`currentStroke`) is drawn on top,
  on the current page. Selection/hit-test functions (`selectionBounds`, `drawStrokeBoxes`,
  `drawImageBoxes`, text boxes) iterate through the arrays of the **active layer**.
- **Coordinates**: `toPageCoords` / `toDocumentCoords` / `toPageCoordsAt` / `toScreenCoords`
  conversions (apply pan, zoom, page offset, and page rotation).
- **Interaction**: `Editor.tsx` implements all gestures via `PointerEvent` handlers
  (`onPointerDown/Move/Up`), a `dragRef` with a `kind` that identifies the operation:
  `pan | draw | erase | select-move | select-resize | select-rotate | region-draw |
  region-move | text-rotate | text-resize | page-rotate | group-resize | group-rotate`.
- **Multi-touch (mobile)**: `Editor.tsx` tracks active pointers in `activePointersRef`
  (updated in `onPointerDown`/`onPointerMove`). A second finger does not immediately
  interrupt a stroke: it only activates the move/pinch gesture after moving more than
  `TWO_FINGER_THRESHOLD` (14px), preventing the palm from canceling a drawing. Once 2
  fingers are confirmed, `dragRef` becomes `pan` with `multiTouch: true`: finger
  spreading/pinching applies zoom (`applyZoomAt`, factor = distance ratio) around the
  midpoint, and midpoint displacement moves the screen. Gesture state: `pinchRef`
  (previous distance/midpoint) and `pendingTwoFingerRef` (candidate finger to confirm
  gesture). The canvas performs `preventDefault` on touch/pen `pointerdown` and only uses
  explicit `setPointerCapture` for mouse (touch/pen use browser implicit capture).
  The pointer that started a drag is tracked in `dragOwnerIdRef`; **only the owner's
  `pointerup` commits the content drag** (draw/erase/region selection) — a non-owner
  finger lifting no longer prematurely ends or commits the stroke. When a second finger
  joins a content drag (`dragInterruptedByTouchRef`), the gesture is considered a
  potential tap/palm: on the owner's `pointerup`, if the multi-touch was tap-like
  (other fingers still down, or `multiTouchDownAtRef` within `TWO_FINGER_TAP_MAX_MS`),
  the in-progress content is **discarded** (stroke not committed, region not finalized),
  so a multi-finger tap never creates stray strokes/selections nor clears the
  undo/redo stacks.
  - **Two-finger double tap = Undo**: a 2-finger "tap" is recognized when both pointers
    go up without significant displacement (`pointerDownPosRef` stores the initial
    position of each finger; if the first finger has already moved more than
    `TWO_FINGER_THRESHOLD`, the candidate is discarded to not confuse with the palm)
    and the time between the second finger going down and all going up is ≤
    `TWO_FINGER_TAP_MAX_MS` (300ms). Two such taps with an interval ≤
    `TWO_FINGER_DOUBLE_TAP_GAP_MS` (400ms) between the end of one and the end of the other
    trigger `useAppStore.undo()` — the equivalent of "Undo". The first tap only sets the
    timer; `lastTwoFingerTapAtRef` stores the instant of the last tap.
  - **Three-finger double tap = Redo**: mirrors the 2-finger gesture, but the candidate
    is only armed when the third pointer goes down (`threeFingerDownAtRef`; reset if a
    pan/pinch starts). Two 3-finger taps within the same time windows
    (`TWO_FINGER_TAP_MAX_MS` / `TWO_FINGER_DOUBLE_TAP_GAP_MS`) trigger
    `useAppStore.redo()`. `lastThreeFingerTapAtRef` stores the instant of the last tap.
    Because multi-finger taps discard the in-progress content drag, they no longer push
    a spurious undo entry that would clear the redo stack before `redo()` runs.
  - **Gesture split: 2 fingers move/zoom, 3 fingers rotate**: the two-finger pan/pinch
    applies **only** pan and zoom. Page rotation is a **three-finger** gesture: while 3
    pointers are down, the rotation of the angle between the two farthest fingers
    (`rotationPair`/`angleBetween` in `Editor.tsx`) is applied to `page.rotation`
    (degrees), following the `page-rotate` convention (clockwise rotation on the screen
    increases the angle). The base angle/rotation are captured in
    `drag.startAngle`/`drag.startRotation` when the gesture is confirmed and recaptured
    when a new multi-touch phase begins (a new finger joining resets `pinchRef`,
    avoiding jumps). `pushUndo()` is called **only once per gesture**, just when the
    rotation starts to be applied (`pinchRotationUndoPushedRef` flag), and the change
    is persisted via `schedulePersist()`.
  - **Rotations never push empty undo**: `pushUndo()` is called **only when a real
    change is applied** to the page. Strokes are pushed on commit in `onPointerUp`
    (only if `stroke.points.length >= 2`); the eraser pushes only if `session.commit()`
    returned changed elements (both at the end of the gesture and on abort by
    multi-finger pan); and both the 3-finger rotation gesture and `page-rotate` (free
    rotation selection) push on the first movement that changes the real angle
    (`|delta| > 1°`, `pinchRotationUndoPushedRef`/`pageRotateUndoPushedRef` flags).
    This avoids undo entries identical to the current page — the root cause of "2-finger
    Undo doing nothing and Redo flashing without effect".
- **Selection**: `Set` structures of IDs (`strokes`, `images`, `texts`) in `selectionRef`;
  regions (rect/circle/lasso) in `selectionRegionRef`; internal selection clipboard.
  Region selection (`computeSelection` in `Editor.tsx`) tests, for images, rotated center
  and corners within the region **and also** the intersection between the region boundary
  and image outline (`imageInRegion` + `regionBoundaryIntersectsImage`/
  `regionPointInsideImage` helpers), so that a region covering only part of an image
  selects it. In **any selection mode**, clicking on an image handle
  (`hitTestImageHandles` in `canvas.ts`) starts resize/rotate
  (`select-resize`/`select-rotate`), even within region modes. The **circle** region is
  defined by two points that are diameter endpoints (center = midpoint, radius = half the
  distance) — `circleCenterRadius` in `Editor.tsx` —, so the click point is on the edge
  and the circle grows in the drag direction.
  - **Select delimited only** (`settings.selectDelimitedOnly`, checkbox in
    `SelectPanel`): when active, `finalizeRegion` (`Editor.tsx`) calls
    `computeDelimitedSelection`, which **splits** strokes partially covered by the region
    (`splitStrokeByRegion`, portions inside become new selected strokes and portions
    outside remain unselected) and **crops** images partially covered
    (`cropImageToRegion`, async — the image is replaced by two `ImageElement`s: the part
    outside the region remains on the page unselected and the delimited part becomes a new
    selected crop, respecting rotation). Texts maintain current behavior (entire block).
    The page is modified at selection time (reversible with Undo); `cropVersionRef`
    invalidates obsolete async conclusions. Before the first mutation, a page snapshot
    is stored in `delimitedSnapshotRef` (`Editor.tsx`); **the Esc key (`onKey`) restores
    this snapshot** — strokes, images, and texts return to their original format (the crop
    is undone). The snapshot is cleared when switching tools, changing pages, starting a
    new selection, or performing any action that uses `pushUndo`.
- **Eraser on images**: `ImageEraseSession` (`utils/imageErase.ts`) maintains offscreen
  canvases and only re-encodes at the end of the gesture.
- **Text**: inline editing with an overlaid `<textarea>` (`InlineTextInput`); commit via
  `commitDraftAt`/`commitInlineText`; formatting measured by `utils/drawText.ts`.
- **Thumbnails/exporting** do not use `PageCanvas`; they use `renderer/drawUtils.ts` (pure
  functions) to redraw the page in another canvas — `drawLayer` applies the layer's
  `globalAlpha` and draws images→texts→strokes, respecting per-layer visibility and
  opacity (thumbnail and export load the images from each layer to apply the correct
  opacity).

---

## 7. Communication between components (`ink:*` events)

The app uses `window.dispatchEvent(new CustomEvent(...))` to couple UI and canvas without
passing props. **Full list of events** (in alphabetical order) and where they are
triggered/heard:

| Event | Payload | Triggered by | Heard in |
|---|---|---|---|
| `ink:add-page` | — | `addPage` shortcut (`useShortcuts.ts`) | `Editor.tsx` (re-dispatches `ink:request-add-page`) |
| `ink:esc` | — | Escape key (`App.tsx`) and Android back button (`App.tsx`, `@capacitor/app` plugin; no listener on web) | `Sidebar.tsx` (closes context menu), `Toolbar.tsx` (closes tool panel and rotation panel), `PageList.tsx` (closes page menu), `Modals.tsx` (`ModalsHost` closes the open modal — top menu submenus), `Editor.tsx` (clears selection in selection mode and restores delimited selection snapshot) |
| `ink:image-rotate` | `number` (degrees) | `Toolbar.tsx` (Selection panel) | `Editor.tsx` |
| `ink:image-selected` | `{ id }` | `Editor.tsx` | `Toolbar.tsx` (Selection panel) |
| `ink:recenter` | — | `recenter` shortcut | `Editor.tsx` |
| `ink:request-add-page` | — | `Editor.tsx` (`onAddPage`, re-dispatch of `ink:add-page`) | `App.tsx` (opens `addPagePicker`) |
| `ink:save` | — | `save` shortcut | `App.tsx` (persists current notebook) |
| `ink:selection-action` | `'copy'|'cut'|'paste'|'duplicate'|'delete'` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:selection-rotate` | `{ delta }` (degrees) | `Toolbar.tsx` (Selection panel) | `Editor.tsx` |
| `ink:text-commit-center` | — | (not triggered in current code; only heard) | `Editor.tsx` |
| `ink:text-delete` | — | `Toolbar.tsx` | `Editor.tsx` |
| `ink:text-rotate` | `{ id, degrees }` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:text-update` | `{ id, patch }` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:zoom` | `1 | -1 | 0` | zoom shortcuts | `Editor.tsx` |

---

## 8. WebDAV Sync (Cloud)

Flow and files involved:

- **UI/Configuration**: `Modals.tsx` → `SettingsModal` ("Cloud" tab) and `CloudSyncModal`.
- **HTTP Transport**: `src/utils/webdav.ts` — `makeTransport(cloud)` returns a `Transport`
  interface `{ ensureDirectory, listDirectory, uploadFile, downloadFile, deleteRemoteFile }`
  (PROPFIND/MKCOL/PUT/DELETE). Handles **Koofr** servers specially (creates folders via
  API when WebDAV does not support MKCOL).
- **Merge Algorithm**: `src/utils/sync.ts` — `runSync()` and `applyConflictChoices()`.
  Remote layout: `manifest.json` + `notebooks/<id>.json` + `folders/folders.json`.
  Compares `local.updatedAt`, `remote.updatedAt`, and `cloudSync.notebooks[id]` to decide
  on push/pull/delete/conflict. The folder hash (`hashFolders`) includes `id`, `name`,
  `parentId`, and `order`, so **folder reordering is synced** like any other folder
  change.
- **Local Sync State**: `db.ts` → `cloudSync` (`CloudSyncState`).
- **Orchestration**: `store.ts` → `syncNow()` (reentrancy guard + debounce),
  `resolveConflicts()`.
- **Detailed Design/Plan**: `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md`
  and `docs/superpowers/plans/2026-08-17-sync-bidirecional-plan.md`.

---

## 9. Information Search Index

> "Where is the code that does X?" — consult the table below.

### Drawing / Editing Tools

| Subject | File(s) |
|---|---|
| Move screen | `src/components/Editor.tsx` (`pan` tool). Supports dragging with the mouse/touch, or **holding the configured shortcut** (default: `Alt`) to pan temporarily with any tool active. Key state is tracked via `pressedKeysRef`. |
| Strokes: drawing and pressure | `src/renderer/canvas.ts` (`beginStroke`, `extendStroke`, `tracePressurePolyline`) |
| Stroke eraser | `src/components/Editor.tsx` (`eraseAtPage`, `eraseSegment`) |
| Image eraser | `src/utils/imageErase.ts` + `Editor.tsx` |
| Selection modes (click/lasso/circle/rect) | `src/components/Toolbar.tsx` (`SelectPanel`) + `Editor.tsx` |
| Select delimited only (split stroke / crop image) | `Toolbar.tsx` (`SelectPanel` → `settings.selectDelimitedOnly`) + `Editor.tsx` (`computeDelimitedSelection`, `splitStrokeByRegion`, `cropImageToRegion`) |
| Move/resize/rotate selected image | `Editor.tsx` (`select-move/resize/rotate`) + `canvas.ts` |
| Rotate selection (±15° step via panel) | `Toolbar.tsx` (`SelectPanel`, `ink:selection-rotate` event) + `Editor.tsx` (`rotateGroupBy`); the panel allows typing degrees manually and a button resets to 0° |
| Page rotation (screen) | `Toolbar.tsx` (`RotationPanel`) + `Editor.tsx` (`page-rotate`) |
| Inline text (typing in place) | `Editor.tsx` (`InlineTextInput`, `commitInlineText`) |
| Text formatting (font, markers, direction) | `src/utils/drawText.ts` + `Toolbar.tsx` |
| Undo/redo | `src/store.ts` (`pushUndo`, `undo`, `redo`); on touch, two consecutive two-finger taps on the canvas equal Undo (`Editor.tsx`, `onPointerUp` → `useAppStore.undo()`); two taps with 3 fingers = Redo (`useAppStore.redo()`); `pushUndo` is only called when the stroke/eraser/rotation actually changes the page; multi-finger taps discard the in-progress content drag (no stray stroke/undo entry) |
| Layers: model and helpers (legacy page normalization) | `src/types.ts` (`Layer`, `makeLayer`, `normalizePage`, `getActiveLayer`) |
| Layers: state actions (add/rename/duplicate/delete/reorder/visibility/opacity/lock/active/merge) | `src/store.ts` (`addLayer`, `renameLayer`, `duplicateLayer`, `deleteLayer`, `moveLayer`, `setLayerVisible`, `setLayerOpacity`, `setLayerLocked`, `setActiveLayer`, `mergeSelectedLayers`) |

### Data and Persistence

| Subject | File(s) |
|---|---|
| Types and defaults (settings, shortcuts) | `src/types.ts` |
| CRUD for notebooks/folders/pages/templates | `src/store.ts` |
| IndexedDB (read/write) | `src/db.ts` |
| Manual backup (export/import JSON, includes settings) | `src/utils/backup.ts` + `Modals.tsx` (Settings) |
| Automatic backup to disk | `src/utils/localSave.ts` |
| Restore all (import backup) | `src/store.ts` (`replaceAllData`) |
| Store contracts (state + actions, see §5.5) | `src/store.ts` (`AppState`), `src/uiStore.ts` (`UiState`), `src/textStore.ts` (`TextUiState`) |

### Cloud / Sync

| Subject | File(s) |
|---|---|
| Merge and conflict algorithm | `src/utils/sync.ts` |
| WebDAV + Koofr transport | `src/utils/webdav.ts` |
| Local sync state (cloudSync) | `src/db.ts` + `src/types.ts` (`CloudSyncState`) |
| Orchestration (`syncNow`, `resolveConflicts`, auto-sync) | `src/store.ts` |
| Sync / cloud configuration modal | `src/components/Modals.tsx` |
| Conflict modal | `src/components/Modals.tsx` (`SyncConflictModal`) |
| Sync trigger on open | `src/App.tsx` |
| Sync design document | `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md` |

### Import / Export

| Subject | File(s) |
|---|---|
| Import image to page | `Modals.tsx` (`ImportImageModal`) + `store.ts` (`addImageToPage`) |
| Import PDF to current page (choose a page from PDF) | `Modals.tsx` (`ImportPdfModal`) + `store.ts` (`addPage`, `persistNotebook`) |
| Import PDF as new notebook | `Modals.tsx` (`ImportPdfNoteModal`) + `store.ts` (`importPdfNotebook`) |
| Render PDF → images | `src/utils/pdf.ts` |
| Export PNG | `src/utils/export.ts` (`exportPageAsPng`) |
| Export PDF | `src/utils/export.ts` (`exportPagesAsPdf`, `buildSimplePdf`) |
| Custom templates (import image/PDF as template, with image size choice; for PDF the user chooses only one page) | `Modals.tsx` (`TemplatePicker`, `buildTemplatePages`, `buildPdfTemplatePage`, `chooseTemplateImageMode`) |
| Change page template (includes imported templates) | `Modals.tsx` (`TemplateModal`) + `store.ts` (`updatePage`, `applyTemplateToPage`) |

### UI / Layout / Navigation

| Subject | File(s) |
|---|---|
| Screen composition | `src/App.tsx` |
| Hide bars / panels | Settings (General tab, `Modals.tsx` `SettingsModal`, Appearance section) → `settings.hideTopBar`, `settings.hideToolbar`, `settings.hideSidebar`, `settings.hidePageList`; conditional rendering in `src/App.tsx`; sidebar/preview toggles in `TopBar.tsx` always visible (clicking re-shows panel when hidden by settings) and **a floating button per hidden bar** in `App.tsx` (`.ui-restore-btn`): top bar → top center (`top-center`, not to overlap side toolbar), tools → middle of right edge (`right-center`), notebooks/preview → middle of left edge (`left-center`, with `left-center-top`/`left-center-bottom` stacked when both are hidden) |
| Hide notebook page count | Settings (General tab, Appearance section) → `settings.hidePageCount`; conditional rendering of `<span className="page-count">` in `src/components/Sidebar.tsx` |
| Hide tool cursor | Settings (General tab, Appearance section) → `settings.hideToolCursor`; used in `Editor.tsx` to conditionally hide the tool indicator |
| Mobile safe areas (status bar / notch / gestures) | `index.html` uses `viewport-fit=cover`; `src/styles.css` respects `env(safe-area-inset-top)` in `.topbar` (height/padding) and in the `.ui-restore-btn.top-center` floating button, and `env(safe-area-inset-bottom)` in `.toolbar` in mobile mode — prevents the top bar from being covered/inaccessible on phones with a hidden notification bar (edge-to-edge) |
| Top bar | `src/components/TopBar.tsx` |
| Layers panel (right side; "Layers" button in `TopBar` toggles `layersOpen`) | `src/components/LayersPanel.tsx` + `src/store.ts` (layer actions) |
| Folder/notebook tree | `src/components/Sidebar.tsx` (custom tooltip `.sidebar-name-tooltip` shows full notebook/folder name on hover; `.sidebar-item` inside rows uses `flex: 1 1 auto; min-width: 0` and `.row-menu` with `z-index` to keep the "…" button clickable even with long names; "…" menu closes when clicking outside via global `pointerdown` listener; scrollable content in `.sidebar-scroll`) |
| Drag-and-drop folder/notebook reordering (reorder same level + move into folder) | `src/components/Sidebar.tsx` (Custom DnD via Pointer Events: `onItemPointerDown/Move/Up`, `computeSlot`, `updateDropPosition`, autoscroll, `.sidebar-drop-indicator` indicator, `.drop-target` highlight) + `src/store.ts` (`reorderFolder`/`reorderNotebook` recalculate sibling `order`; `moveFolder`/`moveNotebook` move to destination) + `order` field in `src/types.ts` |
| Multiple folder/notebook selection (CTRL/SHIFT on PC, long touch on touchscreens) | `src/components/Sidebar.tsx` (`toggleSelect`, `selectRange`; ~500ms timer on touch `pointerdown` triggers `toggleSelect`; `.selection-bar` bar) + `src/store.ts` (`toggleSelect`, `clearSelection`, `selectedIds`) |
| Resize notebook bar | `src/components/Sidebar.tsx` (`.sidebar-resizer` handle on right edge, drag to increase/decrease; width saved in `settings.sidebarWidth` via `setSettings` at end of drag; limit 160–min(520, 50% of window); hidden on touch/`pointer: coarse`) |
| Page preview (fixed thumbnail size, multiple selection with CTRL/SHIFT and selection bar) | `src/components/PageList.tsx` + `src/renderer/thumbnail.ts` (`.page-thumb-wrap` with `flex-shrink: 0` so it doesn't shrink with many pages) |
| Modals (all) | `src/components/Modals.tsx` + `src/uiStore.ts`; close with `Esc`/back button (`ink:esc` event → `ModalsHost` calls `close()`; for `prompt`/`confirmDelete`, resolves the resolver with `null`) |
| Software Updates | `src/utils/updateCheck.ts` (GitHub API check) + `electron/main.cjs` (electron-updater) + `src/components/Modals.tsx` (`UpdateModal`); automatically checks on startup (`App.tsx`) and allows manual check in Settings |
| Translation (i18n, dictionaries, language switching) | `src/i18n/` (`languages.ts`, `ptBR.ts`, `en.ts`, `index.ts`) + `settings.language` |
| CSS / Styles | `src/styles.css` |
| Mobile detection | `src/hooks/useIsMobile.ts` |

### Platforms

| Subject | File(s) |
|---|---|
| Electron Desktop (window, menu, IPC) | `electron/main.cjs` |
| Bridge `window.inkfolioDesktop` | `electron/preload.cjs` |
| Android / Capacitor | `capacitor.config.ts` |
| PWA manifest | `vite.config.ts` |
| Icons | `public/`, `build-resources/` |

### Keyboard Shortcuts

| Subject | File(s) |
|---|---|
| Defaults | `src/types.ts` (`DEFAULT_SHORTCUTS`) |
| Shortcut normalization/registration | `src/hooks/useShortcuts.ts` |
| Key labels and normalization | `src/utils/shortcuts.ts` |
| Hide bars / free rotation / selection mode shortcuts (`toggleHideToolbar`, `toggleHideTopBar`, `toggleFreeRotate`, `selectClick`, `selectFree`, `selectCircle`, `selectRect`) | `src/types.ts` (`DEFAULT_SHORTCUTS`) + `src/hooks/useShortcuts.ts` |
| Keyboard Shortcut Configuration UI | `Modals.tsx` (`SettingsModal` → "Shortcuts" tab). Allows searching by name, mapping keys (including standalone modifiers like `Alt`), and **restoring default shortcuts** independently from other settings. |
| Key labels and normalization | `src/utils/shortcuts.ts` (`normalizeKey` handles combinations and standalone modifier keys) |

---

## 10. Conventions and code patterns

- **State**: everything shared goes through Zustand stores; components read with
  `useAppStore((s) => s.xxx)` and write via store actions (never mutating directly without
  going through persistence).
- **Persistence**: every data change persists via `db.*` + `scheduleLocalBackup()`.
- **UI ↔ canvas communication**: via `CustomEvent` (`ink:*`), never deep props.
- **Canvas**: `Editor.tsx` owns the engine; `PageCanvas` only renders and performs hit
  tests.
- **Pure drawing functions** (for thumbnail/export) live in `renderer/drawUtils.ts` and
  reuse `utils/drawText.ts`.
- **UI Language**: pt-BR by default (button/modal text in Portuguese) with English
  support via `src/i18n/` (`t()` + `useI18n()`); new strings go into
  `ptBR.ts`/`en.ts` dictionaries.
- **Entity ID**: `newId()` from `src/types.ts` (uses `crypto.randomUUID()` when available
  and falls back to `uid()` — base36 timestamp + random — in insecure contexts like IP/HTTP
  access, where `crypto.randomUUID` does not exist). Do not use `crypto.randomUUID()`
  directly in the code.
- **Data normalization**: pages coming from sync/backup are normalized in
  `store.ts`/`sync.ts` via `normalizePage` (layers, `backgroundColor ?? '#ffffff'`);
  IndexedDB migration uses the same helper (`migrateLayers` in `db.ts`).
- **Typecheck**: `npm run typecheck` (or `tsc --noEmit`).

---

## 11. Program translation (i18n)

> **Current state**: the app has its own i18n system in `src/i18n/` (no external
> dependency). Languages: **pt-BR** (fallback) and **en**. The active language comes from
> `settings.language` (IndexedDB), with auto-detect on the first run
> (`navigator.language`). The "Language" selector in the Settings modal ("General" tab,
> `Modals.tsx`) switches the entire UI at runtime without reloading.

### 11.1 How i18n works

- **Dictionaries**: `src/i18n/ptBR.ts` (`ptBRMessages`) is the source of truth;
  `src/i18n/en.ts` (`enMessages`) covers the same set of keys. **Flat** keys with area
  prefix: `tool.*`, `topbar.*`, `layers.*`, `pageList.*`, `sidebar.*`, `editor.*`,
  `modal.*`, `shortcut.*`, `copySuffix`, `error.*`.
- **API**: `t(key, params?)` resolves at call time (fallback `en` → `pt-BR` → the key
  itself); `useI18n()` (React) forces re-render when switching language via
  `useSyncExternalStore`; `setLanguage()` also applies `applyDocumentLanguage()`
  (`<title>` + `<html lang>`) and notifies Electron via
  `window.inkfolioDesktop.setLanguage`.
- **Integration**:
  - React components (`Toolbar`, `Modals`, `Sidebar`, `TopBar`, `PageList`, `Editor`,
    `App`): `const { t } = useI18n()` and `t('key')` — including in
    `title`/`aria-label`/`placeholder` and `{{param}}` interpolation.
  - `src/utils/shortcuts.ts`: `shortcutLabel(action)` → `t('shortcut.' + action)`.
  - `src/store.ts`: duplication suffix via `t('copySuffix')`; `setSettings` with
    `patch.language` calls `setLanguage` before applying state; `init()` does
    auto-detect (unchanged `pt-BR` + `en` browser → `setSettings({ language: 'en' })`) and
    aligns `<title>`/`lang` with the saved language.
  - `src/utils/sync.ts` / `webdav.ts`: error/status messages via `t('error.*')` (flat
    modules import `t`; resolved on display).
  - Electron: `electron/preload.cjs` exposes `setLanguage(lang)`; `electron/main.cjs`
    stores `appLang` and reconstructs the menu/dialogs from a local `menuMessages`
    dictionary (the main process does not import the frontend TS).
- **Languages in selector**: language names ("Português (Brasil)", "English") are in each
  one's native language (i18n standard) — they are **not** translated.

### 11.2 Where the UI strings were (code map)

| File | What it contains | String examples |
|---|---|---|
| `src/components/Toolbar.tsx` | Tool names, panels, tips, tooltips, titles | "Pen", "Highlighter", "Eraser", "Text", "Select", "Move", "Rotation", "Undo", "Redo", "Selection mode", "Select delimited only", "Actions", "Bold", "Underline", "Writing direction", "Hex code" |
| `src/components/Modals.tsx` | **All modals**: titles, labels, buttons, tips, placeholders, options | "Settings", "New page", "Export notes", "Cloud synchronization", "Sync conflicts", "First page template", "Português (Brasil)", "Test connection", "Also from cloud", "Hide tool cursor" (`modal.hideToolCursor` + `modal.hideToolCursorHint`), import tips |
| `src/components/Sidebar.tsx` | Context menus, prompts, confirmations, section titles | "My Notebooks", "No folders", "New folder", "Rename", "Copy to folder...", "Move to folder...", "Duplicate", "Delete", "Delete note ...?", "Drag to resize", "Drag to reorder. Long touch selects multiple items on touch." (`sidebar.dragHint`) |
| `src/components/TopBar.tsx` | Tooltips, app title, placeholder | "Toggle sidebar", "Show/hide page preview", "Layers" (`topbar.toggleLayers`), "Hide top bar", "Hide toolbar", "Show top bar", "Show toolbar", "Show notebook bar", "Show page preview", "Fullscreen (F11)", "Mamaco Notes", "Select or create a notebook" |
| `src/components/PageList.tsx` | Title, search placeholder, empty messages, multiple page selection bar | "Pages", "Go to page (no.)...", "No pages found", "{{count}} page(s) selected", "Clear page selection", "Duplicate selected pages", "Delete {{count}} selected page(s)?" |
| `src/components/LayersPanel.tsx` | Panel title, action bar (new/duplicate/delete/merge), active layer opacity slider, "Background" footer, visibility/lock tooltips | "Layers", "Add layer", "Duplicate layer", "Delete layer", "Merge layers", "Merge {{count}} layers", "Background", "Page background", "Opacity", "Rename layer", "Layer {{n}}" (default names via `layers.layerN` when name matches `^Camada \d+$`), "Show/hide layer", "Lock layer", "Unlock layer" |
| `src/components/Editor.tsx` | Inline text placeholder, zoom tooltips | "Type text...", "Zoom out", "Reset zoom / recenter", "Recenter page" |
| `src/utils/shortcuts.ts` | Shortcut labels shown in Settings (`shortcutLabel`) | "Pen", "Eraser", "Undo", "Zoom in", "Add page", "Delete page", "Fullscreen", etc. |
| `src/store.ts` | Item duplication suffix | `t('copySuffix')` → `' (cópia)'` / `' (copy)'` |
| `src/utils/sync.ts` | Merge error messages | `'invalid notebook'`, `'invalid remote notebook'` |
| `src/utils/webdav.ts` | WebDAV connection error/status messages | "Koofr server not recognized.", "Connection OK: ...", Koofr URL tip |
| `electron/main.cjs` | Window menu, dialog titles, file filters, logs | "File", "Edit", "View", "Exit", "Undo", "Redo", "Cut", "Copy", "Paste", "Select all", "Select notes directory", "Mamaco Notes Backup", "JSON" |

### 11.3 Configuration and metadata per platform

| File | What to translate |
|---|---|
| `index.html` | `<html lang="pt-BR">` attribute and `<title>Mamaco Notes - Anotações</title>` — **initial** value; runtime corrects via `applyDocumentLanguage()` |
| `vite.config.ts` | PWA Manifest: `name`, `short_name`, `description`, `lang: 'pt-BR'` |
| `capacitor.config.ts` | `appName` (displayed app name on Android) |
| `package.json` | `description` (metadata) and `productName` in `build` block (installer/desktop name) |

> PWA Manifest, Capacitor `appName`, and `productName` are **static** (installation
> value) — they do not switch at runtime; the language within the app is controlled by the
> selector.

### 11.4 What DOES NOT need translation

- `src/styles.css` — only icons/symbols via `content:` (▤, ✎, ↻, ☁, etc.), no text.
- `public/`, `build-resources/` — icons and assets.
- Identifiers used in code (e.g., `'copy'`, `'cut'`, `ink:*` event names, `TemplateId`) —
  they are internal keys; translate only the displayed label.
- `docs/` — documentation (unless one wants to translate it).
- User-created notebook/folder names — user data, never translate.

### 11.5 How to add a new string

1. Add the key in `src/i18n/ptBR.ts` (pt-BR text, source of truth) and in
   `src/i18n/en.ts` (translation).
2. Consume with `t('key')` — in React components via `useI18n()`; in flat modules
   (sync/webdav) import `t` directly.
3. If there is a parameter, use `{{param}}` in the text and `t('key', { param })` in the
   call.
4. Do not leave hardcoded pt-BR strings in JSX; check at the end with a grep for accented
   characters in `src/components` (except for native language names in the selector).
