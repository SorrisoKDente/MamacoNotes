# Architecture: Bidirectional Synchronization

**English** | [Português](sync-design.pt-BR.md)

This document describes the detailed design and implementation of the synchronization system in Mamaco Notes.

## 1. Overview
The sync system keeps notebooks and folders consistent across devices using a WebDAV server. It handles conflicts, deletions (tombstones), and provides network resilience for mobile devices.

## 2. Technical Components
- **Transport**: `src/utils/webdav.ts`. Implements PROPFIND, MKCOL, PUT, and DELETE. Includes special handling for Koofr servers.
- **Algorithm**: `src/utils/sync.ts`. Logic for `buildPlan` and `runSync`.
- **State**: `db.ts` (`cloudSync` store) and `src/types.ts` (`CloudSyncState`).

## 3. Merge Algorithm
The algorithm compares the remote `manifest.json` with the local state and the last sync baseline (`cloudSync.notebooks` map and `foldersHash`).

### Decisions:
- **Push**: Local `updatedAt` > baseline AND remote matches baseline.
- **Pull**: Remote `updatedAt` > baseline AND local matches baseline.
- **Conflict**: Both local and remote have changed since the baseline.
- **Delete**: Item removed locally (generates a Tombstone) or missing from the remote manifest.

## 4. Data Integrity & Resilience
- **Manifest-Commit Guarantee**: The local baseline **only** advances after the server successfully confirms the writing of the new `manifest.json`. If it fails, a rollback occurs.
- **Conflict-Resolution Commit Guarantee**: Choosing the server copy applies and persists the downloaded notebook before committing the new baseline. A failed conflict action is surfaced and leaves the previous baseline intact, preventing a stale local copy from being pushed over the cloud copy on the next run.
- **Android Chunked I/O**: Large notebooks use HTTP Range requests (`downloadText` in `http.ts`) and streamed native uploads (`uploadFileStreaming` in `chunkedIo.ts`) to avoid OOM crashes.
- **Range Integrity**: Android downloads use 128 KiB Range requests, explicitly request binary content, validate each `Content-Range` start/end and byte count before concatenating chunks, and retry with smaller ranges when a WebDAV proxy returns a truncated response.
- **Koofr Content API**: Koofr downloads use its `/content/api/v2/mounts/{mountId}/files/get` endpoint instead of the WebDAV Range endpoint, avoiding the false partial responses returned by some Koofr WebDAV paths.
- **Progress Identification**: Sync progress displays both the remote file path and the local logical path (`folder/subfolder/notebook`) so similarly named notebooks can be distinguished.
- **Upload Verification**: Native JSON uploads are read back and parsed before the transport reports success, so a server that accepts a truncated/corrupt body cannot advance synchronization.
- **Conflict Resolution Failure**: If a selected conflict copy cannot be downloaded or applied, the baseline is not committed, progress remains in an error state, and the conflict choices remain available for retry.
- **Tombstones**: Deleted items are stored in `state.tombstones` to prevent them from being re-downloaded if they still exist on the server.
- **Self-Healing**: Missing remote files (404) are automatically reconciled by re-uploading the local copy or pruning the manifest entry.
- **Orphan Recovery**: Notebook bodies found in the remote `notebooks` directory but missing from `manifest.json` are validated and added to the manifest before planning, so interrupted manifest writes cannot hide a notebook from synchronization.
- **PDF Bitmap Repair**: PDF backgrounds are synced as `pdfs/<pageId>.png` (hashes in the manifest) with the notebook JSON carrying only `pdf: { name, pageNumber }`. A client older than 2.4.2 cannot read that format and stores the page without its bitmap. On the first sync of each app version, the client scans the local database for pages that kept the `pdf` metadata but have no bitmap (`db.getPagesMissingPdfBitmap`) and downloads the image back, even when the notebook's `updatedAt` matches the baseline and is never pulled. A 404 leaves the page untouched and is never retried. Network errors are kept in the same `localStorage` key as the version that scanned (`mamaco-notes.pdf-repair`, `{ version, pages }`): the scan runs once per version and the next sync retries only those pages, so a failed page is never forgotten and the whole database is never rescanned on every run. The repaired notebook is persisted and merged into the open editor without resetting undo. Bitmap downloads share a single budget of 3 in flight for the whole run (`PDF_BITMAP_DOWNLOADS` in `sync.ts`): each pulled notebook hydrates its pages in its own pool, so the limit is enforced by a shared semaphore instead of per notebook — two overlapping pulls would otherwise reach 2 x 3 = 6 requests. The repair pool collects its outcomes in plan order (not completion order), so the persisted retry list is stable across runs. A chunked download grows its Range size from 128 KiB up to 1 MiB while requests succeed: 1 MiB crosses the native bridge as ~1.4 MiB of base64 and is decoded back to 1 MiB, so one request peaks at a few MB and, with 3 in flight, the transient overhead stays around 10 MB even while two notebooks are pulled — far under the ~32 MB bridge limit and small next to the image the download has to hold anyway.
- **Termination (no self-triggered loop)**: content that a sync applies to the store (pulls, repairs) is not a local edit, so it never schedules another sync (`applyingRemoteChanges` makes the auto-sync subscription ignore the `dataVersion` bump that the UI still needs); a local change that arrives during a run sets `syncQueued` and is picked up by the normal 20s debounced auto-sync instead of restarting the run immediately in the `finally`.
- **Parallel Pulls**: notebook bodies are downloaded by a bounded pool of 2 (`NOTEBOOK_PULL_CONCURRENCY`), so a long list of notebooks no longer pays one round trip per file in series. Only the network/parse part runs concurrently; the manifest, the baseline and the result lists are updated afterwards in plan order, so a slow download cannot reorder the pulled notebooks, the reported names or the errors. The 404 self-heal (re-upload the local copy or prune the phantom manifest entry) runs inside the pool too, and because the manifest is only mutated after every download finishes, a worker never sees a half-applied manifest. Overlapping pulls do not multiply the bitmap downloads: they all go through one shared budget of 3 (`PDF_BITMAP_DOWNLOADS`), the bound the chunk size and the ~10 MB transient cost are documented against.
- **Sync Observability**: every run writes `Sync started (<trigger>)` (trigger `manual`, `auto`, `startup`, `delete` or `restore`; whether it runs the version scan; how many pages are being retried) and `Sync finished (<trigger>)` (duration, pushed/pulled/deleted/conflicts/errors, repaired and pending PDF pages, and `nextSyncScheduled`). In the Logs tab that distinguishes a real repeat loop from a single debounced follow-up.

## 5. Verification
- **Regression Suite**: `scripts/verify-sync.ts` (standalone test with mocked transport).
- **Download Test**: `scripts/verify-download.ts` (verifies Android range reconstruction).
- **Loop Regression**: `scripts/verify-sync-auto-loop.ts` drives the real `syncNow`/auto-sync subscriber against a local WebDAV stub and proves that applied remote content schedules no follow-up while a local edit made during a run is deferred to the debounce (and is not uploaded by that run).
- **Bitmap Repair Regression**: `scripts/verify-sync-pdfs.ts` covers the heal, the bounded parallel pool and the plan-ordered retry list.
