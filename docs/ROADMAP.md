# 🗺️ Roadmap & Known Issues

This document tracks current bugs, planned improvements, and long-term ideas for Mamaco Notes.

## 🐛 Known Bugs (Priority Fixes)

- [x] **Editor Navigation**: Zoom in/out and Recenter buttons are currently unresponsive on Desktop and Web versions (working only on Android).
- [x] **Drawing Engine**: Single-click drawing is currently not registered; the cursor requires a minimum drag distance to begin a stroke.
- [x] **Critical Performance (Android)**: Severe lag reported in specific notes. Fixed through rendering and persistence performance improvements.
- [x] **Cloud Sync Status False Positive**: When importing a backup from a device that was cloud-connected, the app reported as "Connected" even though the password was missing. Now automatically disconnects if the password is absent after import.
- [x] **Multi-touch Drawing Artifacts**: Depending on how two fingers touch the screen on mobile, stray lines may be created connecting the two points.
- [x] **Cross-page Undo Corruption**: Pressing Ctrl+Z after switching pages duplicated content from the previous page onto the current one instead of undoing on the correct page.
- [x] **Premature Stroke Deletion**: Some strokes were being intermittently deleted or discarded before completion. Fixed by preventing engine resets during active gestures.
- [x] **Thumbnail Generation**: Dashboard notebook previews are incorrectly zoomed in, displaying only the center of the page instead of a proper fit-to-box preview.
- [x] **Mobile Update Preview**: The software update modal on mobile now correctly renders release notes using a lightweight Markdown parser.
- [x] **Single-Click Eraser Area Bug**: Erasing with a single click (tap) erases an area much larger than the eraser size. Dragging works correctly.
- [x] **Writing Fails After Undo**: Undoing an action (Ctrl+Z) and writing or drawing immediately afterwards results in nothing being written due to internal editor state desynchronization.
- [x] **Eraser Mask Overlap Issue**: Erasing content and then dragging an element over the erased region causes the dragged element to disappear underneath (as if the eraser drew a solid background mask over lower layers).
- [x] **Intermittent Text Blurring After Erase**: Erasing strokes occasionally causes existing text elements on the page to render blurry (hard to reproduce).
- [x] **Shortcut Cursor Restoration (Pan/Move)**: Releasing the Pan (`Alt`) or Move shortcut key leaves the Pan/Move cursor visible until clicked, instead of dynamically restoring the active tool cursor.
- [ ] **Duplicate Tool Cursor During Pan**: When the tool cursor is visible, activating the Pan shortcut can leave the old tool cursor visible underneath the Pan cursor until the shortcut is released.
- [x] **Missing Fullscreen Option in Web**: The fullscreen toggle button is shown in the browser version (Web/PWA) on both the Dashboard and Editor views.
- [x] **Layer Element Z-Ordering (Images/Strokes/Text)**: Within a single layer, images render in a fixed order relative to strokes and text, making it impossible to write or place text over an image without creating a new layer. Fixed with a per-element `order` (new content lands on top) plus bring-to-front/forward/backward/send-to-back actions in the Select panel.
- [x] **Intermittent Missing Stroke**: sometimes a stroke drawn right after another one does not appear / is not kept (the "second stroke" disappears).
- [x] **Desktop Cursor Stutter**: the remaining slight stutter was reduced through a lightweight native hover path and cursor-layer optimization. Re-test later with pages containing multiple or large PDF backgrounds to confirm performance under heavier rendering loads. The cursor-size change issue is not included here; it appeared only in a reverted implementation and was observed while changing size, not while drawing.
- [x] **Tool Cursor Visibility and Size**: browser visibility and immediate cursor resizing were fixed without forcing canvas renders.
- [x] **Canvas Trembling and Blurring**: the page can appear to shake slightly or become blurred while writing.
- [x] **PDF Background Blurring After Erase**: on pages with a PDF background, erasing a stroke can leave all page strokes blurred.
- [x] **Mobile Sync Not Applying to Open Note**: on a phone, accepting a cloud conflict for one note may show no visible change in the currently open note, while other notes synchronize correctly.

## ✨ Planned Features & Improvements

