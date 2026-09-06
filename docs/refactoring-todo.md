# Refactoring Checklist — Ponytail Pass (Mamaco Notes)

Checklist operacional da revisão/refatoração **Ponytail** (YAGNI, stdlib/native first,
deleção > adição, menor diff funcional). Auditoria realizada com a skill
`ponytail-audit`; cada achado foi **verificado com grep/ripgrep** antes de entrar aqui.

**Regras que regem este documento:**
- Toda alteração estrutural exige atualizar `docs/PROJECT_STRUCTURE.md` (e o `.pt-BR`)
  **no mesmo commit** (AGENTS.md regra 3).
- `npm run typecheck` obrigatório antes de concluir cada fase.
- Não remover itens do `docs/ROADMAP.md`.
- Nunca simplificar segurança/validação nas bordas (ex.: `decodeCapacitorData`,
  sanitização de backup, tratamento de erros de rede).
- Smoke mínimo por etapa: `npx tsx scripts/verify-sync.ts` e `scripts/verify-download.ts`
  (+ os scripts de store/pdf mantidos). Baseline typecheck: pendente (deps em instalação).

**Status global:** `[ ]` = pendente · `[x]` = concluído · `[~]` = alterado/pulado com nota ·
`Lean already` = nada a fazer.

Estimativa: **net ≈ -200 linhas, -1 arquivo, -3 dependências** (+ ~50 exports tornados privados).

---

## FASE A — Deleção de código morto (zero mudança de comportamento)

> Ordem mais segura primeiro. Cada item é deletável de forma isolada e verificável.

- [x] **A1. Deletar arquivo vazio `server2.mjs`**
- [x] **A2. `src/utils/webdav.ts` — remover `MIME_MAP`**
- [x] **A3. `src/utils/colors.ts` — remover `hexToRgb`, `rgbToHex`, `colorWithAlpha`**
- [x] **A4. `src/utils/pdf.ts` — remover `pdfPageToImage`**
- [ ] **A5. `src/renderer/drawUtils.ts` — remover `drawLayer`** (exportado sem chamadores;
      thumbnail/export duplicam o loop inline e usam apenas
      `drawTemplate/drawStroke/drawTextOnCanvas`). *-15 linhas.*
- [x] **A6. `src/hooks/useShortcuts.ts` — remover `useEditorShortcuts`**
- [x] **A7. `src/utils/platform.ts` — remover `isElectron`**
- [x] **A8. `src/i18n/index.ts` — remover `getLanguage` e `initI18n`**
- [x] **A9. `src/store.ts` — remover as 3 ações mortas**
- [x] **A10. `electron/main.cjs` — remover IPC handlers mortos**
- [x] **A11. `electron/preload.cjs` — remover campos não lidos `isDesktop` e `platform`**

**Validação da Fase A:** `npm run typecheck` + smoke dos scripts verify.

---

## FASE B — Higiene de export/API (tornar privado o que só o próprio módulo usa)

> Nenhuma mudança funcional; encolhe a superfície pública (store de 82 KB, utils).
> Se um export "morto externamente" for usado internamente, apenas perde o `export`.

- [x] **B1. `src/store.ts` — remover `export` de helpers usados só internamente**
- [x] **B2. `src/utils/export.ts` — tornar privados `renderPageToCanvas`, `downloadDataUrl`, `buildSimplePdf`**
- [x] **B3. `src/utils/backup.ts` — tornar privados `sanitizeSettingsForBackup`, `buildBackupPayload`, `parseBackup` e o tipo `BackupPayload`**
- [x] **B4. `src/utils/chunkedIo.ts` — tornar privados `CHUNK_SIZE` e `readBackupFileFromUri`**
- [x] **B5. `src/utils/imageErase.ts` — `imageEraseParams` deixa de ser exportado**
- [x] **B6. `src/utils/drawText.ts` — deletar `DEFAULT_TEXT_WIDTH`**
- [x] **B7. `src/utils/fullscreen.ts` — deletar `isFullscreen`**
- [x] **B8. `src/utils/fonts.ts` — deletar `isFontLoaded`**
- [x] **B9. `src/utils/layout.ts` — deletar `totalDocumentSize`**
- [x] **B10. `src/utils/logger.ts` — remover pub/sub morto**
- [x] **B11. `src/utils/webdav.ts` — remover `export` de `ensureDirectory`, `listDirectory`, `uploadFile`, `downloadFile`, `deleteRemoteFile`**
- [x] **B12. `src/renderer/canvas.ts` — tipos `RendererCallbacks`/`CanvasProps` sem uso externo → não exportar**
- [x] **B13. `src/utils/platform.ts` — `isNativePlatform` deixa de ser exportado**

**Validação da Fase B:** `npm run typecheck` (exports não usados geram erro TS 6133/6196
se algum for realmente removível e referenciado — boa rede de segurança).

---

## FASE C — Remoção de dependências nativas não utilizadas (exige regen Android)

> 0 imports em `src/`, `scripts/`, `electron/`. Só aparecem em `package.json` e nos
> gradle gerados do Capacitor — logo, apenas aumentam o APK.

- [ ] **C1. Remover do `package.json`:** `capacitor-blob-writer` (substituído pelo plugin
      local `pick-directory` + `chunkedIo.ts`), `capacitor-native-settings`,
      `@capacitor/filesystem`.
      Passos: remover do `dependencies` → `npm install` → `npx cap sync android`
      (regenera `android/app/capacitor.build.gradle` e `android/capacitor.settings.gradle`)
      → validar compilação Android. Atualizar `docs/PROJECT_STRUCTURE.md:60` (linha do
      stack Android) e `.pt-BR` no mesmo commit.
