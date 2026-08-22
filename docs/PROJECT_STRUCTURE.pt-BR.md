# Estrutura do Projeto — Mamaco Notes

Este documento descreve como o projeto **Mamaco Notes** está organizado. O objetivo é
servir de **mapa de localização de informação**: qualquer IA (ou pessoa) que ler este
documento deve saber em qual arquivo procurar uma determinada funcionalidade **sem ter
que explorar arquivo por arquivo**.

> Use a **seção 9 (Índice de busca de informação)** para localizar rapidamente o código
> de uma funcionalidade específica.

---

> **⚠️ INSTRUÇÃO OBRIGATÓRIA PARA QUALQUER IA**
>
> Este documento é a **fonte de verdade sobre a estrutura do projeto**. Se você for
> **alterar o funcionamento de qualquer parte desta estrutura** — adicionar, remover,
> renomear ou mudar a assinatura de arquivos, componentes, stores, eventos `ink:*`, tipos
> de dados, funcionalidades, fluxos ou plataformas — você **DEVE atualizar este documento
> na mesma mudança**. Mantenha-o sincronizado com o código:
>
> - novos/removidos/renomeados arquivos → **seção 4 (Mapa de arquivos)**;
> - mudanças em campos ou ações de store → **seção 5.5 (Contratos das stores)**;
> - novos tipos/campos persistidos ou mudança no IndexedDB → **seções 5.1 e 5.2**;
> - novos/alterados eventos `ink:*` → **seção 7 (Comunicação entre componentes)**;
> - novas funcionalidades, ferramentas ou fluxos → **seção 9 (Índice de busca)** e demais
>   seções afetadas;
> - adicionar/remover/mover strings da UI ou criar sistema de i18n → **seção 11 (Tradução)**.
>
> **Não finalize a tarefa com este documento desatualizado em relação ao código.**

---

## 1. Visão geral

**Mamaco Notes** é um app de anotações digitais com suporte a caneta (estilo Samsung
Notes) para **Windows e Linux (desktop Electron)**, **navegador (PWA)** e **Android
(Capacitor)**. O usuário cria cadernos (notebooks) e pastas, desenha/edita traços com
caneta, marcador, borracha, insere texto, imagens e PDFs, e pode sincronizar tudo com um
servidor **WebDAV** (Nextcloud, ownCloud, Koofr etc.).

O frontend é **React + TypeScript + Vite**. O desenho acontece em **Canvas 2D** com um
motor próprio (`PageCanvas`). Os dados são persistidos em **IndexedDB** (com backup
opcional em disco via Electron ou File System Access API). O estado global usa
**Zustand**. Toda a UI está em português (pt-BR).

---

## 2. Stack tecnológico

| Camada | Tecnologia | Onde |
|---|---|---|
| UI | React 18 + TypeScript | `src/components/*`, `src/App.tsx` |
| Build / dev server | Vite 6 | `vite.config.ts` |
| Estado global | Zustand | `src/store.ts`, `src/uiStore.ts`, `src/textStore.ts` |
| Persistência local | IndexedDB | `src/db.ts` |
| Renderização de desenho | Canvas 2D (motor próprio) | `src/renderer/canvas.ts` |
| PDF | `pdfjs-dist` | `src/utils/pdf.ts` |
| Desktop | Electron | `electron/main.cjs`, `electron/preload.cjs` |
| Android | Capacitor | `capacitor.config.ts` |
| PWA | `vite-plugin-pwa` | `vite.config.ts` |
| Empacotamento | electron-builder | `package.json` → `build` |

---

## 3. Pontos de entrada e plataformas

O app roda em 4 ambientes e detecta cada um na inicialização:

| Plataforma | Detecção | Entry point |
|---|---|---|
| Web / PWA | Ausência de `window.inkfolioDesktop` e `window.Capacitor` | `index.html` → `src/main.tsx` |
| Desktop (Electron) | `window.inkfolioDesktop` existe | `electron/main.cjs` carrega `index.html` |
| Android (Capacitor) | `window.Capacitor` existe | `capacitor.config.ts` + `dist/` |

Fluxo de inicialização:

1. `index.html` → `src/main.tsx` — registra o service worker do PWA (somente web),
   monta `<App />`.
2. `src/App.tsx` — chama `useAppStore.init()`; quando termina, se o cloud sync está
   habilitado com auto-sync, dispara `syncNow()`. Registra atalhos globais, listeners
   de eventos `ink:*` e o listener do botão de voltar (Capacitor, via `@capacitor/app`,
   que re-despacha `ink:esc`).
3. `src/store.ts init()` — carrega pastas, cadernos, configurações e modelos do
   IndexedDB (`db.ts`); cria um caderno inicial se não houver nenhum.

---

## 4. Mapa de arquivos por diretório

### Raiz

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | Scripts (dev, build desktop/win/linux, android), dependências, config do electron-builder |
| `vite.config.ts` | Plugins React/PWA, `base: './'`, dev server (porta 5173, `allowedHosts` para preview) |
| `tsconfig.json` | Config TypeScript (strict) |
| `index.html` | HTML base; carrega `src/main.tsx` |
| `capacitor.config.ts` | Config do Capacitor (Android) |
| `.gitignore` | Arquivos ignorados |
| `server2.mjs` | Arquivo vazio (resquício) |

### `src/` — código da aplicação (o núcleo)

| Arquivo | Responsabilidade |
|---|---|
| `src/main.tsx` | Bootstrap React + registro PWA |
| `src/App.tsx` | Componente raiz; composição da tela (TopBar, Sidebar, PageList, Editor, Toolbar, Modals); init + auto-sync; tecla Escape → `ink:esc`; botão de voltar do Android (Capacitor `@capacitor/app`) → `ink:esc` |
| `src/types.ts` | **Todos os tipos de dados** do domínio + `DEFAULT_SETTINGS` + `DEFAULT_SHORTCUTS` + factories (`makePage`, `makeNotebook`, `makeFolder`, `makeLayer`, `makeTextElement`, `uid`, `newId`) + helpers de camadas (`normalizePage`, `getActiveLayer`) |
| `src/db.ts` | **Camada de persistência IndexedDB** (object stores: `folders`, `notebooks`, `settings`, `cloudSync`, `templates`); migração de versão preenche o campo `order` ausente de pastas/cadernos antigos e converte páginas antigas (arrays planos) para o modelo de camadas (`migrateLayers`) |
| `src/store.ts` | **Store principal (Zustand)**: todo CRUD de cadernos/pastas/páginas/modelos, ações de camadas (adicionar/renomear/duplicar/excluir/reordenar/visibilidade/opacidade/lock/ativo/merge), undo/redo, clipboard, sync, persistência |
| `src/uiStore.ts` | Store de modais (`openModal`, `modalData`, `open`, `close`) |
| `src/textStore.ts` | Estado de edição de texto (draft, seleção, rotação) |
| `src/styles.css` | Todo o CSS do app |

#### `src/components/` — componentes React

