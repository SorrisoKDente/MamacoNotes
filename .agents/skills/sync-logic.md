# Skill: Synchronization Logic & Data Integrity

**English** | [Português](sync-logic.pt-BR.md)

This skill covers the bidirectional synchronization algorithm used to keep notes consistent across devices.

## 🧠 Core Principles

### 1. Manifest-Commit Guarantee
- The local sync baseline (`cloudSync.notebooks`/`foldersHash`) must **only** advance after the server successfully confirms the writing of the new `manifest.json`.
- If the manifest write fails, the sync process must **rollback** to the previous baseline state. This ensures the next sync re-evaluates the same plan and prevents silent data overwrites.

### 2. Defensive Normalization
- Data arriving from Sync or Backup must be passed through `normalizePage` in `src/types.ts`.
- Ensure fallback values for missing fields (e.g., `layers: []`, `texts: []`, `backgroundColor: '#ffffff'`) to maintain backward compatibility with older client versions.

### 3. Tombstones & Restoration
- Deleted items must generate a **Tombstone** (stored in `cloudSync`).
- During the `pull` phase of `buildPlan`, any remote ID present in `state.tombstones` must be ignored to prevent deleted items from "coming back."
- Restoration from the trash must clear the tombstone and force a `push` to the cloud.

## 🧪 Verification
- **Regression Testing:** Before finishing changes to `sync.ts` or `webdav.ts`, run the regression suite:
  `npx tsx scripts/verify-sync.ts`
- **Download Verification:** For network engine changes, run:
  `npx tsx scripts/verify-download.ts`
