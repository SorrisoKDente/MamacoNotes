# Skill: Android Native & Capacitor Bridge

**English** | [Português](android-native.pt-BR.md)

This skill defines the technical constraints for working with the Android platform in Mamaco Notes.

## 🧠 Core Principles

### 1. Memory Safety (Anti-OOM)
- **The Capacitor Bridge Problem:** Sending objects larger than 32MB through `CapacitorHttp` or `Filesystem.writeFile` will crash the app with `java.lang.OutOfMemoryError`.
- **The Solution:** Always use **Chunked I/O**.
  - **Downloads:** Use `downloadText` in `http.ts` (HTTP Range requests).
  - **Uploads:** Use `uploadFileStreaming` in `chunkedIo.ts` (plugin-based stream).
  - **Local Files:** Use `PickDirectory` plugin methods (`readChunk`, `writeChunk`).

### 2. Plugin Management
- **Local Plugin:** The `PickDirectory` plugin lives in `/plugins/pick-directory`.
- **Conflict Avoidance:** Never create duplicate plugin classes in `android/app/src/main/java/com/mamaconotes/app/`. The Capacitor bridge should point only to the `/plugins` directory.
- **Registration:** Ensure `PickDirectoryPlugin.class` is registered in `MainActivity.java`'s `onCreate`.

### 3. Storage Access Framework (SAF)
- Use `content://` URIs for persistent user-selected directories.
- Always check `!file.exists()` before performing operations on `DocumentFile`.
- Use `ACTION_CREATE_DOCUMENT` for "Save As" functionality to ensure user control over file location.

## 🛠️ Build Workflow
1. Apply changes to Web code or Java files.
2. Run `npx cap sync android` to sync assets and plugins.
3. Verify the build with `npm run build:android`.
4. Use `read_logcat` to debug native crashes (look for `OutOfMemoryError` or `NullPointerException`).