| Arquivo | Responsabilidade |
|---|---|
| `TopBar.tsx` | Barra superior: toggles de sidebar/página (sempre visíveis; se o painel estiver oculto por `settings.hideSidebar`/`hidePageList`, o toggle o reexibe), título do caderno (renomeável), botões Imagem/PDF/Página/Exportar/Sincronizar/Configurações/tela cheia |
| `Sidebar.tsx` | Árvore de pastas/cadernos, menu de contexto, **reordenação e movimento por arrastar** (DnD custom via Pointer Events, funciona com mouse e touch; arrastar sobre uma pasta move para dentro dela; indicador de posição de inserção; autoscroll), **seleção múltipla** (CTRL/Meta clique alterna, SHIFT clique seleciona faixa entre o item âncora e o clicado, **toque longo no touch alterna a seleção**; barra de seleção com copiar/recortar/colar/duplicar/excluir; nº de páginas ocultável via `settings.hidePageCount`), barra redimensionável (handle `sidebar-resizer`, largura persistida em `settings.sidebarWidth`, limite 160–min(520, 50% da janela)); menu de contexto "…" fecha ao clicar fora (listener global de `pointerdown`) |
| `PageList.tsx` | Preview de páginas (thumbnails), busca por número, modo de visualização (V/H/S), drag-drop, menu por página, seleção múltipla de páginas (CTRL clique alterna, SHIFT clique seleciona faixa entre a âncora e a clicada; barra de seleção com duplicar/exportar PDF/girar/excluir) |
| `Editor.tsx` | **Maior componente (~2900 linhas)**: canvas de edição, zoom/pan, desenho, borracha, seleção, texto inline, gestos de pointer (incluindo toque duplo com 2 dedos = Desfazer, 3 dedos = Refazer e 2 dedos + rotação = girar a página), todos os drags |
| `Toolbar.tsx` | Barra de ferramentas lateral: caneta/marcador/borracha/texto/selecionar/mover/rotação, undo/redo, painéis de configuração por ferramenta |
| `LayersPanel.tsx` | Painel de camadas (lateral direita): lista de camadas da página atual (base→topo invertida na UI), seleção única/múltipla (CTRL/SHIFT e toque longo), reordenação por arrastar, renomear inline, alternar visibilidade/bloqueio, opacidade, adicionar/duplicar/excluir/mesclar camadas; rodapé fixo com a cor de fundo da página |
| `Modals.tsx` | **Todos os modais**: novo caderno, página, modelo, importar imagem/PDF, exportar, configurações, nuvem, mover/copiar, cor de fundo, conflitos de sync, prompt, confirmação |

#### `src/renderer/` — motor de desenho (Canvas)

| Arquivo | Responsabilidade |
|---|---|
| `canvas.ts` | Classe `PageCanvas`: renderiza páginas (contínuo/separado), camadas (visibilidade/opacidade), traços, imagens, textos, PDF, templates, seleção; conversão de coordenadas; hit tests |
| `drawUtils.ts` | Funções puras de desenho reutilizadas por thumbnail/export: `drawTemplate`, `drawLayer`, `drawStroke`, `drawTextOnCanvas` |
| `thumbnail.ts` | Gera miniaturas das páginas (usado no PageList e nos modelos personalizados) |

#### `src/utils/` — lógica de apoio

| Arquivo | Responsabilidade |
|---|---|
| `layout.ts` | Cálculo de offsets/posição das páginas em modo contínuo (vertical/horizontal), `pageVisualRect`, `pageUnderPoint` |
| `drawText.ts` | Medição e desenho de elementos de texto (horizontal/vertical, marcadores, sublinhado/riscado) |
| `export.ts` | Renderização da página em canvas e exportação PNG/PDF (gera PDF simples sem biblioteca externa) |
| `pdf.ts` | Renderização de arquivos PDF em imagens via `pdfjs-dist` (`renderPdfPages`) |
| `webdav.ts` | Transporte WebDAV (fetch PROPFIND/MKCOL/PUT/DELETE), suporte especial Koofr, `makeTransport` |
| `sync.ts` | **Algoritmo de sincronização bidirecional** (merge, conflitos, tombstone, migração) |
| `backup.ts` | Exportar/importar backup JSON completo (pastas, cadernos e configurações; sanitiza `saveDirectory`/handle) |
| `localSave.ts` | Backup automático para disco (Electron) ou diretório do navegador (File System Access), no mesmo formato do backup manual (inclui configurações) |
| `imageErase.ts` | Borracha em imagens: sessão de apagar em canvas offscreen e re-encode ao final |
| `colors.ts` | Paleta de cores e helpers de conversão HEX/RGB |
| `fonts.ts` | Lista de fontes do sistema (Local Font Access) com fallback |
| `shortcuts.ts` | Normalização de teclas, busca de atalho por ação, rótulos pt-BR |
| `fullscreen.ts` | Toggle de tela cheia |

#### `src/i18n/` — sistema de tradução

| Arquivo | Responsabilidade |
|---|---|
| `languages.ts` | Tipo `Language` (`'pt-BR' \| 'en'`), `SUPPORTED_LANGUAGES` (opções do seletor), `detectLanguage()` (auto-detect via `navigator.language`) |
| `ptBR.ts` | Dicionário pt-BR (`ptBRMessages`) — fonte de verdade, texto completo |
| `en.ts` | Dicionário inglês (`enMessages`) — mesmo conjunto de chaves |
| `index.ts` | Estado corrente, `t()` (com interpolação `{{param}}` e fallback en → pt-BR → chave), `setLanguage()`, `getLanguage()`, `useI18n()` (re-render via `useSyncExternalStore`), `applyDocumentLanguage()` (title + `<html lang>`) |

#### `src/hooks/`

| Arquivo | Responsabilidade |
|---|---|
| `useShortcuts.ts` | `initGlobalShortcuts()` — mapa atalho → ação global; `useEditorShortcuts()` |
| `useIsMobile.ts` | Detecção mobile (media query `(max-width:1024px) and (pointer:coarse)`) |

### `electron/` — desktop

| Arquivo | Responsabilidade |
|---|---|
| `main.cjs` | Processo principal: janela, menu, IPC handlers (`pick-directory`, `write-file`, `read-file`, `save-file`, `open-file`) |
| `preload.cjs` | Bridge `window.inkfolioDesktop` (contextIsolation) |

### Outros

| Caminho | Responsabilidade |
|---|---|
| `public/` | Ícones estáticos do PWA (favicon, apple-touch-icon, pwa-192/512, maskable) |
| `build-resources/` | Ícones do empacotamento desktop (icon.ico, icon.png) |
| `docs/superpowers/specs/` | Documentos de design aprovados (sync bidirecional; camadas) |
| `docs/superpowers/plans/` | Planos de implementação (sync bidirecional; camadas) |
| `server2.mjs` | Arquivo vazio (resquício) |

---

## 5. Arquitetura de dados e estado

### 5.1 Modelo de dados (definições em `src/types.ts`)

Hierarquia: **Folder** → **Notebook** → **Page** → **Layer** → (Stroke | ImageElement | TextElement) + PdfBackground (fundo da página, fora das camadas)

- `Folder { id, name, parentId, createdAt, order? }` — pastas aninhadas; `order` é a posição entre os irmãos do mesmo `parentId` (usado na reordenação por arrastar).
- `Notebook { id, name, folderId, pages, createdAt, updatedAt, order? }` — caderno; `order` é a posição entre os cadernos do mesmo `folderId` (usado na reordenação por arrastar).
- `Page { id, template, width, height, rotation, backgroundColor, layers, activeLayerId, pdf?, createdAt, updatedAt }` — o conteúdo editável fica todo nas **camadas** (`layers`); `activeLayerId` persiste a camada ativa (fallback para a última do array se nulo/inexistente). Os antigos arrays planos `strokes`/`images`/`texts` foram **removidos**.
- `Layer { id, name, visible, opacity, locked, strokes, images, texts }` — camada de conteúdo. Ordem do array `layers`: **índice 0 = base** (desenhada primeiro), **último = topo**. Dentro de cada camada mantém-se a ordem de sub-desenho **imagens → textos → traços**. Uma camada travada (`locked: true`) não recebe conteúdo nem é editável no canvas (desenho/borracha/seleção/mover), mas continua podendo ser renomeada, reordenada, duplicada, excluída, ocultada, ter opacidade ajustada, tornar-se ativa e participar de um merge.
- `Stroke { id, kind(pen|highlighter), color, size, points[] }` — traço com pressão.
- `ImageElement { id, name, dataUrl, x, y, width, height, rotation }`.
- `TextElement { id, text, x, y, width, rotation, fontSize, fontFamily, bold, italic, underline, strikethrough, color, backgroundColor, align, marker, direction, createdAt }`.
- `PdfBackground { dataUrl, name, pageNumber }` — PDF usado como fundo da página (fica **no nível da página**, abaixo de todas as camadas; não é uma `Layer`).
- `AppSettings` — todas as configurações (cor/tamanho da caneta, eraser, modos, atalhos, `cloud`, ocultar barra superior/ferramentas via `hideTopBar`/`hideToolbar`, ocultar barra de cadernos/preview de páginas via `hideSidebar`/`hidePageList`, ocultar nº de páginas do caderno via `hidePageCount`, ocultar o cursor da ferramenta sobre a página via `hideToolCursor`, seleção apenas da parte delimitada via `selectDelimitedOnly`, largura da barra de cadernos via `sidebarWidth`).
- `CloudSettings` / `CloudSyncState` / `SyncManifest` / `SyncConflictItem` — dados do sync.

