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

## 5. Verification
- **Regression Suite**: `scripts/verify-sync.ts` (standalone test with mocked transport).
- **Download Test**: `scripts/verify-download.ts` (verifies Android range reconstruction).
