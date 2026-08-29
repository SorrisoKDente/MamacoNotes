# Architecture: Translation System (i18n)

**English** | [Português](i18n-system.pt-BR.md)

This document describes the custom internationalization (i18n) system used in Mamaco Notes.

## 1. Overview
The app uses a custom i18n implementation located in `src/i18n/` with no external dependencies. It supports **pt-BR** (default/fallback) and **en**.

## 2. Core Components
- **Dictionaries**: 
  - `src/i18n/ptBR.ts` (`ptBRMessages`): The source of truth containing all master keys.
  - `src/i18n/en.ts` (`enMessages`): The English translation.
- **API**:
  - `t(key, params?)`: Resolves a string at call time with support for `{{param}}` interpolation.
  - `useI18n()`: A React hook that forces re-renders when the language changes.
  - `setLanguage(lang)`: Updates the state and notifies Electron.

## 3. Integration
- **React**: Components use `const { t } = useI18n()` to render localized text.
- **Metadata**: `index.html` and PWA manifests use static initial values corrected at runtime.
- **Electron**: The main process uses its own `menuMessages` dictionary since it cannot import frontend TypeScript files.

## 4. How to Add a New String
1. Add the key and value to `src/i18n/ptBR.ts`.
2. Add the corresponding translation to `src/i18n/en.ts`.
3. Use `t('your.key')` in the code.
4. For dynamic values, use `t('key', { name: 'value' })` with `{{name}}` in the dictionary.

## 5. Constraints
- **No Hardcoding**: Hardcoded strings in JSX are forbidden (except for native language names in the selector).
- **Sync**: Both dictionaries must always have the same set of keys.
