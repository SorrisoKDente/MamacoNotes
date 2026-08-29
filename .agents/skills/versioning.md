# Skill: Versioning & Release Management

**English** | [Português](versioning.pt-BR.md)

This skill defines the mandatory workflow for updating the application version across all supported platforms.

## 🧠 Core Principles

### 1. Synchronization Requirement
The version must be updated in four specific locations simultaneously to ensure consistency between the Web UI, the Electron desktop app, and the Android package.

### 2. Files to Update

#### A. [package.json](../../package.json)
- **Field:** `version`
- **Format:** Semantic Versioning (e.g., `1.2.3`).
- **Impact:** Used by the Electron build, PWA manifest, and update check logic.

#### B. [src/types.ts](../../src/types.ts)
- **Constant:** `APP_VERSION`
- **Format:** Must match `package.json` exactly.
- **Impact:** Displayed in the UI (Settings > General) and used for local logs.

#### C. [android/app/build.gradle](../../android/app/build.gradle)
- **Fields:**
  - `versionName`: Must match `package.json` (e.g., `"1.2.3"`).
  - `versionCode`: An incremental integer.
- **Standard Formula:** `(Major * 10000) + (Minor * 100) + Patch`
  - *Example:* `1.2.2` -> `10202`.
  - *Example:* `1.0.69` -> `10069`.
- **Impact:** Critical for Google Play Store updates.

#### D. [package-lock.json](../../package-lock.json)
- **Action:** Run `npm install` (or a simple build) after changing `package.json` to ensure the lockfile is synced.

## 🛠️ Release Workflow
1. Increment the version in all 4 files mentioned above.
2. Run `npm run typecheck` to ensure no breaking changes in `types.ts`.
3. Run `npm run build:android` to sync the new version to the Android project.
4. Update `docs/PROJECT_STRUCTURE.md` if the version change accompanies structural updates.
5. Commit all version changes in a single "Release vX.Y.Z" commit.