- [x] **Navigation Flow**: Returning from the Editor now brings the user back to the exact subfolder they were in.
- [x] **Auto-follow Page Preview**: The page list now automatically scrolls to keep the current page in view and opens at the correct position when expanded.
- [x] **Toolbar Submenu Toggle Logic**: Switching tools in the sidebar toolbar should only select the tool without opening its configuration submenu. Clicking an already active tool icon toggles its submenu open/closed.
- [x] **Solid Pen Cursor**: Change the pen tool cursor from semi-opaque to a solid color for better visibility.
- [x] **Granular Tool Cursor Hiding**: Add independent options to hide the pen, highlighter, and eraser cursors, plus a master control to hide/show all three.
- [x] **Sync Progress Details**: Show synchronization progress in the cloud tab, including percentage and the file currently being synchronized.
- [x] **Dashboard Sync Button**: Add a cloud synchronization button to the Dashboard, not only to the editor/top bar.
- [x] **Consistent Desktop Backup Filename**: Format Desktop/Electron backup export filenames with a date-timestamp (`mamaco-notes-backup-YYYY-MM-DD-HHmmss.json`), matching the Android mobile behavior.
- [x] **F2 File Rename**: Rename the active notebook/file with the F2 shortcut from the Dashboard and Editor.
- [x] **Context-Aware Shortcuts (Ctrl+A)**:
  - **Page Preview**: Select all pages.
  - **Canvas**: Select all strokes, images, and text.
  - **Layers Panel**: Select all layers and layer folders.
- [x] **Extended Clipboard**: Support for Copy (`Ctrl+C`), Paste (`Ctrl+V`), and Delete (`Del`) for layers, notebooks, and folders.
- [x] **Safe Deletion**:
  - [x] Implement a confirmation popup for bulk deletion of layers or folders.
  - [x] **Layer Constraint**: Ensure at least one layer always exists; attempts to delete all layers are rejected with feedback.
- [x] **Layer Folder Clipboard and Ordering**: Ctrl+A/C/X/V/Delete now includes layer folders, and folder/layer drag destinations support root, before, after, and inside-folder operations.
- [x] **Dashboard Root Drag Target**: Items can be dragged from a folder back to the root through the Dashboard root drop target.
- [x] **Dashboard Undo Isolation**: Dashboard undo/redo restores metadata without reopening or entering a notebook.
- [x] **Nested Layer Folders**: Layer folders support nesting, recursive copy, recursive deletion, and drag-and-drop into another folder.
- [x] **Layer Folder Arrow Direction**: Collapsed folders point right and expanded folders point down.
- [x] **Dashboard Folder Escape Drop**: Items inside a Dashboard folder can be dragged back to the root.
- [x] **Android Direct APK Download**: Implement direct APK file downloading for Android updates (similar to Windows/Linux) instead of redirecting users to GitHub for manual download.

## 💡 Future Ideas (Backlog)

### Dashboard & UX
- [x] **Hover Tooltips**: Display the full name of folders and notebooks when hovering over them for a short period (Sidebar and Grid view).
- [ ] **Visual Sync Diff**: Show a side-by-side preview of differences between local and cloud versions when a sync conflict occurs.
- [ ] **Minimalist Desktop UI**: Option to remove the standard native menu bar (File, Edit, View) in the Electron version for a more immersive experience.
- [ ] **Cursor Layer Isolation**: Move the tool cursor to an independent fixed-position layer outside the canvas interaction tree to reduce hover coupling. **Risks:** coordinate drift when panels, zoom, scrolling, fullscreen, or device pixel ratio change; cursor/tool state desynchronization; extra platform-specific positioning work. Validate with mouse, pen, touch, Electron, browser, and Android. Previous prototype was reverted after increasing perceived latency.
- [ ] **Offscreen PDF Rendering**: Render heavy PDF backgrounds through `OffscreenCanvas` or pre-rendered bitmap workers to keep the main thread responsive. **Risks:** browser/Android/WebView support differences, higher memory usage, worker lifecycle complexity, export/rendering discrepancies, and possible blur or stale-background regressions. Validate PDF zoom, erase, export, sync, and low-memory devices.
- [ ] **High-Frequency Pointer Events**: Evaluate `pointerrawupdate` and coalesced pointer events for smoother drawing and cursor tracking. **Risks:** inconsistent event support and frequency across browsers, duplicate processing, higher CPU/battery usage, and interference with touch gestures or undo boundaries. Validate stroke ordering, pressure, palm rejection, multi-touch, and fallback behavior.
- [ ] **Dedicated Cursor Compositor Path**: Use a compositor-friendly cursor element with transform-only updates and stricter style caching, independent from editor rendering. **Risks:** visual desynchronization during zoom/pan, stacking and clipping issues, accessibility/visibility inconsistencies, and platform-specific compositor behavior. Validate cursor size, pressure, tool switching, hidden-cursor settings, and heavy PDF pages.

### Advanced Drawing Tools
- [ ] **Dynamic Canvas**: Option to create notes with an "infinite" auto-growing canvas (limited to separate pages mode).
- [x] **Format Support**: Add JPEG export support.
- [ ] **Geometric Tools**: 
  - Eyedropper tool for color picking.
  - Dedicated geometric shapes tool.
  - "Shift" shortcut during drawing to snap to straight lines.
  - Automatic shape and handwriting correction (similar to Samsung Notes).
- [ ] **AI Integration**: Handwriting-to-Text conversion (OCR).
