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
custom engine (`PageCanvas`). Data is persisted in **IndexedDB**. The global state uses
**Zustand**. The entire UI is in Portuguese (pt-BR) by default, but supports English (en).

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
| Android | Capacitor (with `capacitor-blob-writer`, `capacitor-native-settings`, `CapacitorHttp`, and local `pick-directory` plugin for chunked file I/O) | `capacitor.config.ts`, `android/` |
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
   enabled with auto-sync, it triggers `syncNow()`. The app renders the
   `<Dashboard />` if no notebook is selected, otherwise it mounts the editor
   view. It registers global shortcuts, `ink:*` event listeners, and the back
   button listener (Capacitor, via `@capacitor/app`, which re-dispatches
   `ink:esc`).
3. `src/store.ts init()` — loads folders, notebooks, settings, and templates from
   IndexedDB (`db.ts`); creates an initial notebook if none exists.

---

## 4. File map by directory

### Root

| File | Responsibility |
|---|---|
| `package.json` | Scripts (dev, build desktop/win/linux, android), dependencies, electron-builder config (including an NSIS installer with an option to delete app data on uninstall; auto-updates force-close the app and keep installation cancellation available — see `electron/main.cjs` `install-update` and `build-resources/installer.nsh`) |
| `AGENTS.md` | **Agent Orchestrator**: Behavioral prompt, golden rules, and index of specialized skills. Links to [Português](AGENTS.pt-BR.md) |
| `SECURITY.md` | Security policy and vulnerability reporting instructions |
| `vite.config.ts` | React/PWA plugins, `base: './'`, dev server (port 5173, `allowedHosts` for preview) |
| `tsconfig.json` | TypeScript config (strict) |
| `index.html` | Base HTML; loads `src/main.tsx` |
| `capacitor.config.ts` | Capacitor config (Android) |
| `.gitignore` | Ignored files |
| `server2.mjs` | Empty file (remnant) |

### `.agents/` — AI instructions

| Path | Responsibility |
|---|---|
| `.agents/skills/` | **Technical Skills**: Modular instructions for specific domains (Android, Sync, UI/UX, Desktop, Versioning). Used by AI agents to focus context. |

### `docs/` — documentation

| Path | Responsibility |
|---|---|
| `docs/PROJECT_STRUCTURE.md` | This document (The Map). |
| `docs/architecture/` | **Design Documents**: In-depth technical architecture for core features (Sync, Layers, Drawing Engine, i18n). |

### `src/` — application code (the core)

| File | Responsibility |
|---|---|
| `src/main.tsx` | React Bootstrap + PWA registration |
| `src/App.tsx` | Root component; screen composition (Dashboard or TopBar + PageList + Editor + Toolbar + LayersPanel + Modals); init + auto-sync; Escape key → `ink:esc`; Android back button (Capacitor `@capacitor/app`) → `ink:esc` |
| `src/types.ts` | **All domain data types** + `DEFAULT_SETTINGS` + `DEFAULT_SHORTCUTS` + factories (`makePage`, `makeNotebook`, `makeFolder`, `makeLayer`, `makeTextElement`, `uid`, `newId`) + layer helpers (`normalizePage`, `getActiveLayer`) + `TrashItem` (local trash entry) + **`APP_VERSION`** (version constant) |
| `src/db.ts` | **IndexedDB persistence layer** (object stores: `folders`, `notebooks`, `settings`, `cloudSync`, `templates`, `trash`, `notebooksContent`, `pdfImages`); version migration fills missing `order` field in old folders/notebooks, converts old pages (flat arrays) to the layer model (`migrateLayers`), splits page content into `notebooksContent` (`migrateToMetaContent`, v7 → v8) and extracts PDF background images into `pdfImages` (`migratePdfImages`, v8 → v9) |
| `src/store.ts` | **Main store (Zustand)**: all CRUD for notebooks/folders/pages/templates, layer actions (add/rename/duplicate/delete/reorder/visibility/opacity/lock/active/merge), undo/redo, clipboard, **local trash** (`restoreFromTrash`, `restoreFromCloud`, `purgeTrashItem`, `runTrashPurge`), sync, persistence |
| `src/uiStore.ts` | Modal store (`openModal`, `modalData`, `open`, `close`) |
| `src/textStore.ts` | Text editing state (draft, selection, rotation) |
| `src/styles.css` | All app CSS |

#### `src/components/` — React components

| File | Responsibility |
|---|---|
| `TopBar.tsx` | Top bar: sidebar/page toggles (always visible; if panel is hidden by `settings.hideSidebar`/`hidePageList`, the toggle re-shows it), notebook title (renamable — click to edit inline, or **`ink:rename` (F2)** when neither the sidebar nor the layers panel are open), Image/Page/Export buttons (shown only with a selected notebook), **PDF button always available** (`open('importPdfNote')` — "Adicionar PDF como nota", the same flow as the Sidebar button — works even without a selected notebook) plus Sync/Settings/Fullscreen buttons |
| `Dashboard.tsx` | **Main entrance and file manager**: shown when no notebook is selected. Includes a folder/notebook tree (sidebar), grid/list view mode, breadcrumbs, and a top header with search. Supports **drag-and-drop reordering and moving** (custom DnD via Pointer Events, works with mouse and touch; dragging over a folder moves inside it; insertion position indicator; autoscroll), **multiple selection** (CTRL/Meta click toggles, SHIFT click selects range, **long touch on touchscreens toggles selection**; selection bar with favorite/move/copy/cut/duplicate/delete), **name search bar** (filters folders/notebooks by name; results shown while typing, cleared with the × button), resizable sidebar (on desktop), and context menus. **"Favoritos" (favorites) tab** filters favorited items. **"Lixeira" (trash) button** opens the trash modal. Replaces the old `Sidebar.tsx`. |
| `PageList.tsx` | Page preview (thumbnails) inside the editor view, search by number, view mode (V/H/S), drag-drop, per-page menu, multiple page selection (CTRL click toggles, SHIFT click selects range; selection bar with duplicate/export PDF/rotate/delete). **Thumbnail regeneration is guarded**: `thumbTimesRef` tracks each page's `updatedAt`, so only pages whose `updatedAt` changed are re-rendered on `dataVersion` bumps; replacing the pages array, such as after a cloud pull, invalidates all cached thumbnails |
| `Editor.tsx` | **Largest component (~2900 lines)**: editing canvas, zoom/pan, drawing, eraser, selection, inline text, pointer gestures (including two-finger double tap = Undo), all drags. **Debounced persistence**: `schedulePersist()` (400ms) persists the **current live notebook** via `persistNotebook` after the debounce — keeping the same object reference in the store, so the canvas engine is not recreated (image cache lost) after every stroke, which caused a screen flicker on release — and discards the timer when a cloud pull has replaced that notebook object, so stale local edits cannot overwrite the downloaded copy. **Mobile keyboard resize guard**: while an INPUT/TEXTAREA/SELECT has focus (plus a 600ms grace after blur), the window/`visualViewport` resize handler skips `fitPage()` and only re-renders — preserving the user's zoom/position while the on-screen keyboard opens/closes (e.g. typing a tool size on the phone) and keeping the canvas backing store correct |
| `Toolbar.tsx` | Side toolbar: pen/highlighter/eraser/text/select/move/rotation, undo/redo, per-tool configuration panels |
| `LayersPanel.tsx` | Layers panel (right side): current page layers list (bottom→top inverted in UI), single/multiple selection (CTRL/SHIFT and long touch), drag reordering, inline rename (double-click or **`ink:rename` (F2) renames the last clicked folder or layer**, resetting to `null` on multi-select; **skipped whenever the sidebar is open with any selection — one or more selected items, or a selected folder/notebook — which the sidebar renames instead**), toggle visibility/lock, opacity, add/duplicate/delete/merge layers, **layer folders** (create via "+ pasta", rename via double-click / "…" menu / F2, delete via "…" menu with confirm, drag a layer into/out of a folder and reorder folders among themselves), **resizable panel** (`.layers-resizer` handle on the left edge, width persisted in `settings.layersWidth`, clamp 180–min(420, 50% of window)); fixed footer with page background color |
| `Modals.tsx` | **All modals**: new notebook, page, template, import image/PDF, export, settings, cloud, move/copy, background color, sync conflicts, prompt, confirmation, **trash** (Restore / Restore from cloud / Delete permanently, empty state, 30-day retention note). Settings backup section exposes export and import of a single JSON (`exportBackup`/`importBackup` → `replaceAllData`) |