> Sempre que precisar alterar o formato de um dado persistido, comece por `src/types.ts`
> e depois verifique a normalização em `src/store.ts` (funções `applySyncChanges`,
> `init`, `replaceAllData`) e em `src/db.ts`.
>
> **Camadas**: `makePage` cria uma página com 1 camada padrão "Camada 1"
> (`visible: true`, `opacity: 1`, `locked: false`). `normalizePage(page)` (função pura em
> `types.ts`) converte páginas legadas/parciais: se `layers` estiver ausente/vazio, cria 1
> camada a partir dos arrays planos antigos; normaliza cada camada defensivamente; valida
> `activeLayerId` (fallback última camada) e **remove** os campos planos legados do
> resultado. `getActiveLayer(page)` resolve a camada ativa (ou a última).

### 5.2 Persistência (IndexedDB) — `src/db.ts`

Banco `mamaco-notes`, versão **5**, com object stores:

| Store | Conteúdo | Chave |
|---|---|---|
| `folders` | `Folder[]` | `id` |
| `notebooks` | `Notebook[]` (JSON completo, inclui páginas e desenhos) | `id` |
| `settings` | 1 registro `{ id:'main', ...AppSettings }` | `id` |
| `cloudSync` | 1 registro `CloudSyncState` | `id` |
| `templates` | `PageTemplate[]` (modelos personalizados) | `id` |

Toda escrita em dados no app passa por `store.ts`, que chama `db.*` e depois
`scheduleLocalBackup()` (backup em disco/diretório).

> **Migração 3 → 4**: ao abrir o banco na versão nova, `openDb()` executa
> `migrateOrders()` (idempotente) que preenche `order` em pastas/cadernos antigos sem o
> campo — por grupo de `parentId`/`folderId`, ordenando pastas por `createdAt` (asc) e
> cadernos por `updatedAt` (desc); registros que já têm `order` são preservados e os sem
> `order` recebem valores posteriores ao maior existente. A normalização em memória
> continua existindo em `store.ts` (`fillFolderOrder`/`fillNotebookOrder`) para dados
> vindos de sync/backup.
>
> **Migração 4 → 5 (camadas)**: além de `migrateOrders`, `openDb()` executa
> `migrateLayers()` (idempotente): percorre a object store `notebooks` e reescreve cada
> página com `normalizePage` — páginas antigas com arrays planos ganham 1 camada única com
> o conteúdo preservado; páginas já com `layers` não são alteradas. Dados vindos de
> sync/backup também são normalizados na leitura (`store.ts`/`sync.ts`), então o
> `SyncManifest` não mudou de versão.

### 5.3 Stores (Zustand)

- **`useAppStore`** (`src/store.ts`) — estado global principal:
  - Dados: `folders`, `notebooks`, `templates`, `settings`, `dataVersion` (incrementado a
    cada persistência; usado para re-render e auto-sync).
  - Seleção/UI: `selectedFolderId`, `selectedNotebookId`, `selectedIds`, `currentPageIndex`,
    `tool`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`.
  - Ações CRUD: `createNotebook`, `addPage`, `updatePage`, `deleteNotebook`, `moveFolder`,
    `reorderFolder`, `reorderNotebook`, `duplicateFolder`, etc.
  - Desfazer/refazer: `pushUndo`, `undo`, `redo` (pilhas internas, snapshots de página,
    máx. 60 entradas).
  - Nuvem: `syncNow()`, `resolveConflicts()`.
  - Persistência: `persistNotebook`, `updateNotebookStorage`, `saveSettings`.
  - **Auto-sync**: `useAppStore.subscribe` observa `dataVersion` e dispara `syncNow()` com
    debounce de 20s (guardas `syncRunning`/`syncQueued`).
  - **Restauração de sessão**: um segundo `useAppStore.subscribe` salva no `localStorage`
    (chave `mamaco-notes.last-session`) o par `{ notebookId, pageId }` sempre que o caderno
    ou a página corrente mudam; `init()` usa esse registro para reabrir a última nota/página
    aberta (com fallback para nada selecionado quando o registro não existe ou o caderno foi
    excluído).
- **`useUiStore`** (`src/uiStore.ts`) — qual modal está aberto + dados do modal.
- **`useTextStore`** (`src/textStore.ts`) — rascunho de texto, posição/rotação do draft,
  texto selecionado, modo de edição.

### 5.4 Fluxo de dados típico

```
Toolbar/Editor/Modals/Sidebar
        │  (chama ação da store)
        ▼
useAppStore (store.ts) — muta o estado + incrementa dataVersion
        │
        ▼
db.ts (IndexedDB)  ──►  scheduleLocalBackup()  ──►  localSave.ts (disco)
        │
        ▼
useAppStore.subscribe (auto-sync)  ──►  syncNow()  ──►  webdav.ts + sync.ts (nuvem)
```

### 5.5 Contratos das stores (interface pública)

> **Contrato** = a interface pública de uma store: o estado que ela expõe, as ações que
> podem ser chamadas e as garantias que ela mantém. Corresponde à declaração de interface
> no topo de cada arquivo (`interface AppState`, `interface UiState`, `interface
> TextUiState`). Quem lê o contrato sabe o que pode consumir sem ler a implementação.
>
> Para **adicionar um campo ou ação nova**, altere a interface + a implementação — os
> componentes dependem só do contrato, então a implementação interna pode ser reescrita
> sem quebrar os consumidores. **Qualquer mudança aqui exige atualizar este documento.**

#### `useAppStore` (`src/store.ts:189`) — store principal

| Grupo | Contrato |
|---|---|
| **Dados** | `loaded: boolean`, `folders: Folder[]`, `notebooks: Notebook[]`, `templates: PageTemplate[]`, `settings: AppSettings`, `dataVersion: number` |
| **Seleção/UI** | `selectedFolderId`, `selectedNotebookId`, `selectedIds: string[]`, `selectedPageIndices: number[]`, `clipboard: { ids, cut } \| null`, `currentPageIndex`, `tool: ToolKind`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`, `canUndo`, `canRedo` |
| **Bootstrap** | `init(): Promise<void>` |
| **Navegação/seleção** | `selectFolder(id)`, `selectNotebook(id)`, `selectPage(index)`, `setTool(tool)`, `setRotationOpen(open)`, `toggleSidebar()`, `togglePageList()`, `toggleLayers()`, `setSidebarOpen(open)`, `setPageListOpen(open)`, `setLayersOpen(open)`, `toggleSearch()` |
| **Edição de seleção** | `toggleSelect(id)`, `clearSelection()`, `setSelectedIds(ids)`, `copySelected()`, `cutSelected()`, `pasteClipboard()`, `duplicateSelected()`, `deleteSelected(scope?)` |
| **Seleção de páginas** | `selectedPageIndices`, `toggleSelectPage(index)`, `setPageSelection(indices)`, `clearPageSelection()`, `duplicateSelectedPages()`, `deleteSelectedPages()`, `rotateSelectedPagesBy(delta)` |
| **Pastas** | `addFolder(name, parentId?)`, `deleteFolder(id, scope?)`, `renameFolder(id, name)`, `moveFolder(id, newParentId)`, `reorderFolder(id, parentId, beforeId)`, `duplicateFolder(id)`, `copyFolder(id, targetParentId)` |
| **Cadernos** | `createNotebook(name, folderId, template)`, `createNotebookFromTemplate(...)`, `deleteNotebook(id, scope?)`, `moveNotebook(id, folderId)`, `reorderNotebook(id, folderId, beforeId)`, `copyNotebook(id, folderId)`, `duplicateNotebook(id)`, `updateNotebook(notebook)` |
| **Páginas** | `addPage(template)`, `addPageAfter(index, template)`, `duplicatePage(index)`, `deletePage(index)`, `movePage(from, to)`, `rotatePage(index)`, `rotatePageBy(index, delta)`, `updatePage(index, patch: Partial<Page>)` |
| **Camadas** | `addLayer()`, `renameLayer(index, name)`, `duplicateLayer(index)`, `deleteLayer(index)`, `moveLayer(from, to)`, `setLayerVisible(index, visible)`, `setLayerOpacity(index, opacity)` (0..1), `setLayerLocked(index, locked)`, `setActiveLayer(id)`, `mergeSelectedLayers(indices)` |
| **Configuração** | `setSettings(patch)`, `setShortcut(action, value)`, `setCloud(patch)` |
| **Nuvem** | `syncNow(): Promise<SyncResult \| null>`, `resolveConflicts(choices: Record<string, ConflictChoice>)` |
| **Persistência/undo** | `persistNotebook(notebook)`, `pushUndo()`, `undo()`, `redo()` |
| **Importação/modelos** | `addImageToPage(dataUrl, name, center?)`, `addPdfToPage(dataUrl, name)`, `importPdfNotebook(...)`, `addTemplate(name, pages)`, `deleteTemplate(id)`, `addPagesFromTemplate(template)`, `applyTemplateToPage(index, template)`, `replaceAllData(folders, notebooks, settings?)` |

