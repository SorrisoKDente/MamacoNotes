# Agent System & Project Guidelines — Mamaco Notes

**English** | [Português](AGENTS.pt-BR.md)

You are an expert AI developer responsible for maintaining and evolving Mamaco Notes, a high-performance, multi-platform digital note-taking app.

## ⚠️ MANDATORY GLOBAL RULES (The Golden Rules)

These rules apply to **every task**, regardless of the platform or feature. Failure to follow these rules is considered a project regression.

1.  **Systematic Debugging:** Never apply "symptomatic patches." You must find the **Root Cause** before writing any fix. Trace the data flow from UI to Native if necessary.
2.  **Map Awareness:** Always read `docs/PROJECT_STRUCTURE.md` at the start of a session to locate features, stores, and events.
3.  **Documentation Sync:** If you change any project structure (files, stores, events, features), you **MUST** update `docs/PROJECT_STRUCTURE.md` in the **same commit**.
4.  **Language Integrity:** New UI strings must be added to both `src/i18n/ptBR.ts` and `src/i18n/en.ts`. No hardcoded strings in JSX.
5.  **Typecheck Obligation:** Always run `npm run typecheck` before finishing. Do not commit code with TypeScript errors.
6.  **Multi-platform Fallback:** No feature can be exclusive to one platform (Windows/Linux/Android/Web) without a functional fallback for the others.
7.  **Commit Hygiene:** Always end the task by suggesting a Git commit message in English, following the **Conventional Commits** standard (e.g., `feat:`, `fix:`, `docs:`, `chore:`).
8.  **Roadmap Protocol:** Never remove an item from `docs/ROADMAP.md` until the user explicitly confirms the implementation/fix.
9.  **Plan-First Workflow:** For any non-trivial task, present a concise implementation plan for approval **before** modifying any code.

## 📚 Knowledge Base & Skills

Before any task, consult the [Project Structure](file:///C:/Users/Eric PC/Documents/Programas/mamaco_notes_dev/mamaco_notes/docs/PROJECT_STRUCTURE.md) for a map of features. For deep technical dives, use the resources below:

### 🏛️ Architecture Docs
- **[Sync Design](./docs/architecture/sync-design.md):** Detailed WebDAV algorithm and manifest-commit guarantees.
- **[Layer System](./docs/architecture/layers-design.md):** Data model and rendering logic for drawing layers.
- **[Drawing Engine](./docs/architecture/drawing-engine.md):** Coordinate systems, gestures, and multi-touch logic.
- **[Translation System](./docs/architecture/i18n-system.md):** How the custom i18n implementation and dictionaries work.

### 🛠️ Specialized Skills Index
For platform-specific constraints, activate the corresponding skill:

-   **[Roadmap Management](./.agents/skills/roadmap-management.md):** Protocol for updating the roadmap. Items are only removed after explicit user verification of the fix/feature.
-   **[Systematic Debugging](./.agents/skills/systematic-debugging.md):** Mandatory methodology for root cause analysis. Always activate this skill when investigating bugs or applying fixes to ensure permanent solutions.
-   **[Android & Capacitor Bridge](./.agents/skills/android-native.md):** Rules for OOM prevention, chunked I/O, SAF (Storage Access Framework), and native plugin management.
-   **[Synchronization Logic](./.agents/skills/sync-logic.md):** Bidirectional WebDAV algorithm rules, manifest-commit guarantees, and regression testing.
-   **[UI/UX & CSS Standards](./.agents/skills/ui-ux-standards.md):** Modal system rules (async-only), responsive safe-areas, i18n dictionaries, and CSS naming conventions.
-   **[Desktop & Windows Installer](./.agents/skills/desktop-build.md):** Electron process management, NSIS installer stability, and per-user vs. per-machine permissions.
-   **[Versioning & Releases](./.agents/skills/versioning.md):** Rules for synchronizing versions across package.json, build.gradle, and types.ts.

## 🚀 Key Commands
- `npm run typecheck` (Mandatory before finishing)
- `npm run dev:desktop` (Test Windows/Linux)
- `npm run build:android` (Sync web assets to Android)
- `npx tsx scripts/verify-sync.ts` (Verify sync logic)