- [ ] **C2. `pick-directory` (JS stub) — AVALIAR, não mexer por padrão:** `index.js` vazio +
      `index.d.ts` duplicam a interface inline de `chunkedIo.ts`, mas o pacote `file:` é
      necessário para o `cap sync` descobrir o plugin. *Provável `Lean already`.*

**Validação da Fase C:** build Android (`npm run build:android` ou ao menos `cap sync`
+ compile do projeto Android) e `npm run typecheck`.

---

## FASE D — Consolidação de duplicação (diffs pequenos, comportamento idêntico)

- [ ] **D1. `src/store.ts` — extrair helper privado para o guard repetido**
      "notebook ativo + página atual" (`notebook.pages[get().currentPageIndex]` aparece
      ~18×, com `if (!notebook) return` ~30×). Um helper `activePage()` remove ~20–30 linhas
      e padroniza o guard. *Risco: médio — contido em store.ts, validar com smoke.*
- [ ] **D2. `src/utils/export.ts` + `src/utils/backup.ts` — unificar lógica de download
      (anchor + objectURL + revoke) num único helper** (`downloadDataUrl` de export.ts;
      backup.ts:86–92 repete o bloco). *-8 linhas.*
- [ ] **D3. `src/utils/webdav.ts:8-9` × `src/utils/sync.ts:19-20` — `NOTEBOOKS_DIR` /
      `FOLDERS_DIR` definidos em ambos** → dedup (um importa do outro). *-4 linhas.*
- [ ] **D4. `src/renderer/canvas.ts` `renderBackground` vs `drawUtils.drawTemplate` —
      INVESTIGAR** (constantes idênticas RULED_SPACING/GRID_SIZE/MARGIN/cores; podem
      divergir em DPR/page-level). Se equivalente, reusar `drawTemplate`; senão
      `Lean already` (anotar motivo). *Não forçar.*

**Validação da Fase D:** `npm run typecheck` + smoke + comparar render de thumbnail/export
não muda (drawTemplate permanece usado pelos mesmos callers).

---

## FASE E — Opcional / adiado (churn alto, ganho marginal — decisão do usuário)

- [ ] **E1. Centralizar `clamp`** (6 cópias de uma linha: Editor, Toolbar `clampNum`,
      useShortcuts, drawUtils, canvas, colors 0-255). *Provável `Lean already`* — trocar
      6 one-liners por import vira wash e adiciona acoplamento em caminho quente (canvas).
- [ ] **E2. Padronizar geração de IDs (`uid()` × `newId()`)** — ~40 call sites divididos;
      `newId` (crypto.randomUUID) já cai para `uid`. Unificar exigiria tocar Editor,
      Modals, canvas, store, sync. Sem ganho de comportamento → *provavelmente skip.*
- [ ] **E3. Centralizar detecção desktop `!!window.inkfolioDesktop`** (~6 ocorrências com
      casts variados: App, main, i18n, updateCheck, Modals, backup). Adicionar helper em
      `platform.ts` = +1 export e imports novos; ~wash. *Provavelmente skip.*

---

## Itens verificados e mantidos (Lean already — não mexer)

- `scripts/verify-store.ts` e `scripts/verify-pdf-images.ts`: **regressão legítima**
  (normalização de folderId órfão; persistência light + migração v8→v9 de PDFs). Apesar de
  sem referência em package.json/CI, são o "one runnable check" das correções de root
  cause. **Manter** (e com eles `fake-indexeddb`). *Ponytail não flagra testes mínimos.*
- `scripts/verify-sync.ts` e `scripts/verify-download.ts`: documentados; manter.
- Factories de `src/types.ts` (`makePage`, `makeNotebook`, …): todas com múltiplos callers.
- Dicionários i18n: `en.ts`/`ptBR.ts` com 503 chaves cada, em sincronia total.
- `ModalName` (21 valores): todos implementados em Modals.tsx. Stores ui/text: todos os
  setters usados.
- Deps em uso real: `@capacitor/core|app|android`, `electron-updater`, `pdfjs-dist`,
  `react`, `react-dom`, `zustand`, todo o tooling de dev, `tsx` (via verify-*).
- Abstração `dialogs.ts`: decoupling justificado (evita importar pdf.js em scripts Node).
- Validação de borda/segurança: `decodeCapacitorData`, sanitização de backup, retry de rede
  (`isConnectionError`/`withRetry`) — **intocados por design**.

---

## Plano de execução (após aprovação do usuário)

1. Fase A (deleções puras) → typecheck + smoke → commit `refactor: remove dead code ...`.
2. Fase B (higiene de exports) → typecheck + smoke → commit `refactor: shrink public API surface`.
3. Fase C (deps nativas) → npm install + cap sync + build Android → commit `build: drop unused capacitor plugins`.
4. Fase D (dedup) → typecheck + smoke → commit `refactor: consolidate duplicated helpers`.
5. Fase E → apenas com aval explícito do usuário.
6. Fechamento: `git status` limpo, `PROJECT_STRUCTURE.md` sincronizado, sugestão de mensagem
   de commit final (Conventional Commits, em inglês).

> Protocolo Roadmap (AGENTS.md regra 8): nenhum item deste checklist é removido do
> `docs/ROADMAP.md` — este documento é independente.
