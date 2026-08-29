# Habilidade: Padrões de UI/UX e Estilos

[English](ui-ux-standards.md) | **Português**

Esta habilidade define os padrões visuais e de interação para o Mamaco Notes.

## 🧠 Princípios Core

### 1. Interações Não-Bloqueantes
- **Proibição:** Nunca use diálogos nativos do navegador como `alert()`, `confirm()` ou `prompt()`. Eles bloqueiam a thread do JavaScript e causam "Ghost Pointer Captures" no Electron.
- **Padrão:** Use o sistema de modais customizado via `useUiStore`.
  - Use `confirmAction` para perguntas de sim/não.
  - Use `alertAction` para mensagens informativas.
  - Use `promptName` para entradas de texto.

### 2. Responsividade Mobile e Touch
- **Áreas Seguras (Safe Areas):** Sempre respeite `env(safe-area-inset-top)` e `bottom` no CSS para evitar sobreposição com notches ou gestos do sistema.
- **Alvos de Toque:** Botões no mobile devem ter uma área mínima confortável (geralmente ~44px de altura ou ajustes de padding específicos em `@media (max-width: 1024px)`).
- **Barras Responsivas:** As barras (Sidebar/PageList) devem se comportar como overlays no mobile e serem colapsáveis.

### 3. Convenções de CSS
- Evite seletores de elementos globais (ex: `button { ... }`). Use classes específicas para evitar efeitos colaterais indesejados na UI.
- Use as variáveis CSS definidas em `:root` (ex: `--accent`, `--bg-2`, `--border`) para todas as cores, mantendo a consistência do tema.

### 4. Internacionalização (i18n)
- Toda string voltada para o usuário deve residir em `src/i18n/ptBR.ts` e `src/i18n/en.ts`.
- As chaves do dicionário devem ser agrupadas por área: `modal.*`, `tool.*`, `sidebar.*`, etc.
- Use `{{param}}` para interpolação.