**Garantias**: toda ação de dados grava no IndexedDB (`db.ts`), incrementa `dataVersion`
(dispara re-render e o auto-sync) e agenda o backup local (`scheduleLocalBackup`). As
operações de página/caderno agem sobre o notebook/índice selecionado. Undo/redo usam
pilhas internas de snapshots de página (máx. 60). Pastas e cadernos são sempre ordenados
por `order` (`sortFoldersByOrder`/`sortNotebooksByOrder`); `reorderFolder`/`reorderNotebook`
recalculam `order` dos irmãos dentro do mesmo nível (`parentId`/`folderId`) e
`moveFolder`/`moveNotebook` delegam a `reorder*` movendo para o fim do destino. Dados
antigos sem `order` (sync/backup) são normalizados por `fillFolderOrder`/`fillNotebookOrder`.

**Garantias das camadas**: toda ação de camada resolve o notebook selecionado + página
atual, chama `pushUndo()`, muta `page.layers`/`page.activeLayerId`, atualiza
`page.updatedAt` e persiste via `updateNotebookStorage`. Ações no-padrão: sem página ou com
0 camadas (todas), `addLayer`/`duplicateLayer`/`mergeSelectedLayers`/`setActiveLayer`
quando a página está travada **não** são bloqueados (operam na estrutura). `deleteLayer`
é **bloqueado** com `layers.length <= 1`; ao excluir, a ativa passa para a camada mais
próxima (preferindo a de baixo). `mergeSelectedLayers` exige ≥ 2 índices: une as camadas
selecionadas em ordem base→topo, o resultado ocupa a posição da mais acima (com
`name`/`visible`/`opacity` dela), fica **destravado** (`locked: false`) e vira a ativa;
camadas não selecionadas preservam a ordem relativa. `addImageToPage` resolve a camada
ativa e **aborta** se ela estiver travada. As ações de camada incrementam `dataVersion`
(re-render do Editor e do `LayersPanel`) — não usam eventos `ink:*`.

#### `useUiStore` (`src/uiStore.ts:22`) — modais

| Campo/Ação | Tipo |
|---|---|
| `openModal` | `ModalName \| null` (conjunto fechado de 17 valores, listados no topo do arquivo) |
| `modalData` | `Record<string, unknown>` (payload do modal aberto) |
| `open(name, data?)` | Abre o modal e guarda o payload |
| `close()` | Fecha o modal e zera `modalData` |

**Garantias**: existe **um único modal aberto por vez**; `modalData` carrega o payload
(ex.: a pergunta/resposta do `prompt`).

#### `useTextStore` (`src/textStore.ts:3`) — edição de texto

| Campo/Ação | Tipo |
|---|---|
| `draft` | `string` (rascunho do texto sendo digitado) |
| `draftPos` | `{ x, y } \| null` (posição do draft na página) |
| `draftRotation` | `number` (rotação do draft) |
| `selectedTextId` | `string \| null` |
| `editingExisting` | `boolean` (true quando editando um texto existente) |
| `setDraft(text)`, `setDraftPos(pos)`, `setDraftRotation(rot)`, `selectText(id)`, `setEditingExisting(editing)` | setters individuais |
| `reset()` | Zera todo o estado de uma vez |

**Garantias**: `reset()` limpa tudo — usado ao confirmar/cancelar a edição, então o
`Editor` pode chamá-lo confiando que nenhum estado de rascunho sobrevive.

---

## 6. Motor de desenho (renderer)

O `Editor.tsx` instancia **uma** `PageCanvas` (`src/renderer/canvas.ts`) sobre um
`<canvas>`. Pontos-chave:

- **Renderização**: `render()` → `renderSinglePage()` (modo `separate`) ou
  `renderContinuous()` (vertical/horizontal). O fundo/template e o PDF são desenhados no
  **nível da página** (abaixo de tudo). Depois `renderPageContent()` itera `page.layers` em
  ordem (base → topo) e, para cada camada **visível**, aplica `ctx.globalAlpha =
  layer.opacity` e desenha, na ordem, as **imagens → textos → traços** daquela camada
  (`ctx.save`/`restore` por camada). O traço atual (`currentStroke`) é desenhado por cima,
  na página corrente. As funções de seleção/hit-test (`selectionBounds`, `drawStrokeBoxes`,
  `drawImageBoxes`, caixas de texto) iteram os arrays da **camada ativa**.
- **Coordenadas**: conversões `toPageCoords` / `toDocumentCoords` / `toPageCoordsAt` /
  `toScreenCoords` (aplica pan, zoom, offset da página e rotação da página).
- **Interação**: `Editor.tsx` implementa todos os gestos via handlers de `PointerEvent`
  (`onPointerDown/Move/Up`), um `dragRef` com `kind` que identifica a operação:
  `pan \| draw \| erase \| select-move \| select-resize \| select-rotate \| region-draw \|
  region-move \| text-rotate \| text-resize \| page-rotate \| group-resize \| group-rotate`.
