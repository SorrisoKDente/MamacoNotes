# Skill: Desktop Build & Windows Installer

**English** | [Português](desktop-build.pt-BR.md)

This skill covers Electron process management and Windows NSIS installer configuration.

## 🧠 Core Principles

### 1. Process Lifecycle (Single Instance)
- The app must implement `requestSingleInstanceLock()`.
- Secondary processes (like a new installer launch) must be terminated immediately with `app.exit(0)` to prevent file locks on `.asar` and `.exe` files.
- Use `app.on('before-quit', ...)` to force immediate cleanup of database connections.

### 2. NSIS Installer Stability
- **Fixed Identity:** The installer should rely on the `appId` as its primary GUID. Never use randomly generated GUIDs in `package.json`.
- **Scope:** Default to `perMachine: false` (Per-user installation) to avoid mandatory admin prompts, but enable `allowElevation: true` to handle cleanup of old "Program Files" installations.
- **Uninstallation:** Always provide the option `deleteAppDataOnUninstall: true` to allow users to wipe their `IndexedDB` data during removal.

## 🛠️ Verification
- Test build output using `npm run build:win`.
- Verify installer behavior locally before pushing tags that trigger GitHub Actions.
