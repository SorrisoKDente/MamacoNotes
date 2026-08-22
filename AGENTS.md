# AGENTS.md — Instructions for AI agents in Mamaco Notes

**English** | [Português](AGENTS.pt-BR.md)

> This file must be followed by **any AI agent** working on this project
> (creating features, fixing bugs, refactoring, documenting, etc.).

## 1. Mandatory: read the structure before any work

1. If you have **not yet read** `docs/PROJECT_STRUCTURE.md` in this session, **read it first**,
   before creating code, fixing a bug, or planning any change. It is the project's
   information location map (where each feature, store, event, and layer is located).
2. **If you change the operation of any project structure** (files, components, stores,
   `ink:*` events, data types, features, flows, or platforms), **you MUST update
   `docs/PROJECT_STRUCTURE.md` in the same change**, as per the prompt at the top of that
   file. Never finish a task with the documentation outdated relative to the code.
3. **If you add new features or change existing ones**, you MUST update both `README.md`
   and `README.pt-BR.md` to reflect these changes in both languages.

## 2. Project context

**Mamaco Notes** is a digital note-taking app with a pen (Samsung Notes style). The
source code is a single **React + TypeScript + Vite** frontend that runs in **4 environments**:

| Platform | How it runs |
|---|---|
| **Windows** | Electron (`electron/main.cjs`) + electron-builder packaging (NSIS/portable) |
| **Linux** | Electron + electron-builder packaging (AppImage/deb) |
| **Android** | Capacitor (`capacitor.config.ts`) |
| **Web / PWA** | Browser with service worker (`vite-plugin-pwa`) |

> **Platform rule**: the program **must work on Windows, Linux, and Android**
> (and, preferably, also in the browser). **No change can break or be exclusive
> to one platform** without providing a fallback for the others.

## 3. Cross-platform compatibility rules

- **Never** use APIs exclusive to a platform without a fallback. Examples already solved
  in the project and which must be maintained:
  - Environment detection: use `window.inkfolioDesktop` (Electron) and `window.Capacitor`
    (Android); the rest is treated as Web/PWA.
  - File system access: on desktop use the bridge `window.inkfolioDesktop` (`pick-directory`,
    `write-file`, `read-file`, `save-file`, `open-file` via preload); in the browser use
    the File System Access API (with fallback to download). See `src/utils/localSave.ts`,
    `src/utils/backup.ts`.
  - PWA service worker: register **only** outside of Electron and Capacitor.
  - System fonts: use Local Font Access with fallback to a built-in list (`src/utils/fonts.ts`).
- **Language**: all UI (button texts, modals, menus, messages) is in **Portuguese (pt-BR)**
  with **English (en)** support via `src/i18n/`. **Whenever** you create a new feature,
  component, or flow that has UI text, the string **must** be added to the dictionaries
  of **all supported languages** (`src/i18n/ptBR.ts` and `src/i18n/en.ts`) — never as a
  hardcoded literal string. Consume with `t('key')` in plain modules or `useI18n()` in
  React components. Refer to **Section 11 (Translation)** of `docs/PROJECT_STRUCTURE.md`
  to know all points containing text.
- **Paths/separators**: do not assume the path separator of a specific OS; use
  cross-platform APIs.
- **Android**: changes requiring new Capacitor permissions/plugins must be added to
  `capacitor.config.ts` and `cap sync android` must run. Test the build with
  `npm run build:android`.

## 4. Architecture — follow existing patterns

- **Global state**: use Zustand stores (`src/store.ts` for data, `src/uiStore.ts` for
  modals, `src/textStore.ts` for text editing). Do not invent new stores for what
  already exists; if you need state/new state, **update the contract** (interface at the
  top of the file) and the documentation.
- **Persistence**: all data writing goes through store → `src/db.ts` (IndexedDB) →
  `scheduleLocalBackup()`. Do not write to IndexedDB outside these paths.
- **UI ↔ Canvas communication**: use `window.dispatchEvent(new CustomEvent('ink:...'))`
  instead of deep props. When adding an event, register it in **Section 7** of
  `docs/PROJECT_STRUCTURE.md`.
- **Drawing**: the rendering engine is the `PageCanvas` class (`src/renderer/canvas.ts`);
  `Editor.tsx` owns all interaction (pointer gestures). Reusable pure drawing functions
  (thumbnails, export) go in `src/renderer/drawUtils.ts`.
- **IDs**: generate IDs with `newId()` from `src/types.ts` (uses `crypto.randomUUID()`
  when available and falls back to `uid()` in insecure contexts, like browser access via
  IP/HTTP). Never call `crypto.randomUUID()` directly — it doesn't exist outside secure
  contexts (HTTPS/localhost) and would break the PWA accessed via local network.
- **Page Templates**: dimensions/template types come from `src/types.ts`; when adding
  a new template, check the modals and the canvas.

## 5. Additional recommendations

- **Mandatory typecheck**: after any code change, run `npm run typecheck` (equivalent to
  `tsc --noEmit`). Do not finish with type errors.
- **Verification build**: if the change involves building/packaging, verify with
  `npm run build` (generates the frontend). Desktop/Android builds are slow; use only
  when necessary (`build:desktop`, `build:android`).
- **IndexedDB migration**: when changing the schema (new object stores/fields),
  **increase the version** (`DB_VERSION` in `src/db.ts`) and implement the migration
  in `onupgradeneeded`. Never break existing user data.
- **Do not break sync**: data comes from backup/sync and may be in old versions.
  Maintain defensive normalization (e.g., `texts ?? []`, `backgroundColor ?? '#ffffff'`)
  in `src/store.ts` (`applySyncChanges`, `init`, `replaceAllData`) and update the
  `SyncManifest`/algorithm in `src/utils/sync.ts` only with care and migration.
- **`ink:*` events**: these are the "API" between UI and canvas. When renaming/removing
  payloads, look for all usages (dispatch and listener) and update the documentation table.
- **Code standard**: follow the existing style (no unnecessary comments, clear English
  names for code, UI texts in pt-BR). Do not introduce new dependencies unnecessarily.
- **Modifying behavior**: before changing an existing flow (e.g., saving, syncing,
  exporting), read the current code of the flow and the corresponding section of the
  documentation so as not to regress features.