- **Multi-toque (celular)**: `Editor.tsx` rastreia os ponteiros ativos em
  `activePointersRef` (atualizado em `onPointerDown`/`onPointerMove`). Um segundo dedo
  não interrompe um traço imediatamente: só ativa o gesto de mover/pinça depois de se
  deslocar mais de `TWO_FINGER_THRESHOLD` (14px), evitando que a palma da mão anule um
  desenho. Com 2 dedos confirmados, `dragRef` vira `pan` com `multiTouch: true`: o
  afastamento/aproximação dos dedos aplica zoom (`applyZoomAt`, fator = razão das
  distâncias) em torno do ponto médio e o deslocamento do ponto médio move a tela.
  Estado dos gestos: `pinchRef` (distância/ponto médio anteriores) e
  `pendingTwoFingerRef` (dedo candidato a confirmar o gesto). O canvas faz
  `preventDefault` no `pointerdown` de toque/caneta e só usa `setPointerCapture`
  explícito para mouse (toque/caneta usam captura implícita do navegador).
  - **Toque duplo com 2 dedos = Desfazer**: um "toque" de 2 dedos é reconhecido quando
    os dois ponteiros sobem sem deslocamento relevante (`pointerDownPosRef` guarda a
    posição inicial de cada dedo; se o primeiro dedo já se moveu mais de
    `TWO_FINGER_THRESHOLD`, o candidato é descartado para não confundir com palma da
    mão) e o tempo entre o segundo dedo descer e todos subirem é ≤
    `TWO_FINGER_TAP_MAX_MS` (260ms). Dois desses toques com intervalo ≤
    `TWO_FINGER_DOUBLE_TAP_GAP_MS` (350ms) entre o fim de um e o fim do outro disparam
    `useAppStore.undo()` — o equivalente ao "Desfazer". O primeiro toque apenas arma o
    cronômetro; `lastTwoFingerTapAtRef` guarda o instante do último toque.
  - **Toque duplo com 3 dedos = Refazer**: espelha o gesto de 2 dedos, mas o candidato
    só é armado quando o terceiro ponteiro desce (`threeFingerDownAtRef`; zerado se um
    pan/pinça começa). Dois toques de 3 dedos nas mesmas janelas de tempo
    (`TWO_FINGER_TAP_MAX_MS` / `TWO_FINGER_DOUBLE_TAP_GAP_MS`) disparam
    `useAppStore.redo()`. `lastThreeFingerTapAtRef` guarda o instante do último toque.
  - **2 dedos + rotação = girar a página**: durante o pan/pinça de 2 dedos, a rotação do
    ângulo entre os dedos (`Math.atan2` da diferença de posições) é aplicada em
    `page.rotation` (graus), mantendo a convenção do gesto `page-rotate`
    (rotação no sentido horário na tela aumenta o ângulo). A base do ângulo e da rotação
    são capturadas em `drag.startAngle`/`drag.startRotation` quando o gesto se confirma
    (e recapturadas quando uma nova fase de multi-toque começa, evitando saltos).
    `pushUndo()` é chamado **uma única vez por gesto**, apenas quando a rotação começa a
    ser aplicada (flag `pinchRotationUndoPushedRef`), e a mudança é persistida via
    `schedulePersist()`.
  - **Rotações nunca empurram undo vazio**: `pushUndo()` é chamado **somente quando uma
    mudança real é aplicada** à página. Traços são empurrados no commit em `onPointerUp`
    (só se `stroke.points.length >= 2`); a borracha empurra apenas se
    `session.commit()` retornou elementos alterados (tanto no fim do gesto quanto no
    aborto por pan de 2 dedos); e tanto o gesto de rotação por 2 dedos quanto o
    `page-rotate` (seleção com rotação livre) empurram no primeiro movimento que muda o
    ângulo real (`|delta| > 1°`, flags `pinchRotationUndoPushedRef`/
    `pageRotateUndoPushedRef`). Isso evita entradas de undo idênticas à página atual —
    a causa raiz do "Desfazer de 2 dedos não faz nada e o Refazer pisca sem efeito".
- **Seleção**: estruturas `Set` de ids (`strokes`, `images`, `texts`) em `selectionRef`;
  regiões (retângulo/círculo/laço) em `selectionRegionRef`; clipboard interno de seleção.
  A seleção por região (`computeSelection` em `Editor.tsx`) testa, para imagens, centro e
  cantos rotacionados dentro da região **e também** a intersecção entre a borda da região e
  o contorno da imagem (`imageInRegion` + helpers `regionBoundaryIntersectsImage`/
  `regionPointInsideImage`), de modo que uma região que cobre apenas parte de uma imagem a
  seleciona. Em **qualquer modo de seleção**, o clique sobre um handle de imagem
  (`hitTestImageHandles` em `canvas.ts`) inicia resize/rotate (`select-resize`/
  `select-rotate`), inclusive dentro dos modos de região. A região de **círculo** é definida
  por dois pontos que são extremidades de um diâmetro (centro = ponto médio, raio = metade
  da distância) — `circleCenterRadius` em `Editor.tsx` —, então o ponto de clique fica na
  borda e o círculo cresce na direção do arrasto.
  - **Seleção apenas da parte delimitada** (`settings.selectDelimitedOnly`, checkbox no
    `SelectPanel`): quando ativa, `finalizeRegion` (`Editor.tsx`) chama
    `computeDelimitedSelection`, que **divide** os traços parcialmente cobertos pela região
    (`splitStrokeByRegion`, trechos dentro viram traços novos selecionados e trechos fora
    permanecem não selecionados) e **recorta (crop)** as imagens parcialmente cobertas
    (`cropImageToRegion`, async — a imagem é substituída por duas `ImageElement`s: a parte
    fora da região permanece na página não selecionada e a parte delimitada vira um recorte
    novo selecionado, respeitando rotação). Textos mantêm o comportamento atual (bloco
    inteiro). A página é modificada no momento da seleção (reversível com Desfazer);
    `cropVersionRef` invalida conclusões assíncronas obsoletas. Antes da primeira mutação,
    um snapshot da página é guardado em `delimitedSnapshotRef` (`Editor.tsx`); **a tecla
    Esc (`onKey`) restaura esse snapshot** — traços, imagens e textos voltam ao formato
    original (o recorte é desfeito). O snapshot é limpo ao trocar de ferramenta, mudar de
    página, iniciar nova seleção ou executar qualquer ação que use `pushUndo`.
- **Borracha em imagens**: `ImageEraseSession` (`utils/imageErase.ts`) mantém canvases
  offscreen e só re-encodeia no fim do gesto.
- **Texto**: edição inline com `<textarea>` sobreposto (`InlineTextInput`); commit via
  `commitDraftAt`/`commitInlineText`; formatação medida por `utils/drawText.ts`.
- **Miniaturas/exportação** não usam o `PageCanvas`; usam `renderer/drawUtils.ts`
  (funções puras) para desenhar a página de novo em outro canvas — `drawLayer` aplica
  `globalAlpha` da camada e desenha imagens→textos→traços, respeitando visibilidade e
  opacidade por camada (thumbnail e export carregam as imagens de cada camada para aplicar
  a opacidade correta).

---

## 7. Comunicação entre componentes (eventos `ink:*`)

O app usa `window.dispatchEvent(new CustomEvent(...))` para acoplar UI e canvas sem
passar por props. **Lista completa dos eventos** (em ordem alfabética) e onde são
disparados/ouvidos:

| Evento | Payload | Disparado por | Ouvido em |
|---|---|---|---|
| `ink:add-page` | — | atalho `addPage` (`useShortcuts.ts`) | `Editor.tsx` (re-dispara `ink:request-add-page`) |
| `ink:esc` | — | tecla Escape (`App.tsx`) e botão de voltar do Android (`App.tsx`, plugin `@capacitor/app`; no web não há listener) | `Sidebar.tsx` (fecha menu de contexto), `Toolbar.tsx` (fecha painel da ferramenta e painel de rotação), `PageList.tsx` (fecha menu da página), `Modals.tsx` (`ModalsHost` fecha o modal aberto — submenus do menu superior), `Editor.tsx` (limpa seleção no modo seleção e restaura o snapshot da seleção delimitada) |
| `ink:image-rotate` | `number` (graus) | `Toolbar.tsx` (painel Seleção) | `Editor.tsx` |
| `ink:image-selected` | `{ id }` | `Editor.tsx` | `Toolbar.tsx` (painel Seleção) |
| `ink:recenter` | — | atalho `recenter` | `Editor.tsx` |
| `ink:request-add-page` | — | `Editor.tsx` (`onAddPage`, re-dispatch do `ink:add-page`) | `App.tsx` (abre `addPagePicker`) |
| `ink:save` | — | atalho `save` | `App.tsx` (persiste o caderno atual) |
| `ink:selection-action` | `'copy'|'cut'|'paste'|'duplicate'|'delete'` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:selection-rotate` | `{ delta }` (graus) | `Toolbar.tsx` (painel Seleção) | `Editor.tsx` |
| `ink:text-commit-center` | — | (não disparado no código atual; só escutado) | `Editor.tsx` |
| `ink:text-delete` | — | `Toolbar.tsx` | `Editor.tsx` |
| `ink:text-rotate` | `{ id, degrees }` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:text-update` | `{ id, patch }` | `Toolbar.tsx` | `Editor.tsx` |
| `ink:zoom` | `1 | -1 | 0` | atalhos de zoom | `Editor.tsx` |

---

