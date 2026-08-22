# Mamaco Notes

**English** | [Português](README.pt-BR.md)

**Mamaco Notes** is a digital note-taking application designed for hand-writing and drawing, serving as a cross-platform alternative to Samsung Notes. It is built to work seamlessly across **Windows**, **Linux**, **Android**, and the **Web**.

This project was developed almost 100% using **MonkeyCodeAI**, leveraging AI-assisted development to create a robust and feature-rich application.

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
    -   Organize content (images, text, strokes) hierarchically.
-   **Cloud Synchronization**: Bidirectional sync via **WebDAV**. Currently validated primarily with **Koofr**; while it supports the standard WebDAV protocol (Nextcloud, ownCloud, etc.), full compatibility with other providers is still being verified.
-   **PDF & Image Integration**:
    -   Import PDFs as new notebooks or as page backgrounds.
    -   Insert and transform images (move, resize, rotate).
    -   Export your notes as high-quality PNG or PDF files.
-   **Organization**:
    -   Nested folders and notebooks for easy categorization.
    -   Drag-and-drop reordering for folders, notebooks, and pages.
    -   Multi-selection support for bulk actions (copy, move, delete).
-   **Intelligent UI & UX**:
    -   Multi-touch support for tablets and phones (pinch zoom, pan).
    -   Custom gestures, such as two-finger double-tap for **Undo**.
    -   Full localization in **English** and **Portuguese (pt-BR)**.
    -   Dark/Light mode support and customizable toolbar/sidebar visibility.
-   **Security & Persistence**:
    -   Data stored locally using **IndexedDB**.
    -   Automatic local backups to disk (Electron) or browser directory.
    -   Manual full backup (JSON) import/export.

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

I am always open to suggestions and feedback! If you have ideas for improvements or want to report an issue, please let me know.

If you find this project useful and would like to support its development financially, you can donate through:
- ☕ **Ko-fi**: [ko-fi.com/yabaihonyaku](https://ko-fi.com/yabaihonyaku)
- 💸 **Pix (Brazil)**: `yabaihonyaku@gmail.com`

## 🤖 Developed with AI

Mamaco Notes is a testament to the power of AI in modern software engineering. The entire architecture, drawing logic, synchronization algorithms, and UI components were developed through a collaborative process with **MonkeyCodeAI**.

---

*Made with 🍌 by the Mamaco Team.*  
*P.S.: If you also came to see the monkey, you're in the right place!*
