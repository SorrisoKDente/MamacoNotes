# 🗺️ Roadmap & Known Issues

This document tracks current bugs, planned improvements, and long-term ideas for Mamaco Notes.

## 🐛 Known Bugs (Priority Fixes)

- [ ] **Editor Navigation**: Zoom in/out and Recenter buttons are currently unresponsive on Desktop and Web versions (working only on Android).
- [ ] **UI Persistence**: The context menu does not automatically close after selecting the "Rename" option on a Dashboard item.
- [ ] **Drawing Engine**: Single-click drawing is currently not registered; the cursor requires a minimum drag distance to begin a stroke.
- [ ] **Thumbnail Generation**: Dashboard notebook previews are incorrectly zoomed in, displaying only the center of the page instead of a proper fit-to-box preview.

## ✨ Planned Features & Improvements

- [ ] **Navigation Flow**: Implement folder state persistence so that returning from the Editor brings the user back to the exact subfolder they were in.
- [ ] **Context-Aware Shortcuts (Ctrl+A)**: 
  - **Page Preview**: Select all pages.
  - **Canvas**: Select all strokes, images, and text.
  - **Layers Panel**: Select all layers and layer folders.
- [ ] **Extended Clipboard**: Support for Copy (`Ctrl+C`), Paste (`Ctrl+V`), and Delete (`Del`) for layers, notebooks, and folders.
- [ ] **Safe Deletion**: 
  - Implement a confirmation popup for bulk deletion of layers or folders.
  - **Layer Constraint**: Ensure at least one layer always exists; if the user attempts to delete all, prompt them to select one to remain.

## 💡 Future Ideas (Backlog)

### Dashboard & UX
- [ ] **Hover Tooltips**: Display the full name of folders and notebooks when hovering over them for a short period (Sidebar and Grid view).
- [ ] **Visual Sync Diff**: Show a side-by-side preview of differences between local and cloud versions when a sync conflict occurs.
- [ ] **Minimalist Desktop UI**: Option to remove the standard native menu bar (File, Edit, View) in the Electron version for a more immersive experience.
- [ ] **Rich Release Notes**: Render Markdown previews directly within the Software Update modal.

### Advanced Drawing Tools
- [ ] **Dynamic Canvas**: Option to create notes with an "infinite" auto-growing canvas (limited to separate pages mode).
- [ ] **Format Support**: Add JPEG export support.
- [ ] **Geometric Tools**: 
  - Eyedropper tool for color picking.
  - Dedicated geometric shapes tool.
  - "Shift" shortcut during drawing to snap to straight lines.
  - Automatic shape and handwriting correction (similar to Samsung Notes).
- [ ] **AI Integration**: Handwriting-to-Text conversion (OCR).