## 8. Sincronização WebDAV (nuvem)

Fluxo e arquivos envolvidos:

- **UI/configuração**: `Modals.tsx` → `SettingsModal` (aba "Nuvem") e `CloudSyncModal`.
- **Transporte HTTP**: `src/utils/webdav.ts` — `makeTransport(cloud)` retorna interface
  `Transport { ensureDirectory, listDirectory, uploadFile, downloadFile, deleteRemoteFile }`
  (PROPFIND/MKCOL/PUT/DELETE). Trata servidor **Koofr** de forma especial (cria pastas via
  API quando WebDAV não suporta MKCOL).
- **Algoritmo de merge**: `src/utils/sync.ts` — `runSync()` e `applyConflictChoices()`.
  Layout remoto: `manifest.json` + `notebooks/<id>.json` + `folders/folders.json`.
  Compara `local.updatedAt`, `remote.updatedAt` e `cloudSync.notebooks[id]` para decidir
  push/pull/delete/conflito. O hash de pastas (`hashFolders`) inclui `id`, `name`,
  `parentId` e `order`, então a **reordenação de pastas é sincronizada** como qualquer
  outra mudança de pastas.
- **Estado local de sync**: `db.ts` → `cloudSync` (`CloudSyncState`).
- **Orquestração**: `store.ts` → `syncNow()` (guard de reentrância + debounce), `resolveConflicts()`.
- **Design/plano detalhados**: `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md`
  e `docs/superpowers/plans/2026-08-17-sync-bidirecional-plan.md`.

---

## 9. Índice de busca de informação

> "Onde está o código que faz X?" — consulte a tabela abaixo.

### Ferramentas de desenho / edição

| Assunto | Arquivo(s) |
|---|---|
| Ferramentas da barra lateral (caneta, marcador, borracha, texto, seleção, mover) | `src/components/Toolbar.tsx` |
| Painel de opções de cada ferramenta (cor, espessura, modo) | `src/components/Toolbar.tsx` (`PenPanel`, `EraserPanel`, `SelectPanel`, `TextPanel`, `PanPanel`, `RotationPanel`). O painel abre ao tocar na ferramenta (fechado por padrão no início), fecha ao tocar fora da barra de ferramentas, ao trocar para Rotação ou com `Esc` (`ink:esc`) |
| Gestos de desenho no canvas (pointerdown/move/up) | `src/components/Editor.tsx` (`onPointerDown/Move/Up`) |
| Traços: desenho e pressão | `src/renderer/canvas.ts` (`beginStroke`, `extendStroke`, `tracePressurePolyline`) |
| Borracha de traços | `src/components/Editor.tsx` (`eraseAtPage`, `eraseSegment`) |
| Borracha de imagens | `src/utils/imageErase.ts` + `Editor.tsx` |
| Modos de seleção (clique/laço/círculo/retângulo) | `src/components/Toolbar.tsx` (`SelectPanel`) + `Editor.tsx` |
| Selecionar apenas a parte delimitada (dividir traço / recortar imagem) | `Toolbar.tsx` (`SelectPanel` → `settings.selectDelimitedOnly`) + `Editor.tsx` (`computeDelimitedSelection`, `splitStrokeByRegion`, `cropImageToRegion`) |
| Mover/redimensionar/rotacionar imagem selecionada | `Editor.tsx` (`select-move/resize/rotate`) + `canvas.ts` |
| Rotacionar seleção (passo ±15° via painel) | `Toolbar.tsx` (`SelectPanel`, evento `ink:selection-rotate`) + `Editor.tsx` (`rotateGroupBy`); o painel permite digitar os graus manualmente e um botão volta para 0° |
| Rotação de página (tela) | `Toolbar.tsx` (`RotationPanel`) + `Editor.tsx` (`page-rotate`) |
| Texto inline (digitação no lugar) | `Editor.tsx` (`InlineTextInput`, `commitInlineText`) |
| Formatação de texto (fonte, marcadores, direção) | `src/utils/drawText.ts` + `Toolbar.tsx` |
| Desfazer/refazer | `src/store.ts` (`pushUndo`, `undo`, `redo`); no toque, dois toques seguidos com 2 dedos no canvas equivalem ao Desfazer (`Editor.tsx`, `onPointerUp` → `useAppStore.undo()`); dois toques com 3 dedos = Refazer (`useAppStore.redo()`); `pushUndo` só é chamado quando o traço/borracha/rotação realmente altera a página |
| Camadas: modelo e helpers (normalização de páginas legadas) | `src/types.ts` (`Layer`, `makeLayer`, `normalizePage`, `getActiveLayer`) |
| Camadas: ações de estado (adicionar/renomear/duplicar/excluir/reordenar/visibilidade/opacidade/lock/ativo/merge) | `src/store.ts` (`addLayer`, `renameLayer`, `duplicateLayer`, `deleteLayer`, `moveLayer`, `setLayerVisible`, `setLayerOpacity`, `setLayerLocked`, `setActiveLayer`, `mergeSelectedLayers`) |

### Dados e persistência

| Assunto | Arquivo(s) |
|---|---|
| Tipos e defaults (settings, atalhos) | `src/types.ts` |
| CRUD de cadernos/pastas/páginas/modelos | `src/store.ts` |
| IndexedDB (leitura/escrita) | `src/db.ts` |
| Backup manual (exportar/importar JSON, inclui configurações) | `src/utils/backup.ts` + `Modals.tsx` (Settings) |
| Backup automático em disco | `src/utils/localSave.ts` |
| Restaurar tudo (importar backup) | `src/store.ts` (`replaceAllData`) |
| Contratos das stores (estado + ações, ver §5.5) | `src/store.ts` (`AppState`), `src/uiStore.ts` (`UiState`), `src/textStore.ts` (`TextUiState`) |

### Nuvem / sincronização

| Assunto | Arquivo(s) |
|---|---|
| Algoritmo de merge e conflitos | `src/utils/sync.ts` |
| Transporte WebDAV + Koofr | `src/utils/webdav.ts` |
| Estado local de sync (cloudSync) | `src/db.ts` + `src/types.ts` (`CloudSyncState`) |
| Orquestração (`syncNow`, `resolveConflicts`, auto-sync) | `src/store.ts` |
| Modal de sincronização / configuração de nuvem | `src/components/Modals.tsx` |
| Modal de conflitos | `src/components/Modals.tsx` (`SyncConflictModal`) |
| Trigger de sync ao abrir | `src/App.tsx` |
| Design document do sync | `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md` |

### Importação / exportação

| Assunto | Arquivo(s) |
|---|---|
| Importar imagem na página | `Modals.tsx` (`ImportImageModal`) + `store.ts` (`addImageToPage`) |
| Importar PDF na página atual (escolhe uma página do PDF) | `Modals.tsx` (`ImportPdfModal`) + `store.ts` (`addPage`, `persistNotebook`) |
| Importar PDF como novo caderno | `Modals.tsx` (`ImportPdfNoteModal`) + `store.ts` (`importPdfNotebook`) |
| Renderizar PDF → imagens | `src/utils/pdf.ts` |
| Exportar PNG | `src/utils/export.ts` (`exportPageAsPng`) |
| Exportar PDF | `src/utils/export.ts` (`exportPagesAsPdf`, `buildSimplePdf`) |
| Modelos personalizados (importar imagem/PDF como modelo, com escolha de tamanho da imagem; para PDF o usuário escolhe apenas uma das páginas) | `Modals.tsx` (`TemplatePicker`, `buildTemplatePages`, `buildPdfTemplatePage`, `chooseTemplateImageMode`) |
| Alterar modelo de página (inclui modelos importados) | `Modals.tsx` (`TemplateModal`) + `store.ts` (`updatePage`, `applyTemplateToPage`) |

### UI / layout / navegação

