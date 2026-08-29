# Mamaco Notes

**English** | [Português](README.pt-BR.md)

<p align="center">
  <img src="https://socialify.git.ci/SorrisoKDente/MamacoNotes/image?language=1&logo=https%3A%2F%2Fgithub.com%2FSorrisoKDente%2FMamacoNotes%2Fblob%2Fmaster%2Fbuild-resources%2Ficon.png%3Fraw%3Dtrue&name=1&owner=1&pattern=Charlie+Brown&stargazers=1&theme=Dark" alt="MamacoNotes" width="640" height="320" />
</p>

**Mamaco Notes** is a digital note-taking application designed for hand-writing and drawing, serving as a cross-platform alternative to Samsung Notes. It is built to work seamlessly across **Windows**, **Linux**, **Android**, and the **Web**.

This project was developed almost 100% using **MonkeyCodeAI**, leveraging AI-assisted development to create a robust and feature-rich application.

## 📸 Screenshots

<p align="center">
  <img src="assets/mamaco_notes_layout.png" alt="App Layout" width="800"/>
</p>

Beyond the technology, **Mamaco Notes** represents a personal learning journey. As a developer exploring the world of multi-platform development (Windows, Linux, and Android) for the first time, I am using this project as a hands-on way to master new tools, architectures, and the challenges of creating a seamless experience across different devices.

## 🚀 Key Features

-   **Multi-Platform Support**: Available as a Desktop app (Electron for Windows/Linux), a Mobile app (Capacitor for Android), and a PWA (Progressive Web App).
-   **Advanced Drawing Engine**: A custom-built Canvas 2D engine supporting:
    -   Pressure-sensitive Pen and Marker tools.
    -   Efficient Eraser (strokes and image erasing).
    -   Selection tool with free-form, rectangle, and circle regions.
    -   Delimited selection (split strokes and crop images dynamically).
-   **Layer Management**: Professional-grade layer system allowing you to:
    -   Add, rename, duplicate, and merge layers.
    -   Adjust opacity and toggle visibility/locking.
    -   Organize content (images, text, strokes) hierarchically with folders and a **resizable layers panel**.
-   **Cloud Synchronization**: Bidirectional sync via **WebDAV**. Currently validated primarily with **Koofr**; while it supports the standard WebDAV protocol (Nextcloud, ownCloud, etc.), full compatibility with other providers is still being verified. **Network resilience**: connection failures are retried automatically (3 attempts with backoff) with a friendly message when the server is unreachable — never retries HTTP/auth errors.
  -   **Updates**: Desktop updates force-close the running app automatically, and the installer remains cancellable while files are being copied.
-   **Local Trash**: Deleted folders and notebooks go to a local (non-synced) trash where each item can be restored individually. Items deleted "local + cloud" are restored from the local copy; items deleted "local only" with a cloud configured can be brought back with **"Restore from cloud"**. Retention is 30 days.
-   **PDF & Image Integration**:
    -   Import PDFs as new notebooks or as page backgrounds.
    -   Insert and transform images (move, resize, rotate).
    -   Export your notes as high-quality PNG or PDF files.
-   **Organization**:
    -   Nested folders and notebooks for easy categorization.
    -   **Search bar** to quickly find folders and notebooks by name.
    -   **Rename** folders, notebooks (sidebar/top bar) and layers (layers panel) via context menu, double-click, or the **F2** shortcut on the last clicked item (falling back to the selected/active item).
    -   Drag-and-drop reordering for folders, notebooks, and pages.
    -   Multi-selection support for bulk actions (copy, move, delete).
-   **Intelligent UI & UX**:
    -   Multi-touch support for tablets and phones (pinch zoom, pan).
    -   Custom gestures: two-finger double-tap for **Undo**, three-finger double-tap for **Redo**, two fingers to move/zoom, and three-finger twist for **Page rotation**.
    -   Software Update system: automatic check on startup for all platforms with release notes preview. Desktop updates install silently and restart the app automatically, without blocking dialogs; the Windows installer also migrates installations whose legacy uninstaller returns error 2.
    -   Full localization in **English** and **Portuguese (pt-BR)**.
    -   Dark/Light mode support and customizable toolbar/sidebar visibility (with floating buttons for quick restoration).
    -   Option to hide the tool cursor for a cleaner drawing experience.
-   **Security & Persistence**:
    -   Data stored locally using **IndexedDB** (saved automatically).
    -   Session restoration to automatically reopen the last notebook and page, and each notebook remembers its last viewed page (returning to it when you switch notebooks or reopen the app).
    -   Manual full backup (JSON) import/export (**passwords excluded for security**). On mobile, export uses the **system "Save As" picker** so you can choose exactly where to save your backup file.
    -   **OOM-safe on Android**: large notebook sync happens in chunks (HTTP Range downloads and streamed PUT uploads through one native output stream), so big payloads never cross the Capacitor bridge in one call; PUT chunks preserve UTF-8 byte lengths for notes with accented or non-Latin text.
    -   **Sync bug fixes**: manual sync and auto-sync use the same algorithm — a notebook edited locally is **pushed**, never force-pulled over the edit (pulled content is applied before the sync baseline advances, so a failed apply is re-attempted on the next sync instead of being silently skipped); pending local persistence timers are discarded after a cloud replacement; deleted items never come back (tombstones are respected when pulling), stale local baselines recover the newer remote notebook, and a folder delete propagates to its subfolders/notebooks; restoring an item from the trash re-uploads it to the cloud instead of deleting it again.

## 🛠️ Tech Stack

-   **Frontend**: [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
-   **Build Tool**: [Vite 6](https://vitejs.dev/)
-   **State Management**: [Zustand](https://github.com/pmndrs/zustand)
-   **Persistence**: IndexedDB (local) & WebDAV (cloud)
-   **Desktop**: [Electron](https://www.electronjs.org/)
-   **Mobile**: [Capacitor](https://capacitorjs.com/)
-   **Drawing Engine**: Custom HTML5 Canvas 2D implementation
-   **PDF Processing**: `pdfjs-dist`

## 📁 Project Structure

For a detailed map of the project files, architecture, and information lookup, please refer to the [Project Structure Documentation](docs/PROJECT_STRUCTURE.md).

## 📜 Open Source & Future

This project is **open-source** and free to use at your convenience. Although it started as a personal tool, I am committed to continuous improvement, fixing bugs, and enhancing the overall experience.

## 💡 Suggestions & Support

I am always open to suggestions and feedback! Since this is a learning project, there are many features that have not been extensively tested yet, and some may not work 100% as expected. Your feedback after testing the app is extremely important to help me identify and fix issues.

If you have ideas for improvements or want to report a bug, please let me know.

If you find this project useful and would like to support its development financially, you can donate through:
- ☕ **Ko-fi**: [ko-fi.com/yabaihonyaku](https://ko-fi.com/yabaihonyaku)
- 💸 **Pix (Brazil)**: `mamaconotes@gmail.com`

<p align="center">
  <img src="assets/YABAIPIX.png" alt="Pix QR Code" width="200"/>
</p>

## 🤖 Developed with AI

Mamaco Notes is a testament to the power of AI in modern software engineering. The entire architecture, drawing logic, synchronization algorithms, and UI components were developed through a collaborative process using **MonkeyCodeAI** and **Google Gemini**.

The project also features a **modular instruction system** (located in `.agents/skills/`), optimizing the AI's context and decision-making for complex cross-platform tasks.

---

*Made with 🍌 by the Mamaco Team.*  
*P.S.: If you also came to see the monkey, you're in the right place!*
