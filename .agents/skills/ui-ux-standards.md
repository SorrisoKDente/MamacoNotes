# Skill: UI/UX Standards & Styles

**English** | [Português](ui-ux-standards.pt-BR.md)

This skill defines the visual and interaction standards for Mamaco Notes.

## 🧠 Core Principles

### 1. Non-Blocking Interactions
- **Prohibition:** Never use native browser dialogs like `alert()`, `confirm()`, or `prompt()`. These block the JavaScript thread and cause "Ghost Pointer Captures" in Electron.
- **Standard:** Use the custom modal system via `useUiStore`.
  - Use `confirmAction` for yes/no questions.
  - Use `alertAction` for informative messages.
  - Use `promptName` for text inputs.

### 2. Mobile & Touch Responsiveness
- **Safe Areas:** Always respect `env(safe-area-inset-top)` and `bottom` in CSS to avoid overlap with notches or system gestures.
- **Touch Targets:** Buttons on mobile must have a minimum comfortable area (usually ~44px height or specific padding adjustments in `@media (max-width: 1024px)`).
- **Responsive Bars:** Bars (Sidebar/PageList) should behave as overlays on mobile and be collapsible.

### 3. CSS Conventions
- Avoid global element selectors (e.g., `button { ... }`). Use specific classes to prevent unintended UI side-effects.
- Use the CSS variables defined in `:root` (e.g., `--accent`, `--bg-2`, `--border`) for all colors to maintain theme consistency.

### 4. Internationalization (i18n)
- Every user-facing string must reside in `src/i18n/ptBR.ts` and `src/i18n/en.ts`.
- Dictionary keys should be grouped by area: `modal.*`, `tool.*`, `sidebar.*`, etc.
- Use `{{param}}` for interpolation.