| Assunto | Arquivo(s) |
|---|---|
| Composição da tela | `src/App.tsx` |
| Ocultar barras / painéis | Configurações (aba Geral, `Modals.tsx` `SettingsModal`, seção Aparência) → `settings.hideTopBar`, `settings.hideToolbar`, `settings.hideSidebar`, `settings.hidePageList`; render condicional em `src/App.tsx`; toggles de sidebar/preview na `TopBar.tsx` sempre visíveis (o clique reexibe o painel quando oculto pelas configurações) e **um botão flutuante por barra oculta** em `App.tsx` (`.ui-restore-btn`): barra superior → centro superior (`top-center`, para não sobrepor a barra de ferramentas lateral), ferramentas → meio da borda direita (`right-center`), cadernos/preview → meio da borda esquerda (`left-center`, com `left-center-top`/`left-center-bottom` empilhados quando os dois estão ocultos) |
| Ocultar nº de páginas do caderno | Configurações (aba Geral, seção Aparência) → `settings.hidePageCount`; render condicional do `<span className="page-count">` em `src/components/Sidebar.tsx` |
| Áreas seguras do celular (status bar / notch / gestos) | `index.html` usa `viewport-fit=cover`; `src/styles.css` respeita `env(safe-area-inset-top)` na `.topbar` (altura/padding) e no botão flutuante `.ui-restore-btn.top-center`, e `env(safe-area-inset-bottom)` na `.toolbar` no modo mobile — evita que a barra superior fique coberta/inacessível em celulares com a barra de notificações oculta (edge-to-edge) |
| Barra superior | `src/components/TopBar.tsx` |
| Painel de camadas (lateral direita; botão "Camadas" na `TopBar` alterna `layersOpen`) | `src/components/LayersPanel.tsx` + `src/store.ts` (ações de camada) |
| Árvore de pastas/cadernos | `src/components/Sidebar.tsx` (tooltip customizado `.sidebar-name-tooltip` mostra o nome completo de cadernos/pastas ao passar o mouse; `.sidebar-item` dentro das linhas usa `flex: 1 1 auto; min-width: 0` e `.row-menu` com `z-index` para manter o botão "…" clicável mesmo com nomes longos; menu "…" fecha ao clicar fora via listener global de `pointerdown`; conteúdo rolável em `.sidebar-scroll`) |
| Reordenar pastas/cadernos por arrastar (reorder no mesmo nível + mover para dentro de pasta) | `src/components/Sidebar.tsx` (DnD custom via Pointer Events: `onItemPointerDown/Move/Up`, `computeSlot`, `updateDropPosition`, autoscroll, indicador `.sidebar-drop-indicator`, destaque `.drop-target`) + `src/store.ts` (`reorderFolder`/`reorderNotebook` recalculam `order` dos irmãos; `moveFolder`/`moveNotebook` movem para o destino) + campo `order` em `src/types.ts` |
| Seleção múltipla de pastas/cadernos (CTRL/SHIFT no PC, toque longo no touch) | `src/components/Sidebar.tsx` (`toggleSelect`, `selectRange`; timer de ~500ms no `pointerdown` de toque dispara `toggleSelect`; barra `.selection-bar`) + `src/store.ts` (`toggleSelect`, `clearSelection`, `selectedIds`) |
| Redimensionar a barra de cadernos | `src/components/Sidebar.tsx` (handle `.sidebar-resizer` na borda direita, arraste para aumentar/diminuir; largura salva em `settings.sidebarWidth` via `setSettings` no fim do arrasto; limite 160–min(520, 50% da janela); oculto em touch/`pointer: coarse`) |
| Preview de páginas (tamanho fixo das miniaturas, seleção múltipla com CTRL/SHIFT e barra de seleção) | `src/components/PageList.tsx` + `src/renderer/thumbnail.ts` (`.page-thumb-wrap` com `flex-shrink: 0` para não encolher com muitas páginas) |
| Modais (todos) | `src/components/Modals.tsx` + `src/uiStore.ts`; fecham com `Esc`/botão de voltar (evento `ink:esc` → `ModalsHost` chama `close()`; para `prompt`/`confirmDelete` resolve o resolver com `null`) |
| Tradução (i18n, dicionários, troca de idioma) | `src/i18n/` (`languages.ts`, `ptBR.ts`, `en.ts`, `index.ts`) + `settings.language` |
| CSS / estilos | `src/styles.css` |
| Detecção mobile | `src/hooks/useIsMobile.ts` |

### Plataformas

| Assunto | Arquivo(s) |
|---|---|
| Desktop Electron (janela, menu, IPC) | `electron/main.cjs` |
| Bridge `window.inkfolioDesktop` | `electron/preload.cjs` |
| Android / Capacitor | `capacitor.config.ts` |
| PWA manifest | `vite.config.ts` |
| Ícones | `public/`, `build-resources/` |

### Atalhos de teclado

| Assunto | Arquivo(s) |
|---|---|
| Defaults | `src/types.ts` (`DEFAULT_SHORTCUTS`) |
| Normalização/registro de atalhos | `src/hooks/useShortcuts.ts` |
| Rótulos e normalização de teclas | `src/utils/shortcuts.ts` |
| Atalhos de ocultar barras / rotação livre / modos de seleção (`toggleHideToolbar`, `toggleHideTopBar`, `toggleFreeRotate`, `selectClick`, `selectFree`, `selectCircle`, `selectRect`) | `src/types.ts` (`DEFAULT_SHORTCUTS`) + `src/hooks/useShortcuts.ts` |
| UI de configuração de atalhos (busca por nome, aviso de atalho duplicado com substituir/inverter/cancelar) | `Modals.tsx` (`SettingsModal` → aba "Atalhos") |

---

## 10. Convenções e padrões do código

- **Estado**: tudo que é compartilhado passa por Zustand stores; componentes leem com
  `useAppStore((s) => s.xxx)` e escrevem via ações da store (nunca mutando diretamente sem
  passar pela persistência).
- **Persistência**: toda alteração de dados persiste via `db.*` + `scheduleLocalBackup()`.
- **Comunicação UI ↔ canvas**: via `CustomEvent` (`ink:*`), nunca props profundas.
- **Canvas**: `Editor.tsx` é o dono do motor; `PageCanvas` só renderiza e faz hit tests.
- **Funções puras de desenho** (para thumbnail/export) vivem em `renderer/drawUtils.ts` e
  reutilizam `utils/drawText.ts`.
- **Idioma da UI**: pt-BR (textos de botões/modais em português) com suporte a inglês via
  `src/i18n/` (`t()` + `useI18n()`); strings novas entram nos dicionários `ptBR.ts`/`en.ts`.
- **ID de entidades**: `newId()` de `src/types.ts` (usa `crypto.randomUUID()` quando
  disponível e cai para `uid()` — timestamp base36 + aleatório — em contextos inseguros
  como acesso via IP/HTTP, onde `crypto.randomUUID` não existe). Não use
  `crypto.randomUUID()` diretamente no código.
- **Normalização de dados**: páginas vindas de sync/backup são normalizadas em
  `store.ts`/`sync.ts` via `normalizePage` (camadas, `backgroundColor ?? '#ffffff'`); a
  migração do IndexedDB usa o mesmo helper (`migrateLayers` em `db.ts`).
- **Typecheck**: `npm run typecheck` (ou `tsc --noEmit`).

---

## 11. Tradução do programa (i18n)

> **Estado atual**: o app tem sistema de i18n próprio em `src/i18n/` (sem dependência
> externa). Idiomas: **pt-BR** (fallback) e **en**. O idioma ativo vem de
> `settings.language` (IndexedDB), com auto-detect na primeira execução
> (`navigator.language`). O seletor "Idioma" no modal de Configurações (aba "Geral",
> `Modals.tsx`) troca a UI inteira em runtime sem recarregar.

### 11.1 Como o i18n funciona

- **Dicionários**: `src/i18n/ptBR.ts` (`ptBRMessages`) é a fonte de verdade; `src/i18n/en.ts`
  (`enMessages`) cobre o mesmo conjunto de chaves. Chaves **planas** com prefixo de área:
  `tool.*`, `topbar.*`, `layers.*`, `pageList.*`, `sidebar.*`, `editor.*`, `modal.*`,
  `shortcut.*`, `copySuffix`, `error.*`.