#### `src/renderer/` — drawing engine (Canvas)

| File | Responsibility |
|---|---|
| `canvas.ts` | `PageCanvas` class: renders pages (continuous/separate), layers (visibility/opacity), strokes, images, texts, PDF, templates, selection; coordinate conversion; hit tests |
| `drawUtils.ts` | Pure drawing functions reused by thumbnail/export: `drawTemplate`, `drawLayer`, `drawStroke` (fully synchronized with the main canvas engine to support pressure sensitivity and quadratic curve smoothing), `drawTextOnCanvas` |
| `thumbnail.ts` | Generates page thumbnails (used in PageList and custom templates), rendered at `devicePixelRatio` resolution (capped at 3×) with JPEG quality 0.8 — keeping the CSS size (160×207) so previews stay sharp on retina phones |

#### `src/utils/` — support logic

| File | Responsibility |
|---|---|
| `http.ts` | **Platform-agnostic fetch wrapper**: switches between standard `fetch` (Web/Electron) and native `CapacitorHttp` (Android) to bypass CORS and network restrictions. Exports `customFetch` (body converts `Uint8Array`/`ArrayBuffer`/`Blob` to text), `decodeCapacitorData(data, isJson?)` (decodes CapacitorHttp's `data` field: base64 string, raw string, or a JS object/array that CapacitorHttp parsed despite `responseType: 'arraybuffer'` when Content-Type is JSON), `isConnectionError(err)` and `withRetry(fn)` (**network resilience**: 3 attempts with 500ms→1s backoff, only for connection-level failures — never for HTTP 4xx/5xx or authentication), and `downloadText` (**chunked Range download** used on Android: requests `Range: bytes=…` with `responseType: 'arraybuffer'`, reassembles chunks in JS via `decodeCapacitorData` — avoids the bridge OOM for large notebook JSON). `downloadText` detects the response `Content-Type` and passes `isJson` to `decodeCapacitorData`, which then treats strings as raw text (never base64) for JSON responses — this fixes the "Bad control character in string literal in JSON" / "Unexpected end of JSON input" errors on Android caused by a Range chunk landing entirely inside a base64 image `dataUrl` in the notebook JSON and being base64-decoded into garbage. |
| `chunkedIo.ts` | **Bridge to the local Capacitor plugin `pick-directory`**: registers `PickDirectory` and exposes chunked primitives that never send a whole large file through the JS↔native bridge: `readBackupFileFromUri` (chunked read via `readUriChunk`/`getUriFileInfo`), `pickBackupFile` (system document picker → chunked read), `saveBackupFile` (system "Save As" picker → chunked write), and `uploadFileStreaming` (PUT streamed via one native `OutputStream`, sending base64-encoded byte chunks with the declared UTF-8 byte length). |
| `layout.ts` | Offset/position calculation for pages in continuous mode (vertical/horizontal), `pageVisualRect`, `pageUnderPoint` |
| `drawText.ts` | Measuring and drawing text elements (horizontal/vertical, markers, underline/strikethrough) |
| `export.ts` | Page rendering to canvas and PNG/PDF export (generates simple PDF without external library) |
| `pdf.ts` | Rendering PDF files to images via `pdfjs-dist` (`renderPdfPages`) |
| `webdav.ts` | WebDAV transport (PROPFIND/MKCOL/PUT/DELETE fetch), special Koofr support, `makeTransport`. On Android the transport uses the **chunked native paths**: `downloadFile` via `http.ts` `downloadText` (Range + arraybuffer) and `uploadFile` via `chunkedIo.ts` `uploadFileStreaming` (PUT streamed through the `pick-directory` plugin's `HttpURLConnection`) — both avoid the bridge OOM. Native uploads verify the remote size with HEAD when supported, rejecting empty/truncated objects before the manifest advances. **Connection-level failures** (from `http.ts` `isConnectionError`) are re-thrown as a friendly `error.networkUnreachable` message so the user is told to check the internet connection. |
| `sync.ts` | **Bidirectional synchronization algorithm** (merge, conflicts, tombstone, migration). A clearly newer remote notebook takes precedence over a stale local baseline left by a failed upload. Manual sync ("Sincronizar agora") runs the same algorithm as auto-sync — a notebook edited locally is **pushed**, never force-pulled over the edit. On download failure (notebook/folder), logs the error via `logger.error` (visible in the Settings → Logs tab) **before** surfacing it in the result/UI — on mobile, failures without this logging were silently invisible. `buildPlan` ignores ids under `localOnlyDeleted`/`tombstones` in the pull loop, and a notebook that reappeared locally after its remote deletion (restored from the trash, no active tombstone/baseline) is **re-pushed** instead of deleted again. |
| `backup.ts` | Export/import full JSON backup (folders, notebooks, and settings; sanitizes settings and **removes cloud passwords** for security). On mobile the export opens the **system "Save As" picker** (`saveBackupFile`, chunked write via SAF) so the user can choose the destination, always with a **date-stamped filename** (`mamaco-notes-backup-YYYY-MM-DD-HHmmss.json`); import uses the system document picker (`pickBackupFile`, chunked read). On desktop uses the Electron `save-file`/`open-file` bridge and on web triggers a download/file input. |
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
| `main.cjs` | Main process: window, menu, IPC handlers (`save-file`, `open-file`) |
| `preload.cjs` | Bridge `window.inkfolioDesktop` (contextIsolation): `save-file`, `open-file`, `setLanguage`, update events |

### Others

| Path | Responsibility |
|---|---|
| `plugins/pick-directory/` | **Local Capacitor plugin** (dependency `pick-directory` via `file:plugins/pick-directory`): system document pickers (**`openFilePicker`** for reading and **`openFileCreator`** for "Save As"), chunked file read/write on `content://` URIs (`writeUriChunk`/`readUriChunk`, `getUriFileInfo`), and streaming PUT upload (`uploadStart`/`uploadChunk`/`uploadEnd` over `HttpURLConnection`) — all to avoid the Android `OutOfMemoryError` of sending large content through the bridge. TS types in `index.d.ts`; the Android source lives in `android/`. |
| `public/` | PWA static icons (favicon, apple-touch-icon, pwa-192/512, maskable) |
| `assets/` | Marketing and documentation assets (screenshots, QR codes) |
| `build-resources/` | Desktop packaging icons (icon.ico, icon.png) and the custom NSIS script `installer.nsh` (desktop shortcut on finish, shortcut cleanup on uninstall, a **robust `customCheckAppRunning`** that replaces electron-builder's default app-detection, and update migration hooks that skip/tolerate legacy uninstallers returning error 2) |
| `scripts/verify-sync.ts` | Standalone sync regression verification: exercises `buildPlan`/`runSync` against a fake in-memory transport (stale local baseline recovery, rollback on manifest write failure, idempotent re-run, auth error surfacing, **Bug A tombstone regression**: a tombstoned notebook is never re-pulled; **restore-from-trash**: a notebook that reappeared locally after remote deletion is re-pushed and the manifest entry flips back to `deleted:false`). Run with `npx tsx scripts/verify-sync.ts`; typechecked via `tsconfig.json` |
| `scripts/verify-download.ts` | Standalone verification of the Android download fix: forces the native `downloadText` path (`Capacitor.isNativePlatform()` overridden) against a mocked fetch that mimics the Android server side, asserting `decodeCapacitorData` reconstructs the correct text for parsed-JSON bodies (200), truncated JSON Range chunks (206), base64 chunks (large non-JSON file), 404 handling, the JSON-vs-base64 disambiguation (`isJson` keeps JSON strings as raw text so a chunk inside a base64 `dataUrl` is never base64-decoded), the native chunked download of a large JSON notebook with an embedded base64 image reassembles byte-exact, and the **retry behavior** (`isConnectionError` classification and `withRetry` 500ms→1s backoff: connection errors are retried, HTTP 4xx/5xx and auth errors are not). Run with `npx tsx scripts/verify-download.ts` |
| `server2.mjs` | Empty file (remnant) |

---

## 5. Data and state architecture

### 5.1 Data model (definitions in `src/types.ts`)

Hierarchy: **Folder** → **Notebook** → **Page** → **Layer** → (Stroke | ImageElement | TextElement) + PdfBackground (page background, outside layers)

- `Folder { id, name, parentId, createdAt, order? }` — nested folders; `order` is the position among siblings of the same `parentId` (used in drag-and-drop reordering).
- `Notebook { id, name, folderId, pages, createdAt, updatedAt, order? }` — notebook; `order` is the position among notebooks of the same `folderId` (used in drag-and-drop reordering).
- `Page { id, template, width, height, rotation, backgroundColor, layers, layerFolders, activeLayerId, pdf?, createdAt, updatedAt }` — all editable content resides in **layers**; `activeLayerId` persists the active layer (falls back to the last one in the array if null/non-existent). The old flat arrays `strokes`/`images`/`texts` have been **removed**. `layerFolders` groups layers visually (see `LayerFolder`).
- `Layer { id, name, visible, opacity, locked, folderId, strokes, images, texts, strokeErasures? }` — content layer. `layers` array order: **index 0 = bottom** (drawn first), **last = top**. Inside each layer, the sub-drawing order is **images → texts → strokes**. `strokeErasures` stores circular eraser paths in page coordinates, associated with the stroke IDs that existed when erasing began, so later strokes remain visible over the erased area. A locked layer (`locked: true`) receives no content and is not editable on the canvas (draw/erase/select/move), but can still be renamed, reordered, duplicated, deleted, hidden, have its opacity adjusted, become active, and participate in a merge. `folderId` is the `LayerFolder` this layer belongs to (`null`/`undefined` = root, i.e. no folder).
- `LayerFolder { id, name, order? }` — **layer folder** (one level, no nesting). Lives inside the page JSON (`Page.layerFolders`), so existing notebook sync/backup already carries it. `order` is the folder's position among siblings (used in drag-and-drop reordering). A folder groups layers visually; deleting a folder moves its layers to the root (`folderId = null`).
- `Stroke { id, kind(pen|highlighter), color, size, points[] }` — stroke with pressure.
- `ImageElement { id, name, dataUrl, x, y, width, height, rotation }`.
- `TextElement { id, text, x, y, width, rotation, fontSize, fontFamily, bold, italic, underline, strikethrough, color, backgroundColor, align, marker, direction, createdAt }`.
- `PdfBackground { dataUrl, name, pageNumber }` — PDF used as page background (resides **at page level**, below all layers; not a `Layer`).
- `AppSettings` — all configurations (pen color/size, eraser, modes, shortcuts, `cloud`, hide top bar/tools via `hideTopBar`/`hideToolbar`, hide notebook/page list sidebar via `hideSidebar`/`hidePageList`, hide page count via `hidePageCount`, hide the tool cursor over the page via `hideToolCursor`, ignore a specific update version via `ignoreVersion`, select delimited only via `selectDelimitedOnly`, sidebar width via `sidebarWidth`, **layers panel width via `layersWidth`**).
- `CloudSettings { enabled, webdavUrl, webdavUsername, webdavPassword, rememberPassword, webdavPath, autoSync, lastSyncAt }` — sync data. `rememberPassword` (boolean) controls if the password is wiped on disconnect.
- `TrashItem { id, kind: 'notebook'|'folder', name, parentId, data: Notebook|Folder|null, deletedAt, cloudKeepsCopy }` — **local trash entry** (NOT synced). One entry per deleted item: deleting a folder produces one entry for the folder, one for each subfolder and one for each notebook inside (each with its own `parentId`) so every item can be restored individually. `cloudKeepsCopy` is `true` when the item was deleted "só local" with a cloud configured (the heavy `data` is discarded; the item can only be brought back with "Restaurar da nuvem"). When `false` (deleted "local + nuvem" or no cloud), `data` holds the full item for a cloud-less restore.

> Whenever you need to change the format of persisted data, start with `src/types.ts`
> and then check normalization in `src/store.ts` (`applySyncChanges`, `init`,
> `replaceAllData` functions) and in `src/db.ts`.
>
> **Layers**: `makePage` creates a page with 1 default layer "Camada 1" (or "Layer 1")
> (`visible: true`, `opacity: 1`, `locked: false`, `folderId: null`, `layerFolders: []`).
> `normalizePage(page)` (pure function in
> `types.ts`) converts legacy/partial pages: if `layers` is missing/empty, it creates 1
> layer from old flat arrays; normalizes each layer defensively (including `folderId ??
> null`); normalizes `layerFolders` (defaulting to `[]`); validates `activeLayerId`
> (fallback last layer) and **removes** legacy flat fields from the result.
> `getActiveLayer(page)` resolves the active layer (or the last one).

### 5.2 Persistence (IndexedDB) — `src/db.ts`

Database `mamaco-notes`, version **9**, with object stores:

| Store | Content | Key |
|---|---|---|
| `folders` | `Folder[]` | `id` |
| `notebooks` | `NotebookSummary[]` (light metadata: id, name, folderId, timestamps, order, pageCount, favorite) | `id` |
| `notebooksContent` | `{ id, pages: Page[] }` — full page drawings; PDF backgrounds are stored **light** (`pdf` without `dataUrl`). Layers may include persisted circular `strokeErasures` masks for precise partial erasing. | `id` |
| `pdfImages` | `PdfImageRecord { pageId, notebookId, dataUrl }` — immutable PDF page background images (written only when new) | `pageId` (+ index `byNotebook` on `notebookId`) |
| `settings` | 1 record `{ id:'main', ...AppSettings }` | `id` |
| `cloudSync` | 1 record `CloudSyncState` | `id` |
| `templates` | `PageTemplate[]` (custom templates) | `id` |
| `trash` | `TrashItem[]` (local trash, not synced) | `id` |

All data writes in the app go through `store.ts`, which calls `db.*`.

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
>
> **Migration 5 → 6 (trash)**: `openDb()` creates the `trash` object store (keyPath `id`)
> if missing. No data rewrite is needed — the trash starts empty and existing
> folders/notebooks/cloudSync records are preserved untouched.
>
> **Migration 6 → 7 (layer folders)**: bumping the version re-runs `migrateLayers()`
> (idempotent), which rewrites every notebook page through `normalizePage` — now adding
> `layerFolders: []` and `folderId: null` to pages/layers without them. Data arriving from
> sync/backup is also normalized on read in `store.ts` (`init`, `applySyncChanges`,
> `replaceAllData`), so no sync version change is needed.
>
> **Migration 7 → 8 (page content split)**: `migrateToMetaContent()` moves the heavy `pages`
> array out of the `notebooks` store into the new `notebooksContent` store (keyPath `id`) and
> rewrites each `notebooks` record as a lightweight `NotebookSummary`. Page list / thumbnails
> load summaries from `notebooks` and full pages from `notebooksContent`.
>
> **Migration 8 → 9 (PDF images)**: `migratePdfImages()` extracts the heavy, immutable
> `page.pdf.dataUrl` background blobs out of `notebooksContent` into the new `pdfImages`
> store (keyPath `pageId`, index `byNotebook` on `notebookId`) and rewrites the content
> record to "light" pages (`pdf` without `dataUrl`). `putNotebook` then writes only the
> light pages to `notebooksContent` and upserts blobs into `pdfImages` only when new —
> tracked via an in-memory cache of `pageId → dataUrl length` — so a per-stroke commit never
> re-serializes the large PDF images (the root cause of the UI freeze on stroke release for
> PDF-heavy notebooks). `getNotebook`/`getFirstPage` rehydrate the `dataUrl` from
> `pdfImages`, so in-memory pages/canvas/thumbnails behave exactly as before;
> `deleteNotebook` also removes that notebook's blobs (no leaks). Sync/backup are unchanged
> because they read fully rehydrated notebooks.

### 5.3 Stores (Zustand)

- **`useAppStore`** (`src/store.ts`) — main global state:
  - Data: `folders`, `notebooks`, `templates`, `trash`, `settings`, `dataVersion: number` (incremented with
    each persistence; used for re-render and auto-sync).
  - Selection/UI: `selectedFolderId`, `selectedNotebookId`, `selectedIds`,
    `currentPageIndex`, `tool`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`,
    `rotationOpen`.
  - CRUD Actions: `createNotebook`, `addPage`, `updatePage`, `deleteNotebook`, `moveFolder`,
    `reorderFolder`, `reorderNotebook`, `duplicateFolder`, etc.
  - **Local trash**: `restoreFromTrash(id)` (restores a "local + nuvem" or cloud-less item from
    `data`, clears tombstone/baseline and re-uploads via sync), `restoreFromCloud(id)` (downloads
    the item back from the cloud — used for "só local" items where `cloudKeepsCopy` is true),
    `purgeTrashItem(id)` (removes the entry, the cloud copy is not affected), `runTrashPurge()`
    (drops entries older than `TOMBSTONE_RETENTION_MS` (30 days) that have no cloud copy —
    "só local" items are kept so only "Restaurar da nuvem" remains). Called on `init()` and when
    the trash modal opens.
  - Undo/redo: `pushUndo`, `undo`, `redo` (internal stacks, page snapshots, max 60 entries).
  - Cloud: `syncNow()`, `resolveConflicts()`.
  - Persistence: `persistNotebook`, `updateNotebookStorage`, `saveSettings`.
  - **Auto-sync**: `useAppStore.subscribe` watches `dataVersion` and triggers `syncNow()`
    with a 20s debounce. Guards: `syncRunning` prevents reentrancy, and `syncQueued`
    queues a follow-up sync when a change arrives while a sync is running (edits made
    during the sync window are not lost).
  - **Session restoration**: a second `useAppStore.subscribe` saves to `localStorage`
    (key `mamaco-notes.last-session`) the `{ notebookId, pageId }` pair whenever the
    current notebook or page changes; `init()` uses this record to reopen the last
    opened note/page (falling back to nothing selected if the record doesn't exist or
    the notebook was deleted). The same `subscribe` also keeps a **per-notebook last
    page map** (key `mamaco-notes.last-page`, shape `{ [notebookId]: pageId }`), and
    `selectNotebook(id)` reads it to reopen a notebook on its last page — instead of
    always resetting to the first page — when switching notebooks in the sidebar (and
    validating that the remembered page still exists, otherwise falling back to page 0).
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
db.ts (IndexedDB)
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
| **Data** | `loaded: boolean`, `folders: Folder[]`, `notebooks: Notebook[]`, `templates: PageTemplate[]`, `trash: TrashItem[]`, `settings: AppSettings`, `dataVersion: number` |
| **Selection/UI** | `selectedFolderId`, `selectedNotebookId`, `selectedIds: string[]`, `selectedPageIndices: number[]`, `clipboard: { ids, cut } | null`, `lastClicked: LastClickedTarget` (last single-clicked item: `{ type: 'folder'|'notebook'|'layer'|'layerFolder'; id }`, `{ type: 'notebookTitle' }`, or `null` — used by the `ink:rename` (F2) listeners to rename exactly the item the user clicked last; set by the Sidebar/LayersPanel/TopBar click handlers and reset to `null` on multi-select and when the item is deleted), `currentPageIndex`, `tool: ToolKind`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`, `canUndo`, `canRedo` |
| **Bootstrap** | `init(): Promise<void>` |
| **Navigation/Selection** | `selectFolder(id)`, `selectNotebook(id)`, `selectPage(index)`, `setTool(tool)`, `setRotationOpen(open)`, `toggleSidebar()`, `togglePageList()`, `toggleLayers()`, `setSidebarOpen(open)`, `setPageListOpen(open)`, `setLayersOpen(open)`, `toggleSearch()` |
| **Selection Editing** | `toggleSelect(id)`, `clearSelection()`, `setSelectedIds(ids)`, `setLastClicked(target: LastClickedTarget)`, `copySelected()`, `cutSelected()`, `pasteClipboard()`, `duplicateSelected()`, `deleteSelected(scope?)` |
| **Page Selection** | `selectedPageIndices`, `toggleSelectPage(index)`, `setPageSelection(indices)`, `clearPageSelection()`, `duplicateSelectedPages()`, `deleteSelectedPages()`, `rotateSelectedPagesBy(delta)` |
| **Folders** | `addFolder(name, parentId?)`, `deleteFolder(id, scope?)`, `renameFolder(id, name)`, `moveFolder(id, newParentId)`, `reorderFolder(id, parentId, beforeId)`, `duplicateFolder(id)`, `copyFolder(id, targetParentId)` |
| **Notebooks** | `createNotebook(name, folderId, template)`, `createNotebookFromTemplate(...)`, `deleteNotebook(id, scope?)`, `moveNotebook(id, folderId)`, `reorderNotebook(id, folderId, beforeId)`, `copyNotebook(id, folderId)`, `duplicateNotebook(id)`, `updateNotebook(notebook)` |
| **Pages** | `addPage(template)`, `addPageAfter(index, template)`, `duplicatePage(index)`, `deletePage(index)`, `movePage(from, to)`, `rotatePage(index)`, `rotatePageBy(index, delta)`, `updatePage(index, patch: Partial<Page>)` |
| **Layers** | `addLayer(folderId?)`, `renameLayer(index, name)`, `duplicateLayer(index)`, `deleteLayer(index)`, `moveLayer(from, to)`, `moveLayerToFolder(from, folderId, beforeId)`, `setLayerVisible(index, visible)`, `setLayerOpacity(index, opacity)` (0..1), `setLayerLocked(index, locked)`, `setActiveLayer(id)`, `mergeSelectedLayers(indices)`, **layer folders**: `addLayerFolder(name)`, `renameLayerFolder(id, name)`, `deleteLayerFolder(id)`, `reorderLayerFolder(id, beforeId)` |
| **Configuration** | `setSettings(patch)`, `setShortcut(action, value)`, `setCloud(patch)` |
| **Cloud** | `syncNow(): Promise<SyncResult | null>` (advances `settings.cloud.lastSyncAt` **only** when the run finishes with zero errors), `resolveConflicts(choices: Record<string, ConflictChoice>)` |
| **Trash** | `restoreFromTrash(id)`, `restoreFromCloud(id)`, `purgeTrashItem(id)`, `runTrashPurge()` |
| **Persistence/Undo** | `persistNotebook(notebook)`, `pushUndo()`, `undo()`, `redo()` |
| **Import/Templates** | `addImageToPage(dataUrl, name, center?)`, `addPdfToPage(dataUrl, name)`, `importPdfNotebook(...)`, `addTemplate(name, pages)`, `deleteTemplate(id)`, `addPagesFromTemplate(template)`, `applyTemplateToPage(index, template)`, `replaceAllData(folders, notebooks, settings?)` |

**Guarantees**: every data action writes to IndexedDB (`db.ts`) and increments
`dataVersion` (triggers re-render and auto-sync).
Page/notebook operations act on the selected notebook/index. Undo/redo use internal
page snapshot stacks (max 60). Folders and notebooks are always sorted by `order`
(`sortFoldersByOrder`/`sortNotebooksByOrder`); `reorderFolder`/`reorderNotebook`
recalculate the `order` of siblings within the same level (`parentId`/`folderId`), and
`moveFolder`/`moveNotebook` delegate to `reorder*` moving to the end of the destination.
Old data without `order` (sync/backup) is normalized by `fillFolderOrder`/`fillNotebookOrder`.
`selectNotebook(id)` reopens the notebook on the last page remembered for it (see §5.3
session restoration, `mamaco-notes.last-page`), falling back to page 0 if the remembered
page no longer exists; `selectFolder(id)` and `selectNotebook(null)` reset to page 0.
`lastClicked` is a pure UI convenience (set by `setLastClicked`, never persisted): it is
cleared when the referenced folder/notebook/layer/layer-folder is deleted, when a cloud
pull or backup restore replaces the data, and when the selected notebook is removed by a
sync change.

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
**Layer folder guarantees**: `page.layers` stays the single source of z-order (index 0 =
bottom); folder grouping is a *view* on top of the flat array (display order = `layerFolders`
order). `addLayer(folderId?)` inserts the new layer at the **top of the target group**
(the same rule as `moveLayerToFolder` with `beforeId = null`); with no folder, it keeps the
legacy behavior (insert after the active layer). `moveLayerToFolder(from, folderId, beforeId)`
sets the layer's `folderId` and repositions it: with `beforeId`, right before that layer;
otherwise at the **top of the target folder group** (or root group). `deleteLayerFolder(id)`
removes the folder and sets `folderId = null` on all its layers (they move to root).
`reorderLayerFolder(id, beforeId)` recomputes sibling `order` like `reorderFolder`.
`moveLayer(from, to)` remains for backward compatibility (no other caller after the panel
switched to `moveLayerToFolder`). `mergeSelectedLayers` spreads the top layer (keeps its
`folderId`); `cloneLayerWithNewIds` and page clones also keep `folderId`, so duplicated/
merged layers stay in the same folder.

#### `useUiStore` (`src/uiStore.ts:22`) — modals

| Field/Action | Type |
|---|---|
| `openModal` | `ModalName | null` (closed set of 20 values, listed at the top of the file) |
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
- **Scrollbars**: High-contrast interactive scrollbars (white thumb with dark border)
  are rendered as overlays. Position and size are calculated in `updateScrollbars()`
  within the RAF loop, using `getPanLimits()` to map the total navigable area.
- **Pan Limits**: Movement is restricted by `clampPan()` using a fixed `MARGIN`
  (e.g., 60px) beyond document edges. Limits are recalculated on zoom/resize, ensuring
  the "infinite void" doesn't grow when zooming out.
- **Coordinates**: `toPageCoords` / `toDocumentCoords` / `toPageCoordsAt` / `toScreenCoords`
  conversions (apply pan, zoom, page offset, and page rotation).
- **Interaction**: `Editor.tsx` implements all gestures via `PointerEvent` handlers
  on the main container (to capture scrollbar drags). Includes `pan | draw | erase |
  select-move | select-resize | select-rotate | region-draw | region-move |
  text-rotate | text-resize | page-rotate | group-resize | group-rotate | scroll-v | scroll-h`.
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
    (only if `stroke.points.length >= 2`); partial stroke erasing records one
    undo entry when its mask is created, while image erasing pushes only if `session.commit()`
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
  opacity. The `drawStroke` function implements identical pressure sensitivity and
  smoothing logic as the main editor, ensuring that thumbnails and PDF/PNG exports
  match the appearance of the live notes.
- **Rendering Performance**: `Editor.tsx` uses a **requestAnimationFrame (RAF) loop** to decouple drawing from pointer events, ensuring a consistent frame rate. High-frequency updates (like the tool cursor position) are performed via **direct DOM manipulation** using refs to avoid React re-renders. High-precision input devices (like tablets) are supported via **coalesced events** (`getCoalescedEvents`) for the smoothest possible strokes.

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
| `ink:rename` | — | `rename` shortcut (`useShortcuts.ts`, default F2) | `Dashboard.tsx` (renames the **last clicked** folder/notebook — via `store.lastClicked`, set on single click incl. search results, `null` on multi-select — falling back to single explicit selection, then the selected folder, then the selected notebook, via prompt modal; with a dashboard multi-selection it does nothing), `LayersPanel.tsx` (inline renames the **last clicked** layer/layer-folder — via `store.lastClicked`, `null` on multi-select — else the selected folder row, else the active layer; only when the layers panel is open), `TopBar.tsx` (starts editing the current notebook title when the **last clicked** item was the title, or when no notebook is selected) |
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
  API when WebDAV does not support MKCOL). **Authentication errors (401/403)** are
  detected in every call (Koofr API and WebDAV paths) and surfaced as clear, actionable
  messages (`error.koofrAuthFailed`/`error.webdavAuthFailed` — the user is told to check
  the username/email and the App Password), so a bad credential is never hidden behind a
  generic error.
- **Android download (JSON bodies)**: on native platforms downloads go through
  `downloadText` in `src/utils/http.ts` (chunked Range requests, `responseType:
  'arraybuffer'`). CapacitorHttp **ignores `arraybuffer` when Content-Type is
  `application/json`** and returns the body already parsed as a JS object/array (see
  `decodeCapacitorData`) — the old code treated a non-string body as empty, producing
  `JSON.parse('')` → "Unexpected end of JSON input" (`error.syncDownloadFoldersFailed`).
  `decodeCapacitorData` reconstructs the bytes for base64, raw text, or parsed JSON, and
  `downloadText` breaks out of the chunk loop when a decoded chunk is empty.
  **JSON-vs-base64 disambiguation**: `downloadText` reads the response `Content-Type` and
  passes `isJson` to `decodeCapacitorData`; for JSON responses a string is always raw
  text (never base64). This prevents a Range chunk that lands entirely inside a base64
  image `dataUrl` of a notebook (all base64-alphabet characters, length divisible by 4)
  from being base64-decoded into binary garbage, which previously corrupted the
  reassembled JSON with raw control characters ("Bad control character in string literal
  in JSON") or shortened it ("Unexpected end of JSON input") when syncing large,
  image-heavy notebooks from the phone.
- **Download failure logging**: notebook/folder download failures in `sync.ts` call
  `logger.error(...)` (visible in Settings → Logs) before being surfaced in the sync
  result/UI, so sync failures on mobile actually generate a log entry.
- **Network resilience (Android)**: `src/utils/http.ts` wraps every network call
  (`customFetch` native + web, and each Range chunk of `downloadText`) in
  `withRetry(fn)` — 3 attempts with 500ms→1s backoff, applied **only** when
  `isConnectionError(err)` matches a connection-level failure ("Failed to connect",
  "connect timed out", "network is unreachable", etc.). HTTP 4xx/5xx and
  authentication errors are never retried. `src/utils/webdav.ts` converts remaining
  connection failures into the friendly, actionable `error.networkUnreachable`
  message ("Sem conexão com o servidor...").
- **Tombstone pull fix (Bug A)**: `buildPlan`'s remote-notebook loop skips ids under
  `state.localOnlyDeleted` **and** `state.tombstones`, so a notebook marked for
  deletion is never re-downloaded and turned into a conflict. A notebook that
  reappears locally **after** its remote deletion was confirmed (restored from the
  trash: no active tombstone and no sync baseline) hits a new branch and is
  **re-uploaded** (`plan.push`) instead of being deleted locally again.
- **Android download regression test**: `scripts/verify-download.ts` (run with `npx tsx
  scripts/verify-download.ts`) forces the native `downloadText` path (overriding
  `Capacitor.isNativePlatform()`) with a mocked fetch that simulates the Android server,
  and asserts `decodeCapacitorData` reconstructs the correct text for parsed-JSON bodies,
  truncated JSON Range chunks, base64 chunks (large file), and 404 handling.
- **Merge Algorithm**: `src/utils/sync.ts` — `runSync()` and `applyConflictChoices()`.
  Remote layout: `manifest.json` + `notebooks/<id>.json` + `folders/folders.json`.
  Compares `local.updatedAt`, `remote.updatedAt`, and `cloudSync.notebooks[id]` to decide
  on push/pull/delete/conflict. The folder hash (`hashFolders`) includes `id`, `name`,
  `parentId`, and `order`, so **folder reordering is synced** like any other folder
  change.
  **First sync (no folder baseline)**: a device that never synced has an empty
  `foldersHash` (normalized to the empty-set hash in `db.ts` and `buildPlan`). This is
  treated as "local folders unchanged" instead of a local change, so a fresh device
  **pulls the remote folders** instead of raising a spurious `bothModified` conflict.
  Before this fix, resolving that spurious conflict with "keep local" on an empty device
  uploaded an empty folder list and silently wiped the real folders on the server
  (`folders/folders.json`).
  **Manifest-commit guarantee (no silent overwrite)**: the local baseline
  (`cloudSync.notebooks`/`foldersHash`) only advances **after** the server confirms the
  new `manifest.json`. If the manifest write fails, `runSync` restores a snapshot of the
  previous baseline and manifest, so the next sync re-evaluates the same plan
  (idempotent) — a stale manifest can never cause a silent pull that overwrites local
  changes made since the failed run.
  **Self-healing of missing remote files (404)**: when the manifest lists a notebook but
  its file is missing on the server (e.g. an interrupted upload or a stale manifest),
  `downloadFile` throws a typed `RemoteFileNotFoundError` (see `src/utils/webdav.ts`) and
  the notebook pull loop in `runSync` reconciles instead of erroring forever — if a local
  copy exists it is re-uploaded (restored) and the manifest entry is fixed; if not, the
  phantom manifest entry is pruned so the next sync stops trying to download it.
- **Local Sync State**: `db.ts` → `cloudSync` (`CloudSyncState`).
- **Orchestration**: `store.ts` → `syncNow()` (reentrancy guard + debounce),
  `resolveConflicts()`. `syncNow()` **only advances `settings.cloud.lastSyncAt` when the
  run finishes with zero errors** (a failed sync keeps the real "last synced" timestamp
  instead of pretending it succeeded). The auto-sync subscription (20s debounce) **queues
  a follow-up sync when a change arrives while a sync is running** (`syncQueued`), so
  edits made during a sync window are not silently lost.
  `applySyncChanges()` applies pulled/new/removed data and **no-ops when nothing actually
  changed** — it only bumps `dataVersion` (which re-triggers auto-sync) when real changes
  are applied, avoiding an endless auto-sync loop on mobile.
  **Content-first commit (no "synced but changes missing")**: `syncNow()` applies the
  pulled content (`applySyncChanges`) **before** persisting the advanced baseline
  (`db.putCloudSyncState`). If applying the content fails, the baseline stays put, so the
  next sync re-pulls the same notebooks (idempotent) instead of marking them as synced
  while the local copy never changed.
- **Detailed Design/Plan**: `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md`
  and `docs/superpowers/plans/2026-08-17-sync-bidirecional-plan.md`.
- **Regression verification**: `scripts/verify-sync.ts` (run with `npx tsx
  scripts/verify-sync.ts`) exercises `buildPlan` and `runSync` against a fake in-memory
  transport, asserting push/pull/conflict/delete decisions, the manifest-write rollback
  (baseline does not advance and `lastSyncAt` is not set), idempotent re-run after a
  rollback, an auth failure surfacing a clear message while leaving the sync state
  untouched, the 404 self-healing (restore local copy / prune phantom manifest
  entry), the **Bug A regression** (a tombstoned notebook is not re-pulled and is
  deleted on the cloud), and the **restore-from-trash** flow (a notebook that
  reappeared locally after its remote deletion is re-pushed and the manifest entry
  returns to `deleted:false`). `scripts/verify-download.ts` additionally asserts the
  **retry** behavior (`isConnectionError`/`withRetry`).

---

## 9. Information Search Index

> "Where is the code that does X?" — consult the table below.

### Drawing / Editing Tools

| Selection modes (click/lasso/circle/rect) | `src/components/Toolbar.tsx` (`SelectPanel`) + `Editor.tsx`. Clicking anywhere inside a selection bounding box allows dragging. |
| Scrollbars (vertical/horizontal) | `Editor.tsx` (`updateScrollbars`, `scroll-v/h`) + `src/styles.css` (`.editor-scrollbar`). High-contrast design, interactive, and auto-hides after 1.5s. |
| Move screen | `src/components/Editor.tsx` (`pan` tool). Supports dragging with the mouse/touch, or **holding the configured shortcut** (default: `Alt`) to pan temporarily with any tool active. Restricted by `getPanLimits` and `clampPan`. |
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
| Layers: model and helpers (legacy page normalization) | `src/types.ts` (`Layer`, `LayerFolder`, `makeLayer`, `normalizePage`, `getActiveLayer`) |
| Layers: state actions (add/rename/duplicate/delete/reorder/visibility/opacity/lock/active/merge) | `src/store.ts` (`addLayer`, `renameLayer`, `duplicateLayer`, `deleteLayer`, `moveLayer`, `moveLayerToFolder`, `setLayerVisible`, `setLayerOpacity`, `setLayerLocked`, `setActiveLayer`, `mergeSelectedLayers`) |
| Layer folders (create/rename/delete/reorder, move layer into/out of folder, drop onto folder row / root zone) | `src/store.ts` (`addLayerFolder`, `renameLayerFolder`, `deleteLayerFolder`, `reorderLayerFolder`, `moveLayerToFolder`) + `src/components/LayersPanel.tsx` (`.layer-folder-row`, `dragFolderIdRef`, `dropIntoFolderRef`, folder "…" menu) + `src/types.ts` (`LayerFolder`) |

### Data and Persistence

| Subject | File(s) |
|---|---|
| Types and defaults (settings, shortcuts) | `src/types.ts` |
| CRUD for notebooks/folders/pages/templates | `src/store.ts` |
| IndexedDB (read/write) | `src/db.ts` |
| Manual backup (export/import JSON, includes settings) | `src/utils/backup.ts` + `src/utils/chunkedIo.ts` + `Modals.tsx` (Settings). On mobile, export opens the **system "Save As" picker** (`saveBackupFile`) so the user can choose the destination, always with a **date-stamped filename** so an existing backup is never overwritten; import uses the system document picker (`pickBackupFile`, chunked read). On desktop uses the Electron save/open dialog and on web triggers a download/file input. |
| Logging System | `src/utils/logger.ts`. Stores system events and errors (like WebDAV failures) in memory. Logs are accessible via the **Logs tab** in Settings, allowing users to view, copy, and clear logs for debugging. |
| Restore all (import backup) | `src/store.ts` (`replaceAllData`). Entry point in Settings (`Modals.tsx`): **Import backup** (single full JSON via `importBackup` — desktop open dialog, mobile system document picker `pickBackupFile`, web file input) |
| Store contracts (state + actions, see §5.5) | `src/store.ts` (`AppState`), `src/uiStore.ts` (`UiState`), `src/textStore.ts` (`TextUiState`) |
| Local trash (delete → trash, restore, "restore from cloud", permanent delete, 30-day purge) | `src/store.ts` (`deleteNotebook`/`deleteFolder`/`deleteSelected` create `TrashItem` entries; `restoreFromTrash`, `restoreFromCloud`, `purgeTrashItem`, `runTrashPurge`), `src/db.ts` (`getTrash`/`putTrashItem`/`deleteTrashItem`), `src/types.ts` (`TrashItem`), `src/components/Modals.tsx` (`TrashModal`), `src/components/Sidebar.tsx` (trash button), `src/uiStore.ts` (`'trash'` modal) |

### Cloud / Sync

| Subject | File(s) |
|---|---|
| Merge and conflict algorithm | `src/utils/sync.ts` |
| WebDAV + Koofr transport | `src/utils/webdav.ts`. On Android, `uploadFile` streams via the local `pick-directory` plugin (`uploadFileStreaming`) and `downloadFile` uses chunked Range requests (`downloadText` in `http.ts`, decoded with `decodeCapacitorData` — handles the JSON-parsed bodies CapacitorHttp returns for `application/json` content) — avoids the bridge OOM for large notebooks. |
| Native Network (Android CORS bypass) | `src/utils/http.ts` (`customFetch`, `downloadText`, `decodeCapacitorData`, `isConnectionError`, `withRetry`) — used by `webdav.ts` and `updateCheck.ts` |
| Network resilience (retry/backoff + friendly message) | `src/utils/http.ts` (`isConnectionError`, `withRetry` — 3 attempts, 500ms→1s backoff, connection errors only) + `src/utils/webdav.ts` (`rethrowConnectionError` → `error.networkUnreachable`) |
| Local sync state (cloudSync) | `src/db.ts` + `src/types.ts` (`CloudSyncState`) |
| Orchestration (`syncNow`, `resolveConflicts`, auto-sync) | `src/store.ts` |
| Sync / cloud configuration modal | `src/components/Modals.tsx` |
| Conflict modal | `src/components/Modals.tsx` (`SyncConflictModal`) |
| Sync trigger on open | `src/App.tsx` |
| Sync design document | `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md` |

### Import / Export

| Subject | File(s) |
|---|---|
| Import image to page | `Modals.tsx` (`ImportImageModal`) + `store.ts` (`addImageToPage`). Supports pasting from clipboard via button. |
| Paste from clipboard (Editor) | `Editor.tsx` (`onPasteGlobal`). Pressing **Ctrl+V** anywhere in the editor pastes an image from the clipboard at the mouse position (or centered on the current page). |
| Import PDF as page background (via page/notebook creation → "Import template (image/PDF)") | `Modals.tsx` (`AddPageModal`/`NewNotebookModal` → `TemplatePicker`, `buildPdfTemplatePage`) + `store.ts` (`createNotebook`, `addPage`, `addPagesFromTemplate`) |
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
| Hide bars / panels | Settings (**Appearance tab**, `Modals.tsx` `SettingsModal`, Appearance section) → `settings.hideTopBar`, `settings.hideToolbar`, `settings.hideSidebar`, `settings.hidePageList`; conditional rendering in `src/App.tsx`; preview toggles in `TopBar.tsx` always visible (clicking re-shows panel when hidden by settings) and **a floating button per hidden bar** in `App.tsx` (`.ui-restore-btn`): top bar → top center (`top-center`, not to overlap side toolbar), tools → middle of right edge (`right-center`), preview → middle of left edge (`left-center`) |
| Hide notebook page count | Settings (**Appearance tab**, Appearance section) → `settings.hidePageCount`; conditional rendering of `<span className="page-count">` in `src/components/Dashboard.tsx` |
| Hide tool cursor | Settings (**Appearance tab**, Appearance section) → `settings.hideToolCursor`; used in `Editor.tsx` to conditionally hide the tool indicator |
| Theme support (Dark/Light/System) | Settings (**Appearance tab**) → `settings.theme`; applied in `App.tsx` via CSS classes and media queries. |
| Mobile safe areas (status bar / notch / gestures) | `index.html` uses `viewport-fit=cover`; `src/styles.css` respects `env(safe-area-inset-top)` in `.topbar` (height/padding) and in the `.ui-restore-btn.top-center` floating button, and `env(safe-area-inset-bottom)` in `.toolbar` in mobile mode — prevents the top bar from being covered/inaccessible on phones with a hidden notification bar (edge-to-edge) |
| Top bar | `src/components/TopBar.tsx`. Contains a "Back to Dashboard" button, preview toggles on the left, the notebook title in the center, and action buttons (Import, Export, Sync, Settings, **Hide UI bars**) on the right. On mobile, the right side is scrollable. |
| Layers panel (right side; "Layers" button in `TopBar` toggles `layersOpen`) | `src/components/LayersPanel.tsx` + `src/store.ts` (layer + layer folder actions) |
| Dashboard / Folder/notebook manager | `src/components/Dashboard.tsx` (custom tooltip `.sidebar-name-tooltip` shows full notebook/folder name on hover; sidebar and grid/list view for file navigation; context menu closes when clicking outside via global `pointerdown` listener; scrollable content) |
| Search folders/notebooks by name | `src/components/Dashboard.tsx` (search input in the header; filters `folders`/`notebooks` by name with a flat result list while typing, "no results" empty state, × button clears) |
| Rename folder/notebook (F2) | `src/types.ts` (`DEFAULT_SHORTCUTS.rename` = `f2`), `src/hooks/useShortcuts.ts` (dispatches `ink:rename`), `src/components/Dashboard.tsx` (`ink:rename` listener → `renameNotebook`/`renameFolderName` via prompt modal; also available in the "…" context menu) |
| Rename layer / layer folder (F2) | `src/components/LayersPanel.tsx` (`ink:rename` listener starts the inline rename of the selected folder — else the active layer; double-click on the folder/layer name also renames) |
| Rename current notebook title (F2) | `src/components/TopBar.tsx` (`ink:rename` listener opens the notebook title prompt when no other panel is open) |
| Drag-and-drop folder/notebook reordering (reorder same level + move into folder) | `src/components/Dashboard.tsx` (Custom DnD via Pointer Events: `onItemPointerDown/Move/Up`, `updateDropPosition`, autoscroll, `.dashboard-drop-indicator` indicator, `.drop-target` highlight) + `src/store.ts` (`reorderFolder`/`reorderNotebook` recalculate sibling `order`; `moveFolder`/`moveNotebook` move to destination) + `order` field in `src/types.ts` |
| Multiple folder/notebook selection (CTRL/SHIFT on PC, long touch on touchscreens) | `src/components/Dashboard.tsx` (~600ms timer on touch `pointerdown` triggers `toggleSelect`; `.dashboard-selection-bar` bar) + `src/store.ts` (`toggleSelect`, `clearSelection`, `selectedIds`) |
| Resize Dashboard sidebar | `src/components/Dashboard.tsx` (CSS transition-based collapse/expand) |
| Resize layers panel | `src/components/LayersPanel.tsx` (`.layers-resizer` handle on the **left** edge, mirror of the sidebar resizer; width = `dragWidth ?? settings.layersWidth`, clamp 180–min(420, 50% of window); saved to `settings.layersWidth` via `setSettings` on release; hidden on mobile where the panel width is fixed at 280px) |
| Page preview (fixed thumbnail size, multiple selection with CTRL/SHIFT and selection bar) | `src/components/PageList.tsx` + `src/renderer/thumbnail.ts` (`.page-thumb-wrap` with `flex-shrink: 0` so it doesn't shrink with many pages) |
| Modals (all) | `src/components/Modals.tsx` + `src/uiStore.ts`; close with `Esc`/back button (`ink:esc` event → `ModalsHost` calls `close()`; for `prompt`/`confirmDelete`, resolves the resolver with `null`) |
| Software Updates | `src/utils/updateCheck.ts` (GitHub API check) + `electron/main.cjs` (electron-updater) + `src/components/Modals.tsx` (`UpdateModal`); automatically checks on startup (`App.tsx`) and allows manual check in Settings; applying an update runs the NSIS installer **silently** (`quitAndInstall(true, true)`) so the interactive "close the app" dialogs never block the update |
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
| Shortcut normalization/registration | `src/hooks/useShortcuts.ts` (`initGlobalShortcuts` automatically disables shortcuts when a modal is open or when the user is typing in an input field to prevent interference). |
| Key labels and normalization | `src/utils/shortcuts.ts` |
| Hide bars / free rotation / selection mode shortcuts (`toggleHideToolbar`, `toggleHideTopBar`, `toggleFreeRotate`, `selectClick`, `selectFree`, `selectCircle`, `selectRect`) | `src/types.ts` (`DEFAULT_SHORTCUTS`) + `src/hooks/useShortcuts.ts`. Note: the `pan` shortcut is handled exclusively as a "hold-to-activate" modifier in `Editor.tsx` and does not switch the global tool state. |
| Rename (F2) | `src/types.ts` (`DEFAULT_SHORTCUTS.rename` = `f2`) + `src/hooks/useShortcuts.ts` (dispatches `ink:rename`; each panel that has a name renames its selected/active item — sidebar folder/notebook, layers panel active layer, topbar notebook title — see section 7) |
| Keyboard Shortcut Configuration UI | `Modals.tsx` (`SettingsModal` → "Shortcuts" tab). Allows searching by name, mapping keys (including standalone modifiers like `Alt`), and **restoring default shortcuts** independently from other settings. |
| Key labels and normalization | `src/utils/shortcuts.ts` (`normalizeKey` handles combinations and standalone modifier keys) |

---

## 10. Conventions and code patterns

- **State**: everything shared goes through Zustand stores; components read with
  `useAppStore((s) => s.xxx)` and write via store actions (never mutating directly without
  going through persistence).
- **Persistence**: every data change persists via `db.*` (IndexedDB is the primary store).
  Inside the editor, canvas edits persist through `schedulePersist()` (`Editor.tsx`),
  **debounced (400ms)** persisting the current live notebook at fire time — high-frequency
  edits (drawing strokes) are written at most once per window with the latest state,
  instead of a full `persistNotebook` write on every pointer release.
- **UI ↔ canvas communication**: via `CustomEvent` (`ink:*`), never deep props.
- **Rendering Performance**: `Editor.tsx` uses a **requestAnimationFrame (RAF) loop** to decouple drawing from pointer events, ensuring a consistent frame rate. High-frequency updates (like the tool cursor position) are performed via **direct DOM manipulation** using refs to avoid React re-renders. High-precision input devices (like tablets) are supported via **coalesced events** (`getCoalescedEvents`) for the smoothest possible strokes.
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
| `src/components/Modals.tsx` | **All modals**: titles, labels, buttons, tips, placeholders, options | "Settings", "New page", "Export notes", "Cloud synchronization", "Sync conflicts", "First page template", "Português (Brasil)", "Test connection", "Also from cloud", "Hide tool cursor" (`modal.hideToolCursor` + `modal.hideToolCursorHint`), import tips, **trash** (`modal.trashTitle`, `modal.trashEmpty`, `modal.trashRestore`, `modal.trashRestoreCloud`, `modal.trashPurgeTitle`, `modal.trashPurgeConfirm`, `modal.trashPurgeNote`, `modal.trashKindNote`, `modal.trashKindFolder`, `modal.trashRestoreCloudHint`), import tips |
| `src/components/Sidebar.tsx` | Context menus, prompts, confirmations, section titles, **search bar** | "My Notebooks", "No folders", "New folder", "Rename", "Copy to folder...", "Move to folder...", "Duplicate", "Delete", "Delete note ...?", "Drag to resize", "Drag to reorder. Long touch selects multiple items on touch." (`sidebar.dragHint`), "Trash" (`sidebar.trash`), **"Search folders and notebooks..." (`sidebar.searchPlaceholder`), "Folders" (`sidebar.searchFolders`), "Notebooks" (`sidebar.searchNotebooks`), "No folders or notebooks found" (`sidebar.searchNoResults`), "Clear search" (`sidebar.searchClear`)** |
| `src/components/TopBar.tsx` | Tooltips, app title, placeholder | "Toggle sidebar", "Show/hide page preview", "Layers" (`topbar.toggleLayers`), "Hide top bar", "Hide toolbar", "Show top bar", "Show toolbar", "Show notebook bar", "Show page preview", "Fullscreen (F11)", "Mamaco Notes", "Select or create a notebook" |
| `src/components/PageList.tsx` | Title, search placeholder, empty messages, multiple page selection bar | "Pages", "Go to page (no.)...", "No pages found", "{{count}} page(s) selected", "Clear page selection", "Duplicate selected pages", "Delete {{count}} selected page(s)?" |
| `src/components/LayersPanel.tsx` | Panel title, action bar (new layer / new folder / duplicate / delete / merge), active layer opacity slider, "Background" footer, visibility/lock tooltips, **folder UX strings** | "Layers", "Add layer", "Duplicate layer", "Delete layer", "Merge layers", "Merge {{count}} layers", "Background", "Page background", "Opacity", "Rename layer", "Layer {{n}}" (default names via `layers.layerN` when name matches `^Camada \d+$`), "Show/hide layer", "Lock layer", "Unlock layer", **"New layer folder" (`layers.newFolder`), "Rename folder" (`layers.renameFolder`), "Delete folder" (`layers.deleteFolder`), "Delete folder ...? Its layers will be moved to the root" (`layers.deleteFolderConfirm`), "New layer folder name:" (`layers.newFolderPrompt`), "New layer folder name:" (`layers.renameFolderPrompt`), "Drag to resize" (`layers.resizePanel`), "No layers" (`layers.folderEmpty`)** |
| `src/components/Editor.tsx` | Inline text placeholder, zoom tooltips | "Type text...", "Zoom out", "Reset zoom / recenter", "Recenter page" |
| `src/utils/shortcuts.ts` | Shortcut labels shown in Settings (`shortcutLabel`) | "Pen", "Eraser", "Undo", "Zoom in", "Add page", "Delete page", "Fullscreen", **"Rename" (`shortcut.rename`)**, etc. |
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