- **API**: `t(key, params?)` resolve no momento da chamada (fallback `en` → `pt-BR` → a
  própria chave); `useI18n()` (React) força re-render ao trocar de idioma via
  `useSyncExternalStore`; `setLanguage()` também aplica `applyDocumentLanguage()`
  (`<title>` + `<html lang>`) e avisa o Electron via `window.inkfolioDesktop.setLanguage`.
- **Integração**:
  - Componentes React (`Toolbar`, `Modals`, `Sidebar`, `TopBar`, `PageList`, `Editor`,
    `App`): `const { t } = useI18n()` e `t('chave')` — inclusive em `title`/`aria-label`/
    `placeholder` e na interpolação `{{param}}`.
  - `src/utils/shortcuts.ts`: `shortcutLabel(action)` → `t('shortcut.' + action)`.
  - `src/store.ts`: sufixo de duplicação via `t('copySuffix')`; `setSettings` com
    `patch.language` chama `setLanguage` antes de aplicar o estado; `init()` faz o
    auto-detect (`pt-BR` não alterado + navegador `en` → `setSettings({ language: 'en' })`)
    e alinha `<title>`/`lang` ao idioma salvo.
  - `src/utils/sync.ts` / `webdav.ts`: mensagens de erro/status via `t('error.*')`
    (módulos planos importam `t`; resolvido na exibição).
  - Electron: `electron/preload.cjs` expõe `setLanguage(lang)`; `electron/main.cjs` guarda
    `appLang` e reconstrói o menu/diálogos a partir de um dicionário local `menuMessages`
    (o processo principal não importa o TS do frontend).
- **Idiomas no seletor**: os nomes dos idiomas ("Português (Brasil)", "English") ficam no
  idioma nativo de cada um (padrão i18n) — **não** são traduzidos.

### 11.2 Onde estavam as strings de UI (mapa do código)

| Arquivo | O que contém | Exemplos de strings |
|---|---|---|
| `src/components/Toolbar.tsx` | Nomes de ferramentas, painéis, dicas, tooltips, títulos | "Caneta", "Marcador", "Borracha", "Texto", "Selecionar", "Mover", "Rotação", "Desfazer", "Refazer", "Modo de seleção", "Selecionar apenas a parte delimitada", "Ações", "Negrito", "Sublinhado", "Direção da escrita", "Código hexadecimal" |
| `src/components/Modals.tsx` | **Todos os modais**: títulos, labels, botões, dicas, placeholders, opções | "Configurações", "Nova página", "Exportar anotações", "Sincronização em nuvem", "Conflitos de sincronização", "Modelo da primeira página", "Português (Brasil)", "Testar conexão", "Também da nuvem", "Ocultar o cursor da ferramenta" (`modal.hideToolCursor` + `modal.hideToolCursorHint`), dicas de importação |
| `src/components/Sidebar.tsx` | Menus de contexto, prompts, confirmações, títulos de seção | "Meus Cadernos", "Sem pastas", "Nova pasta", "Renomear", "Copiar para pasta...", "Mover para pasta...", "Duplicar", "Excluir", "Excluir a nota ...?", "Arraste para redimensionar", "Arraste para reordenar. Em touch, toque longo seleciona vários itens." (`sidebar.dragHint`) |
| `src/components/TopBar.tsx` | Tooltips, título do app, placeholder | "Alternar barra lateral", "Mostrar/ocultar preview das páginas", "Camadas" (`topbar.toggleLayers`), "Ocultar a barra superior", "Ocultar a barra de ferramentas", "Mostrar a barra superior", "Mostrar a barra de ferramentas", "Mostrar a barra de cadernos", "Mostrar o preview de páginas", "Tela cheia (F11)", "Mamaco Notes", "Selecione ou crie um caderno" |
| `src/components/PageList.tsx` | Título, placeholder de busca, mensagens vazias, barra de seleção múltipla de páginas | "Páginas", "Ir para a página (nº)...", "Nenhuma página encontrada", "{{count}} página(s) selecionada(s)", "Limpar seleção de páginas", "Duplicar páginas selecionadas", "Excluir {{count}} página(s) selecionada(s)?" |
| `src/components/LayersPanel.tsx` | Título do painel, barra de ações (nova/duplicar/excluir/mesclar), slider de opacidade da camada ativa, rodapé "Fundo", tooltips de visibilidade/lock | "Camadas", "Adicionar camada", "Duplicar camada", "Excluir camada", "Mesclar camadas", "Mesclar {{count}} camadas", "Fundo", "Fundo da página", "Opacidade", "Renomear camada", "Camada {{n}}" (nomes padrão via `layers.layerN` quando o nome casa com `^Camada \d+$`), "Mostrar/ocultar camada", "Travar camada", "Destravar camada" |
| `src/components/Editor.tsx` | Placeholder do texto inline, tooltips de zoom | "Digite o texto...", "Diminuir zoom", "Redefinir zoom / recentralizar", "Recentralizar página" |
| `src/utils/shortcuts.ts` | Rótulos dos atalhos exibidos em Configurações (`shortcutLabel`) | "Caneta", "Borracha", "Desfazer", "Aumentar zoom", "Adicionar página", "Excluir página", "Tela cheia", etc. |
| `src/store.ts` | Sufixo de duplicação de itens | `t('copySuffix')` → `' (cópia)'` / `' (copy)'` |
| `src/utils/sync.ts` | Mensagens de erro do merge | `'caderno inválido'`, `'caderno remoto inválido'` |
| `src/utils/webdav.ts` | Mensagens de erro/status da conexão WebDAV | "Servidor Koofr não reconhecido.", "Conexão OK: ...", dica de URL do Koofr |
| `electron/main.cjs` | Menu da janela, títulos de diálogos, filtros de arquivo, logs | "Arquivo", "Editar", "Exibir", "Sair", "Desfazer", "Refazer", "Recortar", "Copiar", "Colar", "Selecionar tudo", "Selecionar diretório de anotações", "Backup Mamaco Notes", "JSON" |

### 11.3 Configuração e metadados por plataforma

| Arquivo | O que traduzir |
|---|---|
| `index.html` | Atributo `<html lang="pt-BR">` e `<title>Mamaco Notes - Anotações</title>` — valor **inicial**; o runtime corrige via `applyDocumentLanguage()` |
| `vite.config.ts` | Manifest PWA: `name`, `short_name`, `description`, `lang: 'pt-BR'` |
| `capacitor.config.ts` | `appName` (nome exibido do app no Android) |
| `package.json` | `description` (metadados) e `productName` no bloco `build` (nome no instalador/desktop) |

> Manifest PWA, `appName` do Capacitor e `productName` são **estáticos** (valor de
> instalação) — não trocam em runtime; o idioma dentro do app é controlado pelo seletor.

### 11.4 O que NÃO precisa traduzir

- `src/styles.css` — apenas ícones/símbolos via `content:` (▤, ✎, ↻, ☁ etc.), sem texto.
- `public/`, `build-resources/` — ícones e assets.
- Identificadores usados no código (ex.: `'copy'`, `'cut'`, nomes de eventos `ink:*`,
  `TemplateId`) — são chaves internas; traduza apenas o rótulo exibido.
- `docs/` — documentação (a menos que se queira traduzi-la).
- Nomes de cadernos/pastas criados pelo usuário — dados do usuário, nunca traduzir.

### 11.5 Como adicionar uma string nova

1. Adicione a chave em `src/i18n/ptBR.ts` (texto pt-BR, fonte de verdade) e em
   `src/i18n/en.ts` (tradução).
2. Consuma com `t('chave')` — em componentes via `useI18n()`; em módulos planos
   (sync/webdav) importe `t direto.
3. Se houver parâmetro, use `{{param}}` no texto e `t('chave', { param })` na chamada.
4. Não deixe string pt-BR hardcoded em JSX; confira ao final com um grep por acentos em
   `src/components` (exceto os nomes nativos dos idiomas no seletor).
