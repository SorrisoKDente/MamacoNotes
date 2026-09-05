[English](PROJECT_STRUCTURE.md) | **Português**

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
motor próprio (`PageCanvas`). Os dados são persistidos em **IndexedDB**. O estado global usa
**Zustand**. Toda a UI está em português (pt-BR) por padrão, mas suporta inglês (en).

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
| Android | Capacitor (com `capacitor-blob-writer`, `capacitor-native-settings`, `CapacitorHttp` e plugin local `pick-directory` para E/S de arquivo em chunks) | `capacitor.config.ts`, `android/` |
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
| `package.json` | Scripts (dev, build desktop/win/linux, android), dependências, config do electron-builder (incluindo instalador NSIS interativo com opção de apagar dados do app na desinstalação; atualizações forçam o fechamento do app e o cancelamento da instalação permanece disponível — ver `electron/main.cjs` `install-update` e `build-resources/installer.nsh`) |
| `AGENTS.md` | **Orquestrador de Agentes**: Prompt comportamental, regras de ouro e índice de habilidades especializadas. Links para [Português](AGENTS.pt-BR.md) |
| `SECURITY.md` | Política de segurança e instruções para reporte de vulnerabilidades |
| `vite.config.ts` | Plugins React/PWA, `base: './'`, dev server (porta 5173, `allowedHosts` para preview) |
| `tsconfig.json` | Config TypeScript (strict) |
| `index.html` | HTML base; carrega `src/main.tsx` |
| `capacitor.config.ts` | Config do Capacitor (Android) |
| `.gitignore` | Arquivos ignorados |
| `server2.mjs` | Arquivo vazio (resquício) |

### `.agents/` — Instruções de IA

| Caminho | Responsabilidade |
|---|---|
| `.agents/skills/` | **Habilidades Técnicas (Skills)**: Instruções modulares para domínios específicos (Android, Sync, UI/UX, Desktop, Versionamento). Usado por agentes de IA para focar o contexto. |

### `docs/` — Documentação

| Caminho | Responsabilidade |
|---|---|
| `docs/PROJECT_STRUCTURE.pt-BR.md` | Este documento (O Mapa). |
| `docs/architecture/` | **Documentos de Arquitetura**: Design técnico detalhado de funcionalidades core (Sync, Camadas, Motor de Desenho, i18n). |

### `src/` — código da aplicação (o núcleo)

| Arquivo | Responsabilidade |
|---|---|
| `src/main.tsx` | Bootstrap React + registro PWA |
| `src/App.tsx` | Componente raiz; composição da tela (TopBar, Sidebar, PageList, Editor, Toolbar, Modals); init + auto-sync; tecla Escape → `ink:esc`; botão de voltar do Android (Capacitor `@capacitor/app`) → `ink:esc` |
| `src/types.ts` | **Todos os tipos de dados** do domínio + `DEFAULT_SETTINGS` + `DEFAULT_SHORTCUTS` + factories (`makePage`, `makeNotebook`, `makeFolder`, `makeLayer`, `makeTextElement`, `uid`, `newId`) + helpers de camadas (`normalizePage`, `getActiveLayer`) + `TrashItem` (entrada da lixeira local) + **`APP_VERSION`** (constante de versão) |
| `src/db.ts` | **Camada de persistência IndexedDB** (object stores: `folders`, `notebooks`, `settings`, `cloudSync`, `templates`, `trash`, `notebooksContent`, `pdfImages`); migração de versão preenche o campo `order` ausente de pastas/cadernos antigos, converte páginas antigas (arrays planos) para o modelo de camadas (`migrateLayers`), separa o conteúdo das páginas em `notebooksContent` (`migrateToMetaContent`, v7 → v8) e extrai as imagens de fundo de PDF para `pdfImages` (`migratePdfImages`, v8 → v9) |
| `src/store.ts` | **Store principal (Zustand)**: todo CRUD de cadernos/pastas/páginas/modelos, ações de camadas (adicionar/renomear/duplicar/excluir/reordenar/visibilidade/opacidade/lock/ativo/merge), undo/redo, clipboard, **lixeira local** (`restoreFromTrash`, `restoreFromCloud`, `purgeTrashItem`, `runTrashPurge`), sync, persistência |
| `src/uiStore.ts` | Store de modais (`openModal`, `modalData`, `open`, `close`) |
| `src/textStore.ts` | Estado de edição de texto (draft, seleção, rotação) |
| `src/styles.css` | Todo o CSS do app |

#### `src/components/` — componentes React

| Arquivo | Responsabilidade |
|---|---|
| `TopBar.tsx` | Barra superior: toggles de sidebar/página (sempre visíveis; se o painel estiver oculto por `settings.hideSidebar`/`hidePageList`, o toggle o reexibe), título do caderno (renomeável — clique para editar inline, ou **`ink:rename` (F2)** quando nem a barra lateral nem o painel de camadas estiverem abertos), botões Imagem/Página/Exportar (somente com um caderno selecionado), **botão PDF sempre disponível** (`open('importPdfNote')` — "Adicionar PDF como nota", the same flow as the Sidebar button — funciona sem caderno selecionado) além de Sincronizar/Configurações/tela cheia |
| `Sidebar.tsx` | Árvore de pastas/cadernos, menu de contexto, **reordenação e movimento por arrastar** (DnD custom via Pointer Events, funciona com mouse e touch; arrastar sobre uma pasta move para dentro dela; indicador de posição de inserção; autoscroll), **seleção múltipla** (CTRL/Meta clique alterna, SHIFT clique seleciona faixa entre o item âncora e o clicado, **toque longo no touch alterna a seleção**; barra de seleção com copiar/recortar/colar/duplicar/excluir; nº de páginas ocultável via `settings.hidePageCount`), **barra de busca por nome** (filtra folders/notebooks por nome em uma lista plana agrupada; resultados mostrados ao digitar, limpos com o botão ×), barra redimensionável (handle `sidebar-resizer`, largura persistida em `settings.sidebarWidth`, limite 160–min(520, 50% da janela)); menu de contexto "…" fecha ao clicar fora (listener global de `pointerdown`); **botão "Lixeira" no cabeçalho** (abre o modal `trash`). **Renomear via `ink:rename` (F2)** renomeia o **último item clicado** — um clique simples registra `lastClicked` (`folder`/`notebook`, inclusive resultados da busca), multi-seleção (CTRL/SHIFT/toque longo) o redefine para `null` — com fallback para a seleção explícita única, depois a pasta selecionada, depois o caderno selecionado (modal de prompt); com uma multi-seleção na barra lateral ele não faz nada; sempre que a barra lateral estiver aberta com qualquer seleção (um ou mais itens selecionados, ou uma pasta/caderno selecionado), isso vence mesmo com o painel de camadas aberto (o painel de camadas então ignora) |
| `PageList.tsx` | Preview de páginas (thumbnails), busca por número, modo de visualização (V/H/S), drag-drop, menu por página, seleção múltipla de páginas (CTRL clique alterna, SHIFT clique seleciona faixa entre a âncora e a clicada; barra de seleção com duplicar/exportar PDF/girar/excluir). **Regeneração de thumbnails é guardada**: `thumbTimesRef` rastreia o `updatedAt` de cada página, de modo que só páginas cujo `updatedAt` mudou são re-renderizadas em bumps de `dataVersion`; substituir o array de páginas, como após um pull da nuvem, invalida todas as miniaturas em cache |
| `Editor.tsx` | **Maior componente (~2900 linhas)**: canvas de edição, zoom/pan, desenho, borracha, seleção, texto inline, gestos de pointer (incluindo toque duplo com 2 dedos = Desfazer, 3 dedos = Refazer, 2 dedos = mover/zoom e 3 dedos = girar a página), todos os drags. **Persistência com debounce**: `schedulePersist()` (400ms) persiste o **caderno vivo atual** via `persistNotebook` após o debounce — mantendo a mesma referência de objeto na store, para que o motor do canvas não seja recriado (perda do cache de imagens) após cada traço, o que causava um flicker na tela ao soltar o traço — e descarta o timer quando um pull da nuvem substitui esse objeto do caderno, evitando que uma edição local antiga sobrescreva a cópia baixada. **Proteção contra resize do teclado no celular**: enquanto um INPUT/TEXTAREA/SELECT estiver focado (mais 600ms de margem após o blur), o handler de resize da janela/`visualViewport` pula o `fitPage()` e apenas re-renderiza — preservando o zoom/posição do usuário enquanto o teclado virtual abre/fecha (ex.: digitando o tamanho da ferramenta no celular) e mantendo o backing store do canvas correto |
| `Toolbar.tsx` | Barra de ferramentas lateral: caneta/marcador/borracha/texto/selecionar/mover/rotação, undo/redo, painéis de configuração por ferramenta |
| `LayersPanel.tsx` | Painel de camadas (lateral direita): lista de camadas da página atual (base→topo invertida na UI), seleção única/múltipla (CTRL/SHIFT e toque longo), reordenação por arrastar, renomear inline (duplo clique ou **`ink:rename` (F2) renomeia a última pasta ou camada clicada**, redefinindo para `null` na multi-seleção; **ignorado sempre que a barra lateral estiver aberta com qualquer seleção — um ou mais itens selecionados, ou uma pasta/caderno selecionado — que a barra lateral renomeia em vez disso**), alternar visibilidade/bloqueio, opacidade, adicionar/duplicar/excluir/mesclar camadas, **pastas de camadas** (criar via "+ pasta", renomear via duplo clique / menu "…" / F2, excluir via menu "…" com confirmação, arrastar camada para dentro/fora de pasta e reordenar pastas entre si), **painel redimensionável** (handle `.layers-resizer` na borda esquerda, largura persistida em `settings.layersWidth`, limite 180–min(420, 50% da janela)); rodapé fixo com a cor de fundo da página |
| `Modals.tsx` | **Todos os modais**: novo caderno, página, modelo, importar imagem/PDF, exportar, configurações, nuvem, mover/copiar, cor de fundo, conflitos de sync, prompt, confirmação, **lixeira** (Restaurar / Restaurar da nuvem / Excluir definitivamente, estado vazio, nota de retenção de 30 dias). A seção de backup das Configurações expõe exportação e importação de um único JSON (`exportBackup`/`importBackup` → `replaceAllData`) |

#### `src/renderer/` — motor de desenho (Canvas)

| Arquivo | Responsabilidade |
|---|---|
| `canvas.ts` | Classe `PageCanvas`: renderiza páginas (contínuo/separado), camadas (visibilidade/opacidade), traços, imagens, textos, PDF, templates, seleção; conversão de coordenadas; hit tests |
| `drawUtils.ts` | Funções puras de desenho reutilizadas por thumbnail/export: `drawTemplate`, `drawLayer`, `drawStroke` (totalmente sincronizado com o motor principal do canvas para suportar sensibilidade à pressão e suavização por curvas quadráticas), `drawTextOnCanvas` |
| `thumbnail.ts` | Gera miniaturas das páginas (usado no PageList e nos modelos personalizados), renderizadas na resolução do `devicePixelRatio` (limitada a 3×) com qualidade JPEG 0.8 — mantendo o tamanho CSS (160×207) para os previews ficarem nítidos em celulares retina |

#### `src/utils/` — lógica de apoio

| Arquivo | Responsabilidade |
|---|---|
| `http.ts` | **Wrapper de fetch agnóstico à plataforma**: alterna entre o `fetch` padrão (Web/Electron) e o `CapacitorHttp` nativo (Android) para contornar CORS e restrições de rede. Exporta `customFetch` (corpo converte `Uint8Array`/`ArrayBuffer`/`Blob` em texto), `decodeCapacitorData(data, isJson?)` (decodifica o campo `data` do CapacitorHttp: string base64, string crua ou objeto/array JS que o CapacitorHttp parseou apesar do `responseType: 'arraybuffer'` quando o Content-Type é JSON), `isConnectionError(err)` e `withRetry(fn)` (**resiliência de rede**: 3 tentativas com backoff de 500ms→1s, apenas para falhas no nível de conexão — nunca para HTTP 4xx/5xx ou autenticação) e `downloadText` (**download em chunks via Range** usado no Android: pede `Range: bytes=…` com `responseType: 'arraybuffer'` e remonta os chunks no JS via `decodeCapacitorData` — evita o OOM da bridge para JSON de cadernos grandes). O `downloadText` detecta o `Content-Type` da resposta e passa `isJson` para `decodeCapacitorData`, que então trata strings como texto cru (nunca base64) para respostas JSON — isso corrige os erros "Bad control character in string literal in JSON" / "Unexpected end of JSON input" no Android causados por um chunk de Range caindo inteiramente dentro de um `dataUrl` de imagem base64 no JSON do caderno e sendo decodificado como base64 em lixo binário. |
| `chunkedIo.ts` | **Ponte para o plugin Capacitor local `pick-directory`**: registra `PickDirectory` e expõe primitivas em chunks que nunca enviam um arquivo grande inteiro pela bridge JS↔nativo: `readBackupFileFromUri` (leitura em chunks via `readUriChunk`/`getUriFileInfo`), `pickBackupFile` (seletor de documentos do sistema → leitura em chunks), `saveBackupFile` (seletor "Salvar como" do sistema → escrita em chunks) e `uploadFileStreaming` (PUT em stream usando um único `OutputStream` nativo, enviando chunks de bytes codificados em base64 com o tamanho UTF-8 declarado). |
| `layout.ts` | Cálculo de offsets/posição das páginas em modo contínuo (vertical/horizontal), `pageVisualRect`, `pageUnderPoint` |
| `drawText.ts` | Medição e desenho de elementos de texto (horizontal/vertical, marcadores, sublinhado/riscado) |
| `export.ts` | Renderização da página em canvas e exportação PNG/PDF (gera PDF simples sem biblioteca externa) |
| `pdf.ts` | Renderização de arquivos PDF em imagens via `pdfjs-dist` (`renderPdfPages`) |
| `webdav.ts` | Transporte WebDAV (fetch PROPFIND/MKCOL/PUT/DELETE), suporte especial Koofr, `makeTransport`. No Android o transporte usa os **caminhos nativos em chunks**: `downloadFile` via `downloadText` do `http.ts` (Range + arraybuffer) e `uploadFile` via `uploadFileStreaming` do `chunkedIo.ts` (PUT em stream pelo plugin `pick-directory` via `HttpURLConnection`) — ambos evitam o OOM da bridge. Uploads nativos verificam o tamanho remoto via HEAD quando suportado, rejeitando objetos vazios/truncados antes de o manifest avançar. **Falhas no nível de conexão** (de `isConnectionError` do `http.ts`) são relançadas como mensagem amigável `error.networkUnreachable` para orientar o usuário a verificar a conexão com a internet. |
| `sync.ts` | **Algoritmo de sincronização bidirecional** (merge, conflitos, tombstone, migração). Um caderno remoto claramente mais novo tem prioridade sobre um baseline local antigo deixado por upload falho. A sincronização manual ("Sincronizar agora") roda o mesmo algoritmo do auto-sync — um caderno editado localmente é **enviado**, nunca baixado por cima da edição. Em falha de download (caderno/pasta), registra o erro via `logger.error` (visível na aba Configurações → Logs) **antes** de exibi-lo no resultado/UI — no celular, falhas sem esse log eram invisíveis silenciosamente. O `buildPlan` ignora ids sob `localOnlyDeleted`/`tombstones` no loop de pull, e um caderno que reapareceu localmente depois da exclusão remota (restaurado da lixeira, sem tombstone/baseline ativo) é **reenviado** em vez de ser excluído de novo. |
| `backup.ts` | Exportar/importar backup JSON completo (pastas, cadernos e configurações; sanitiza as configurações e **removes cloud passwords** for security). No celular a exportação abre o **seletor "Salvar como" do sistema** (`saveBackupFile`, escrita em chunks via SAF) para que o usuário escolha o destino, sempre com **nome com carimbo de data** (`mamaco-notes-backup-YYYY-MM-DD-HHmmss.json`); a importação usa o seletor de documentos do sistema (`pickBackupFile`, leitura em chunks). No desktop usa as pontes `save-file`/`open-file` do Electron e na web dispara download/input de arquivo. |
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
| `main.cjs` | Processo principal: janela, menu, IPC handlers (`save-file`, `open-file`) |
| `preload.cjs` | Bridge `window.inkfolioDesktop` (contextIsolation): `save-file`, `open-file`, `setLanguage`, eventos de atualização |

### Outros

| Caminho | Responsabilidade |
|---|---|
| `plugins/pick-directory/` | **Plugin Capacitor local** (dependência `pick-directory` via `file:plugins/pick-directory`): seletores de documentos do sistema (**`openFilePicker`** para leitura e **`openFileCreator`** para "Salvar como"), leitura/escrita de arquivo em chunks em URIs `content://` (`writeUriChunk`/`readUriChunk`, `getUriFileInfo`) e upload PUT em stream (`uploadStart`/`uploadChunk`/`uploadEnd` via `HttpURLConnection`) — tudo para evitar o `OutOfMemoryError` do Android ao enviar conteúdo grande pela bridge. Tipos TS em `index.d.ts`; o código Android fica em `android/`. |
| `public/` | Ícones estáticos do PWA (favicon, apple-touch-icon, pwa-192/512, maskable) |
| `assets/` | Recursos de marketing e documentação (screenshots, QR codes) |
| `build-resources/` | Ícones do empacotamento desktop (icon.ico, icon.png) e o script NSIS customizado `installer.nsh` (atalho na Área de Trabalho, limpeza do atalho na desinstalação, uma **`customCheckAppRunning` robusta** que substitui a detecção padrão do electron-builder, e hooks de migração que ignoram/toleram desinstaladores legados que retornam erro 2) |
| `docs/architecture/` | Documentos de design aprovados (sincronização bidirecional; camadas; desenho; i18n) |
| `scripts/verify-sync.ts` | Verificação de regressão de sync standalone: exercita `buildPlan`/`runSync` contra um transporte fake em memória (recuperação de baseline local obsoleta, rollback em falha de escrita de manifesto, execução idempotente, exibição de erro de auth, **regressão de tombstone do Bug A**: um caderno com tombstone nunca é re-baixado; **restauração da lixeira**: um caderno que reapareceu localmente após deleção remota é re-enviado e a entrada do manifesto volta para `deleted:false`). Rode com `npx tsx scripts/verify-sync.ts`; checado via `tsconfig.json` |
| `scripts/verify-download.ts` | Verificação independente da correção de download no Android: força o caminho nativo de `downloadText` (sobrescrevendo `Capacitor.isNativePlatform()`) contra um fetch mockado que simula o lado do servidor Android, asseverando que o `decodeCapacitorData` reconstrói o texto correto para corpos JSON-parsed (200), chunks de Range JSON truncados (206), chunks base64 (arquivo grande não-JSON), tratamento de 404, a desambiguação JSON-vs-base64 (`isJson` mantém strings JSON como texto bruto para que um chunk dentro de um `dataUrl` base64 nunca seja decodificado como base64), que o download nativo em chunks de um caderno JSON grande com imagem base64 embutida remonta byte-exact, e o **comportamento de retry** (classificação de `isConnectionError` e backoff de `withRetry` 500ms→1s: erros de conexão são retentados, erros HTTP 4xx/5xx e de auth não). Rode com `npx tsx scripts/verify-download.ts` |
| `server2.mjs` | Arquivo vazio (resquício) |

---

## 5. Arquitetura de dados e estado

### 5.1 Modelo de dados (definições em `src/types.ts`)

Hierarquia: **Folder** → **Notebook** → **Page** → **Layer** → (Stroke | ImageElement | TextElement) + PdfBackground (fundo da página, fora das camadas)

- `Folder { id, name, parentId, createdAt, order? }` — pastas aninhadas; `order` é a posição entre os irmãos do mesmo `parentId` (usado na reordenação por arrastar).
- `Notebook { id, name, folderId, pages, createdAt, updatedAt, order? }` — caderno; `order` é a posição entre os cadernos do mesmo `folderId` (usado na reordenação por arrastar).
- `Page { id, template, width, height, rotation, backgroundColor, layers, layerFolders, activeLayerId, pdf?, createdAt, updatedAt }` — o conteúdo editável fica todo nas **camadas** (`layers`); `activeLayerId` persiste a camada ativa (fallback para a última do array se nulo/inexistente). Os antigos arrays planos `strokes`/`images`/`texts` foram **removidos**. `layerFolders` agrupa camadas visualmente (ver `LayerFolder`).
- `Layer { id, name, visible, opacity, locked, folderId, strokes, images, texts, strokeErasures? }` — camada de conteúdo. Ordem do array `layers`: **índice 0 = base** (desenhada primeiro), **último = topo**. Dentro de cada camada mantém-se a ordem de sub-desenho **imagens → textos → traços**. `strokeErasures` armazena caminhos circulares de borracha em coordenadas da página, associados aos IDs dos traços existentes no início do gesto, para que desenhos posteriores continuem visíveis sobre a área apagada. Uma camada travada (`locked: true`) não recebe conteúdo nem é editável no canvas (desenho/borracha/seleção/mover), mas continua podendo ser renomeada, reordenada, duplicada, excluída, ocultada, ter opacidade ajustada, tornar-se ativa e participar de um merge. `folderId` é o `LayerFolder` ao qual a camada pertence (`null`/indefinido = raiz, ou seja, sem pasta).
- `LayerFolder { id, name, order? }` — **pasta de camadas** (um único nível, sem aninhamento). Vive dentro do JSON da página (`Page.layerFolders`), então o sync/backup de cadernos existente já a carrega. `order` é a posição da pasta entre as irmãs (usado na reordenação por arrastar). Uma pasta agrupa camadas visualmente; excluir uma pasta move suas camadas para a raiz (`folderId = null`).
- `Stroke { id, kind(pen|highlighter), color, size, points[] }` — traço com pressão.
- `ImageElement { id, name, dataUrl, x, y, width, height, rotation }`.
- `TextElement { id, text, x, y, width, rotation, fontSize, fontFamily, bold, italic, underline, strikethrough, color, backgroundColor, align, marker, direction, createdAt }`.
- `PdfBackground { dataUrl, name, pageNumber }` — PDF usado como fundo da página (fica **no nível da página**, abaixo de todas as camadas; não é uma `Layer`).
- `AppSettings` — todas as configurações (cor/tamanho da caneta, eraser, modos, atalhos, `cloud`, ocultar barra superior/ferramentas via `hideTopBar`/`hideToolbar`, ocultar barra de cadernos/preview de páginas via `hideSidebar`/`hidePageList`, ocultar nº de páginas do caderno via `hidePageCount`, ocultar o cursor da ferramenta sobre a página via `hideToolCursor`, ignorar uma versão específica de atualização via `ignoreVersion`, seleção apenas da parte delimitada via `selectDelimitedOnly`, largura da barra de cadernos via `sidebarWidth`, **largura do painel de camadas via `layersWidth`**).
- `CloudSettings { enabled, webdavUrl, webdavUsername, webdavPassword, rememberPassword, webdavPath, autoSync, lastSyncAt }` — dados do sync. `rememberPassword` (boolean) controla se a senha é apagada ao desconectar.
- `TrashItem { id, kind: 'notebook'|'folder', name, parentId, data: Notebook|Folder|null, deletedAt, cloudKeepsCopy }` — **entrada da lixeira local** (NÃO sincronizada). Uma entrada por item excluído: excluir uma pasta produz uma entrada para a pasta, uma para cada subpasta e uma para cada caderno dentro (cada uma com seu `parentId`) para que cada item possa ser restaurado individualmente. `cloudKeepsCopy` é `true` quando o item foi excluído "só local" com nuvem configurada (o `data` pesado é descartado; o item só volta com "Restaurar da nuvem"). Quando `false` (excluído "local + nuvem" ou sem nuvem), `data` guarda o item completo para restauração sem nuvem.

> Sempre que precisar alterar o formato de um dado persistido, comece por `src/types.ts`
> e depois verifique a normalização em `src/store.ts` (funções `applySyncChanges`,
> `init`, `replaceAllData`) e em `src/db.ts`.
>
> **Camadas**: `makePage` cria uma página com 1 camada padrão "Camada 1"
> (`visible: true`, `opacity: 1`, `locked: false`, `folderId: null`, `layerFolders: []`).
> `normalizePage(page)` (função pura em
> `types.ts`) converte páginas legadas/parciais: se `layers` estiver ausente/vazio, cria 1
> camada a partir dos arrays planos antigos; normaliza cada camada defensivamente
> (incluindo `folderId ?? null`); normaliza `layerFolders` (padrão `[]`); valida
> `activeLayerId` (fallback última camada) e **remove** os campos planos legados do
> resultado. `getActiveLayer(page)` resolve a camada ativa (ou a última).

### 5.2 Persistência (IndexedDB) — `src/db.ts`

Banco `mamaco-notes`, versão **9**, com object stores:

| Store | Conteúdo | Chave |
|---|---|---|
| `folders` | `Folder[]` | `id` |
| `notebooks` | `NotebookSummary[]` (metadados leves: id, name, folderId, timestamps, order, pageCount, favorite) | `id` |
| `notebooksContent` | `{ id, pages: Page[] }` — desenhos completos das páginas; os fundos de PDF são armazenados **leves** (`pdf` sem `dataUrl`); camadas podem conter máscaras persistidas de apagamento parcial (`strokeErasures`) | `id` |
| `pdfImages` | `PdfImageRecord { pageId, notebookId, dataUrl }` — imagens de fundo de páginas de PDF (imutáveis, gravadas apenas quando novas) | `pageId` (+ índice `byNotebook` em `notebookId`) |
| `settings` | 1 registro `{ id:'main', ...AppSettings }` | `id` |
| `cloudSync` | 1 registro `CloudSyncState` | `id` |
| `templates` | `PageTemplate[]` (modelos personalizados) | `id` |
| `trash` | `TrashItem[]` (lixeira local, não sincronizada) | `id` |

Toda escrita em dados no app passa por `store.ts`, que chama `db.*`.

> **Migração 3 → 4**: ao abrir o banco na versão nova, `openDb()` executa
> `migrateOrders()` (idempotente) que preenche `order` em pastas/cadernos antigos sem o
> campo — por grupo de `parentId`/`folderId`, ordenando pastas por `createdAt` (asc) e
> cadernos por `updatedAt` (desc); registros que já têm `order` são preservados e os sem
> `order` recebem valores posteriores ao maior existente. A normalização em memória
> continua existindo em `store.ts` (`fillFolderOrder`/`fillNotebookOrder`) para dados
> vindos de sync/backup.
>
> **Migração 4 → 5 (camadas)**: além de `migrateOrders`, `openDb()` executa
> `migrateLayers()` (idempotent): percorre a object store `notebooks` e reescreve cada
> página com `normalizePage` — páginas antigas com arrays planos ganham 1 camada única com
> o conteúdo preservado; páginas já com `layers` não são alteradas. Dados vindos de
> sync/backup também são normalizados na leitura (`store.ts`/`sync.ts`), então o
> `SyncManifest` não mudou de versão.
>
> **Migração 5 → 6 (lixeira)**: `openDb()` cria a object store `trash` (keyPath `id`) se
> estiver ausente. No há reescrita de dados — a lixeira começa vazia e os registros
> existentes de folders/notebooks/cloudSync são preservados intactos.
>
> **Migração 6 → 7 (pastas de camadas)**: o aumento da versão re-executa `migrateLayers()`
> (idempotente), que reescreve as páginas de todos os cadernos via `normalizePage` — agora
> adicionando `layerFolders: []` e `folderId: null` às páginas/camadas sem esses campos.
> Dados vindos de sync/backup também são normalizados na leitura em `store.ts` (`init`,
> `applySyncChanges`, `replaceAllData`), então não é preciso mudar a versão do sync.
>
> **Migração 7 → 8 (separação do conteúdo das páginas)**: `migrateToMetaContent()` move o
> array `pages` (pesado) da object store `notebooks` para a nova object store
> `notebooksContent` (keyPath `id`) e reescreve cada registro de `notebooks` como um
> `NotebookSummary` leve. A lista de páginas / miniaturas carrega os resumos de `notebooks`
> e as páginas completas de `notebooksContent`.
>
> **Migração 8 → 9 (imagens de PDF)**: `migratePdfImages()` extrai os blobs pesados e
> imutáveis `page.pdf.dataUrl` de fundo de `notebooksContent` para a nova object store
> `pdfImages` (keyPath `pageId`, índice `byNotebook` em `notebookId`) e reescreve o registro
> de conteúdo com páginas "leves" (`pdf` sem `dataUrl`). Assim, `putNotebook` grava apenas
> as páginas leves em `notebooksContent` e faz upsert dos blobs em `pdfImages` somente
> quando são novos — rastreados por um cache em memória de `pageId → dataUrl length` — de
> modo que um commit por traço nunca re-serializa as imagens grandes de PDF (causa raiz do
> congelamento da UI ao soltar o traço em cadernos com muitos PDFs). `getNotebook`/
> `getFirstPage` reidratam o `dataUrl` de `pdfImages`, então páginas/canvas/miniaturas em
> memória se comportam exatamente como antes; `deleteNotebook` também remove os blobs do
> caderno (sem vazamentos). Sync/backup não mudam, pois leem cadernos totalmente reidratados.

### 5.3 Stores (Zustand)

- **`useAppStore`** (`src/store.ts`) — estado global principal:
  - Dados: `folders`, `notebooks`, `templates`, `trash`, `settings`, `dataVersion: number` (incrementado a
    cada persistência; usado para re-render e auto-sync).
  - Seleção/UI: `selectedFolderId`, `selectedNotebookId`, `selectedIds`, `currentPageIndex`,
    `tool`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`.
  - Ações CRUD: `createNotebook`, `addPage`, `updatePage`, `deleteNotebook`, `moveFolder`,
    `reorderFolder`, `reorderNotebook`, `duplicateFolder`, etc.
  - **Lixeira local**: `restoreFromTrash(id)` (restaura um item "local + nuvem" ou sem nuvem
    a partir de `data`, limpa tombstone/baseline e reenvia via sync), `restoreFromCloud(id)`
    (baixa o item de volta da nuvem — usado para itens "só local" com `cloudKeepsCopy` true),
    `purgeTrashItem(id)` (remove a entrada; a cópia na nuvem não é afetada), `runTrashPurge()`
    (remove entradas com mais de `TOMBSTONE_RETENTION_MS` (30 dias) que não têm cópia na nuvem
    — itens "só local" são mantidos para restar apenas "Restaurar da nuvem"). Chamada no
    `init()` e ao abrir o modal da lixeira.
  - Desfazer/refazer: `pushUndo`, `undo`, `redo` (pilhas internas, snapshots de página,
    máx. 60 entradas).
  - Nuvem: `syncNow()`, `resolveConflicts()`.
  - Persistência: `persistNotebook`, `updateNotebookStorage`, `saveSettings`.
  - **Auto-sync**: `useAppStore.subscribe` observa `dataVersion` e dispara `syncNow()` com
    debounce de 20s. Guardas: `syncRunning` evita reentrância, e `syncQueued` enfileira
    uma sincronização de acompanhamento quando uma mudança chega durante uma
    sincronização em andamento (edições feitas na janela de sync não são perdidas).
  - **Restauração de sessão**: um segundo `useAppStore.subscribe` salva no `localStorage`
    (chave `mamaco-notes.last-session`) o par `{ notebookId, pageId }` sempre que o caderno
    ou a página corrente mudam; `init()` usa esse registro para reabrir a última nota/página
    aberta (com fallback para nada selecionado quando o registro não existe ou o caderno foi
    excluído). O mesmo `subscribe` também mantém um **mapa de última página por caderno**
    (chave `mamaco-notes.last-page`, formato `{ [notebookId]: pageId }`), e o
    `selectNotebook(id)` o lê para reabrir um caderno na sua última página — em vez de resetar
    sempre para a primeira — ao trocar de caderno na barra lateral (validando que a página
    lembrada ainda existe, senão cai para a página 0).
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
db.ts (IndexedDB)
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
| **Dados** | `loaded: boolean`, `folders: Folder[]`, `notebooks: Notebook[]`, `templates: PageTemplate[]`, `trash: TrashItem[]`, `settings: AppSettings`, `dataVersion: number` |
| **Seleção/UI** | `selectedFolderId`, `selectedNotebookId`, `selectedIds: string[]`, `selectedPageIndices: number[]`, `clipboard: { ids, cut } \| null`, `lastClicked: LastClickedTarget` (último item com clique único: `{ type: 'folder'\|'notebook'\|'layer'\|'layerFolder'; id }`, `{ type: 'notebookTitle' }` ou `null` — usado pelos listeners de `ink:rename` (F2) para renomear exatamente o item clicado por último; definido pelos handlers de clique da Sidebar/LayersPanel/TopBar e redefinido para `null` na multi-seleção e quando o item é excluído), `currentPageIndex`, `tool: ToolKind`, `sidebarOpen`, `pageListOpen`, `layersOpen`, `searchOpen`, `rotationOpen`, `canUndo`, `canRedo` |
| **Bootstrap** | `init(): Promise<void>` |
| **Navegação/seleção** | `selectFolder(id)`, `selectNotebook(id)`, `selectPage(index)`, `setTool(tool)`, `setRotationOpen(open)`, `toggleSidebar()`, `togglePageList()`, `toggleLayers()`, `setSidebarOpen(open)`, `setPageListOpen(open)`, `setLayersOpen(open)`, `toggleSearch()` |
| **Edição de seleção** | `toggleSelect(id)`, `clearSelection()`, `setSelectedIds(ids)`, `setLastClicked(target: LastClickedTarget)`, `copySelected()`, `cutSelected()`, `pasteClipboard()`, `duplicateSelected()`, `deleteSelected(scope?)` |
| **Seleção de páginas** | `selectedPageIndices`, `toggleSelectPage(index)`, `setPageSelection(indices)`, `clearPageSelection()`, `duplicateSelectedPages()`, `deleteSelectedPages()`, `rotateSelectedPagesBy(delta)` |
| **Pastas** | `addFolder(name, parentId?)`, `deleteFolder(id, scope?)`, `renameFolder(id, name)`, `moveFolder(id, newParentId)`, `reorderFolder(id, parentId, beforeId)`, `duplicateFolder(id)`, `copyFolder(id, targetParentId)` |
| **Cadernos** | `createNotebook(name, folderId, template)`, `createNotebookFromTemplate(...)`, `deleteNotebook(id, scope?)`, `moveNotebook(id, folderId)`, `reorderNotebook(id, folderId, beforeId)`, `copyNotebook(id, folderId)`, `duplicateNotebook(id)`, `updateNotebook(notebook)` |
| **Páginas** | `addPage(template)`, `addPageAfter(index, template)`, `duplicatePage(index)`, `deletePage(index)`, `movePage(from, to)`, `rotatePage(index)`, `rotatePageBy(index, delta)`, `updatePage(index, patch: Partial<Page>)` |
| **Camadas** | `addLayer(folderId?)`, `renameLayer(index, name)`, `duplicateLayer(index)`, `deleteLayer(index)`, `moveLayer(from, to)`, `moveLayerToFolder(from, folderId, beforeId)`, `setLayerVisible(index, visible)`, `setLayerOpacity(index, opacity)` (0..1), `setLayerLocked(index, locked)`, `setActiveLayer(id)`, `mergeSelectedLayers(indices)`, **pastas de camadas**: `addLayerFolder(name)`, `renameLayerFolder(id, name)`, `deleteLayerFolder(id)`, `reorderLayerFolder(id, beforeId)` |
| **Configuração** | `setSettings(patch)`, `setShortcut(action, value)`, `setCloud(patch)` |
| **Nuvem** | `syncNow(): Promise<SyncResult \| null>` (avança `settings.cloud.lastSyncAt` **somente** quando a execução termina sem erros), `resolveConflicts(choices: Record<string, ConflictChoice>)` |
| **Lixeira** | `restoreFromTrash(id)`, `restoreFromCloud(id)`, `purgeTrashItem(id)`, `runTrashPurge()` |
| **Persistência/undo** | `persistNotebook(notebook)`, `pushUndo()`, `undo()`, `redo()` |
| **Importação/modelos** | `addImageToPage(dataUrl, name, center?)`, `addPdfToPage(dataUrl, name)`, `importPdfNotebook(...)`, `addTemplate(name, pages)`, `deleteTemplate(id)`, `addPagesFromTemplate(template)`, `applyTemplateToPage(index, template)`, `replaceAllData(folders, notebooks, settings?)` |

**Garantias**: toda ação de dados grava no IndexedDB (`db.ts`) e incrementa `dataVersion`
(dispara re-render e o auto-sync). As
operações de página/caderno agem sobre o notebook/índice selecionado. Undo/redo usam
pilhas internas de snapshots de página (máx. 60). Pastas e cadernos são sempre ordenados
por `order` (`sortFoldersByOrder`/`sortNotebooksByOrder`); `reorderFolder`/`reorderNotebook`
recalculam `order` dos irmãos dentro do mesmo nível (`parentId`/`folderId`) e
`moveFolder`/`moveNotebook` delegam a `reorder*` movendo para o fim do destino. Dados
antigos sem `order` (sync/backup) são normalizados por `fillFolderOrder`/`fillNotebookOrder`.
`selectNotebook(id)` reabre o caderno na última página lembrada para ele (ver §5.3
restauração de sessão, `mamaco-notes.last-page`), caindo para página 0 se a página lembrada
não existir mais; `selectFolder(id)` e `selectNotebook(null)` resetam para a página 0.
`lastClicked` é uma conveniência puramente de UI (definida por `setLastClicked`, nunca
persistida): é limpo quando a pasta/caderno/camada/pasta-de-camadas referenciada é
excluída, quando um pull da nuvem ou uma restauração de backup substitui os dados, e
quando o caderno selecionado é removido por uma mudança de sync.

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
**Garantias das pastas de camadas**: `page.layers` continua sendo a única fonte da ordem z
(índice 0 = base); o agrupamento por pasta é uma *visão* sobre o array plano (ordem de
exibição = ordem de `layerFolders`). `addLayer(folderId?)` insere a nova camada no **topo
do grupo-alvo** (a mesma regra de `moveLayerToFolder` com `beforeId = null`); sem pasta,
mantém o comportamento legado (insere após a camada ativa). `moveLayerToFolder(from,
folderId, beforeId)` define o `folderId` da camada e a reposiciona: com `beforeId`, logo
antes dessa camada; caso contrário, no **topo do grupo da pasta-alvo** (ou do grupo raiz).
`deleteLayerFolder(id)` remove a pasta e define `folderId = null` em todas as suas camadas
(elas vão para a raiz). `reorderLayerFolder(id, beforeId)` recalcula o `order` das irmãs
como `reorderFolder`. `moveLayer(from, to)` permanece para compatibilidade (nenhum outro
chamador depois que o painel passou a usar `moveLayerToFolder`).
`mergeSelectedLayers` faz spread da camada do topo (mantém seu `folderId`);
`cloneLayerWithNewIds` e os clones de página também mantêm `folderId`, então camadas
duplicadas/mescladas permanecem na mesma pasta.

#### `useUiStore` (`src/uiStore.ts:22`) — modais

| Campo/Ação | Tipo |
|---|---|
| `openModal` | `ModalName \| null` (conjunto fechado de 20 valores, listados no topo do arquivo) |
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
- **Barras de Rolagem**: Barras interativas de alto contraste (thumb branca com borda escura) 
  renderizadas como overlays. Posição e tamanho são calculados em `updateScrollbars()` 
  dentro do loop RAF, usando `getPanLimits()` para mapear a área navegável total.
- **Limites de Pan**: O movimento é restrito por `clampPan()` usando uma `MARGIN` fixa 
  (ex: 60px) além das bordas do documento. Os limites são recalculados no zoom/resize, 
  garantindo que o "vazio infinito" não aumente ao tirar o zoom.
- **Coordenadas**: conversões `toPageCoords` / `toDocumentCoords` / `toPageCoordsAt` /
  `toScreenCoords` (aplica pan, zoom, offset da página e rotação da página).
- **Interação**: `Editor.tsx` implementa todos os gestos via handlers de `PointerEvent`
  no container principal (para capturar drags de scrollbar). Inclui `pan | draw | erase | 
  select-move | select-resize | select-rotate | region-draw | region-move | 
  text-rotate | text-resize | page-rotate | group-resize | group-rotate | scroll-v | scroll-h`.
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
  O ponteiro que iniciou um drag é rastreado em `dragOwnerIdRef`; **só o `pointerup` do
  dono efetiva o drag de conteúdo** (desenho/borracha/seleção por região) — um dedo que
  não é o dono, ao ser levantado, não encerra nem efetiva o traço prematuramente. Quando
  um segundo dedo se junta a um drag de conteúdo (`dragInterruptedByTouchRef`), o gesto
  passa a ser tratado como possível toque/palma: no `pointerup` do dono, se o multi-toque
  foi tipo-toque (outros dedos ainda abaixados, ou `multiTouchDownAtRef` dentro de
  `TWO_FINGER_TAP_MAX_MS`), o conteúdo em andamento é **descartado** (traço não
  efetivado, região não finalizada), de modo que um toque de vários dedos nunca cria
  traços/seleções espúrios nem limpa as pilhas de desfazer/refazer.
  - **Toque duplo com 2 dedos = Desfazer**: um "toque" de 2 dedos é reconhecido quando
    os dois ponteiros sobem sem deslocamento relevante (`pointerDownPosRef` guarda a
    posição inicial de cada dedo; se the first finger já se moveu mais de
    `TWO_FINGER_THRESHOLD`, o candidato é descartado para não confundir com palma da
    mão) e o tempo entre o segundo dedo descer e todos subirem é ≤
    `TWO_FINGER_TAP_MAX_MS` (300ms). Dois desses toques com intervalo ≤
    `TWO_FINGER_DOUBLE_TAP_GAP_MS` (400ms) entre o fim de um e o fim do outro disparam
    `useAppStore.undo()` — o equivalente ao "Desfazer". O primeiro toque apenas arma o
    cronômetro; `lastTwoFingerTapAtRef` guarda o instante do último toque.
  - **Toque duplo com 3 dedos = Refazer**: espelha o gesto de 2 dedos, mas o candidato
    só é armado quando o terceiro ponteiro desce (`threeFingerDownAtRef`; zerado se um
    pan/pinça começa). Dois toques de 3 dedos nas mesmas janelas de tempo
    (`TWO_FINGER_TAP_MAX_MS` / `TWO_FINGER_DOUBLE_TAP_GAP_MS`) disparam
    `useAppStore.redo()`. `lastThreeFingerTapAtRef` guarda o instante do último toque.
    Como toques de vários dedos descartam o drag de conteúdo em andamento, eles não
    empurram mais uma entrada de undo espúria que limparia a pilha de refazer antes de
    `redo()` rodar.
  - **Divisão de gestos: 2 dedos mover/zoom, 3 dedos rotacionar**: o pan/pinça de 2
    dedos aplica **apenas** pan e zoom. A rotação da página é um gesto de **3 dedos**:
    com 3 ponteiros abaixados, a rotação do ângulo entre os dois dedos mais afastados
    (`rotationPair`/`angleBetween` em `Editor.tsx`) é aplicada em `page.rotation`
    (graus), mantendo a convenção do `page-rotate` (rotação no sentido horário na tela
    aumenta o ângulo). A base do ângulo e da rotação são capturadas em
    `drag.startAngle`/`drag.startRotation` quando o gesto se confirma e recapturadas
    quando uma nova fase de multi-toque começa (um dedo novo zerando `pinchRef`, evitando
    saltos). `pushUndo()` é chamado **uma única vez por gesto**, apenas quando a rotação
    começa a ser aplicada (flag `pinchRotationUndoPushedRef`), e a mudança é persistida
    via `schedulePersist()`.
  - **Rotações nunca empurram undo vazio**: `pushUndo()` é chamado **somente quando uma
    mudança real é aplicada** à página. Traços são empurrados no commit em `onPointerUp`
    (só se `stroke.points.length >= 2`); a borracha empurra apenas se
    a borracha parcial registra uma entrada quando cria a máscara, enquanto a borracha em imagens só empurra quando `session.commit()` retorna elementos alterados (tanto no fim do gesto quanto no
    aborto por pan de vários dedos); e tanto o gesto de rotação por 3 dedos quanto o
    `page-rotate` (seleção com rotação livre) empurram no primeiro movimento que muda o
    ângulo real (`|delta| > 1°`, flags `pinchRotationUndoPushedRef`/
    `pageRotateUndoPushedRef`). Isso evita entradas de undo idênticas à página atual —
    a causa raiz do "Desfazer de 2 dedos não faz nada e o Refazer pisca sem efeito".
- **Seleção**: estruturas `Set` de ids (`strokes`, `images`, `texts`) em `selectionRef`;
  regiões (retângulo/círculo/laço) em `selectionRegionRef`; clipboard interno de seleção.
  A seleção por região (`computeSelection` em `Editor.tsx`) testa, para imagens, centro e
  cantos rotacionados dentro della região **e também** a intersecção entre a borda da região e
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
  opacidade por camada. A função `drawStroke` implementa a mesma lógica de sensibilidade
  à pressão e suavização do editor principal, garantindo que as miniaturas e exportações
  PDF/PNG correspondam fielmente à aparência das anotações reais.
- **Performance de Renderização**: O `Editor.tsx` utiliza um **loop de requestAnimationFrame (RAF)** para desacoplar o desenho dos eventos de ponteiro, garantindo uma taxa de quadros estável. Atualizações de alta frequência (como a posição do cursor da ferramenta) são feitas via **manipulação direta do DOM** usando refs para evitar re-renders do React. Dispositivos de entrada de alta precisão (como mesas digitalizadoras) são suportados via **eventos coalescidos** (`getCoalescedEvents`) para traços o mais fluidos possível.

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
| `ink:image-selected` | `{ id }` | `Editor.tsx` | `Toolbar.tsx" (painel Seleção) |
| `ink:recenter` | — | atalho `recenter` | `Editor.tsx` |
| `ink:rename` | — | atalho `rename` (`useShortcuts.ts`, padrão F2) | `Sidebar.tsx` (renomeia a **última** pasta/caderno **clicada** — via `store.lastClicked`, definido no clique simples incl. resultados da busca, `null` na multi-seleção — com fallback para a seleção explícita única, depois a pasta selecionada, depois o caderno selecionado, via modal de prompt; com uma multi-seleção na barra lateral ele não faz nada; sempre que a barra lateral estiver aberta com qualquer seleção isso vence mesmo com o painel de camadas aberto), `LayersPanel.tsx` (renomeia inline a **última camada/pasta-de-camadas clicada** — via `store.lastClicked`, `null` na multi-seleção — senão a linha de pasta selecionada, senão a camada ativa; somente quando o painel de camadas está aberto, e ignorado sempre que a barra lateral estiver aberta com qualquer seleção), `TopBar.tsx` (inicia a edição do título do caderno atual quando o **último item clicado** foi o título, ou quando nem a barra lateral nem o painel de camadas estão abertos) |
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
  API quando WebDAV não suporta MKCOL). **Erros de autenticação (401/403)** são
  detectados em toda chamada (API Koofr e caminhos WebDAV) e exibidos com mensagens
  claras e acionáveis (`error.koofrAuthFailed`/`error.webdavAuthFailed` — orienta o
  usuário a conferir o usuário/e-mail e o App Password), para que uma credencial inválida
  nunca fique escondida atrás de um erro genérico.
- **Download Android (corpos JSON)**: em plataformas nativas os downloads passam por
  `downloadText` em `src/utils/http.ts` (requests Range em chunks, `responseType:
  'arraybuffer'`). O CapacitorHttp **ignora `arraybuffer` quando o Content-Type é
  `application/json`** e devolve o corpo já parseado como objeto/array JS (ver
  `decodeCapacitorData`) — o código antigo tratava corpo não-string como vazio,
  produzindo `JSON.parse('')` → "Unexpected end of JSON input"
  (`error.syncDownloadFoldersFailed`). `decodeCapacitorData` reconstrói os bytes para
  base64, texto cru ou JSON parseado, e `downloadText` sai do loop de chunks quando um
  chunk decodificado está vazio.
  **Desambiguação JSON-vs-base64**: o `downloadText` lê o `Content-Type` da resposta e
  passa `isJson` para `decodeCapacitorData`; para respostas JSON uma string é sempre
  texto cru (nunca base64). Isso evita que um chunk de Range que cai inteiramente dentro
  de um `dataUrl` de imagem base64 de um caderno (todos os caracteres do alfabeto base64,
  comprimento divisível por 4) seja decodificado como base64 em lixo binário, o que antes
  corrompia o JSON remontado com caracteres de controle ("Bad control character in string
  literal in JSON") ou o encurtava ("Unexpected end of JSON input") ao sincronizar
  cadernos grandes com muitas imagens pelo celular.
- **Log de falhas de download**: falhas de download de caderno/pasta em `sync.ts`
  chamam `logger.error(...)` (visível em Configurações → Logs) antes de serem exibidas no
  resultado/UI do sync, para que falhas de sync no celular gerem um log de verdade.
- **Resiliência de rede (Android)**: `src/utils/http.ts` envolve toda chamada de rede
  (`customFetch` nativo + web, e cada chunk Range do `downloadText`) em `withRetry(fn)` —
  3 tentativas com backoff de 500ms→1s, aplicado **somente** quando `isConnectionError(err)`
  casa uma falha no nível de conexão ("Failed to connect", "connect timed out", "network is
  unreachable" etc.). Erros HTTP 4xx/5xx e de autenticação nunca são repetidos.
  `src/utils/webdav.ts` converte falhas de conexão restantes na mensagem amigável e
  acionável `error.networkUnreachable` ("Sem conexão com o servidor...").
- **Correção do pull de tombstone (Bug A)**: o loop de cadernos remotos do `buildPlan`
  pula ids sob `state.localOnlyDeleted` **and** `state.tombstones`, de modo que um caderno
  marcado para exclusão nunca é re-baixado e transformado em conflito. Um caderno que
  reaparece localmente **depois** de a exclusão remota ter sido confirmada (restaurado da
  lixeira: sem tombstone ativo e sem baseline de sync) cai em um novo branch e é
  **reenviado** (`plan.push`) em vez de ser excluído localmente de novo.
- **Verificação de download Android**: `scripts/verify-download.ts` (rodar com `npx tsx
  scripts/verify-download.ts`) força o caminho nativo do `downloadText` (sobrescrevendo
  `Capacitor.isNativePlatform()`) com um fetch mockado que simula o servidor Android,
  validando que `decodeCapacitorData` reconstrói o texto correto para corpos JSON-parsed,
  chunks Range JSON truncados, chunks base64 (arquivo grande) e tratamento de 404.
- **Algoritmo de merge**: `src/utils/sync.ts` — `runSync()` e `applyConflictChoices()`.
  Layout remoto: `manifest.json` + `notebooks/<id>.json` + `folders/folders.json`.
  Compara `local.updatedAt`, `remote.updatedAt` e `cloudSync.notebooks[id]` para decidir
  push/pull/delete/conflito. O hash de pastas (`hashFolders`) inclui `id`, `name`,
  `parentId` e `order`, então a **reordenação de pastas é sincronizada** como qualquer
  outra mudança de pastas.
  **Primeira sincronização (sem linha de base de pastas)**: um dispositivo que nunca
  sincronizou tem `foldersHash` vazio (normalizado para o hash do conjunto vazio em
  `db.ts` e `buildPlan`). Isso é tratado como "pastas locais inalteradas" em vez de uma
  mudança local, então um dispositivo novo **puxa as pastas remotas** em vez de gerar um
  conflito espúrio `bothModified`. Antes dessa correção, resolver esse conflito espúrio
  com "manter local" em um dispositivo vazio enviava uma lista de pastas vazia e apagava
  silenciosamente as pastas reais no servidor (`folders/folders.json`).
  **Garantia de commit do manifest (sem sobrescrita silenciosa)**: a linha de base local
  (`cloudSync.notebooks`/`foldersHash`) só avança **depois** que o servidor confirma o
  novo `manifest.json`. Se a gravação do manifest falhar, o `runSync` restaura um
  snapshot da linha de base e do manifest anteriores, de modo que a próxima sincronização
  reavalie o mesmo plano (idempotente) — um manifest desatualizado nunca causa um pull
  silencioso que sobrescreva alterações locais feitas desde a execução com falha.
  **Autocorreção de arquivos remotos ausentes (404)**: quando o manifest lista um
  caderno cujo arquivo está ausente no servidor (ex.: upload interrompido ou manifest
  desatualizado), o `downloadFile` lança um `RemoteFileNotFoundError` tipado (ver
  `src/utils/webdav.ts`) e o loop de pull de cadernos no `runSync` reconcilia em vez de
  gerar erro para sempre — se houver cópia local, ela é reenviada (restaurada) e a
  entrada do manifest é corrigida; se não houver, a entrada fantasma do manifest é
  removida para a próxima sincronização parar de tentar baixá-la.
- **Estado local de sync**: `db.ts` → `cloudSync` (`CloudSyncState`).
- **Orquestração**: `store.ts` → `syncNow()` (guard de reentrância + debounce), `resolveConflicts()`. O `syncNow()` **só avança `settings.cloud.lastSyncAt` quando a execução termina sem erros** (uma sincronização com falha mantém o horário real do "último sync" em vez de fingir que deu certo). A assinatura de auto-sync (debounce de 20s) **enfileira uma sincronização de acompanhamento quando uma mudança chega durante uma sincronização em andamento** (`syncQueued`), para que edições feitas durante a janela de sync não sejam perdidas silenciosamente. O `applySyncChanges()` aplica dados puxados/novos/removidos e **não faz nada quando nada mudou de fato** — só incrementa `dataVersion` (que re-dispara o auto-sync) quando há mudanças reais, evitando um loop infinito de auto-sync no celular.
  **Commit após conteúdo ("sincronizou, mas falta alteração")**: o `syncNow()` aplica o conteúdo puxado (`applySyncChanges`) **antes** de persistir o baseline avançado (`db.putCloudSyncState`). Se a aplicação do conteúdo falhar, o baseline permanece como estava, então a próxima sincronização re-puxa os mesmos cadernos (idempotente) em vez de marcá-los como sincronizados com a cópia local intacta.
- **Design/plano detalhados**: `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md`
  e `docs/superpowers/plans/2026-08-17-sync-bidirecional-plan.md`.
- **Verificação de regressão**: `scripts/verify-sync.ts` (rodar com `npx tsx
  scripts/verify-sync.ts`) exercita `buildPlan` e `runSync` contra um transport fake em
  memória, validando decisões de push/pull/conflito/delete, o rollback da gravação do
  manifest (a linha de base não avança e `lastSyncAt` não é definido), a re-execução
  idempotente após o rollback, uma falha de autenticação exibindo mensagem clara
  deixando o estado de sync intacto, a autocorreção de 404 (restaurar cópia local /
  remover entrada fantasma do manifest), a **regressão do Bug A** (um caderno com
  tombstone não é re-baixado e é excluído na nuvem) e o fluxo de **restauração da
  lixeira** (um caderno que reapareceu localmente após a exclusão remota é reenviado e a
  entrada do manifest volta para `deleted:false`). O `scripts/verify-download.ts`
  adicionalmente valida o comportamento de **retry** (`isConnectionError`/`withRetry`).

---

## 9. Índice de busca de informação

> "Onde está o código que faz X?" — consulte a tabela abaixo.

### Ferramentas de desenho / edição

| Modos de seleção (clique/laço/círculo/quadrado) | `src/components/Toolbar.tsx` (`SelectPanel`) + `Editor.tsx`. Clicar em qualquer lugar dentro da caixa de seleção permite o arraste. |
| Barras de Rolagem (vertical/horizontal) | `Editor.tsx` (`updateScrollbars`, `scroll-v/h`) + `src/styles.css` (`.editor-scrollbar`). Design de alto contraste, interativo e com auto-hide de 1.5s. |
| Mover a tela | `src/components/Editor.tsx` (ferramenta `pan`). Suporta arrastar com mouse/touch ou **manter o atalho configurado pressionado** (padrão: `Alt`) para mover temporariamente. Restrito por `getPanLimits` e `clampPan`. |
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
| Camadas: modelo e helpers (normalização de páginas legadas) | `src/types.ts` (`Layer`, `LayerFolder`, `makeLayer`, `normalizePage`, `getActiveLayer`) |
| Camadas: ações de estado (adicionar/renomear/duplicar/excluir/reordenar/visibilidade/opacidade/lock/ativo/merge) | `src/store.ts` (`addLayer`, `renameLayer`, `duplicateLayer`, `deleteLayer`, `moveLayer`, `moveLayerToFolder`, `setLayerVisible`, `setLayerOpacity`, `setLayerLocked`, `setActiveLayer`, `mergeSelectedLayers`) |
| Pastas de camadas (criar/renomear/excluir/reordenar, mover camada para dentro/fora de pasta, soltar na linha da pasta / zona raiz) | `src/store.ts` (`addLayerFolder`, `renameLayerFolder`, `deleteLayerFolder`, `reorderLayerFolder`, `moveLayerToFolder`) + `src/components/LayersPanel.tsx` (`.layer-folder-row`, `dragFolderIdRef`, `dropIntoFolderRef`, menu "…" da pasta) + `src/types.ts` (`LayerFolder`) |

### Dados e persistência

| Assunto | Arquivo(s) |
|---|---|
| Tipos e defaults (settings, atalhos) | `src/types.ts` |
| CRUD de cadernos/pastas/páginas/modelos | `src/store.ts` |
| IndexedDB (leitura/escrita) | `src/db.ts` |
| Backup manual (exportar/importar JSON, inclui configurações) | `src/utils/backup.ts` + `src/utils/chunkedIo.ts` + `Modals.tsx` (Settings). No celular, a exportação abre o **seletor "Salvar como" do sistema** (`saveBackupFile`) para que o usuário escolha o destino, sempre com **nome com carimbo de data** para nunca sobrescrever um backup existente; a importação usa o seletor de documentos do sistema (`pickBackupFile`, leitura em chunks). No desktop usa os diálogos salvar/abrir do Electron e na web dispara download/input de arquivo. |
| Sistema de Logs | `src/utils/logger.ts`. Armazena eventos e erros do sistema (como falhas de WebDAV) em memória. Os logs são acessíveis via **aba Logs** nas Configurações, permitindo visualizar, copiar e limpar os registros. |
| Clipboard e Seleção | `src/store.ts` (`copySelected`, `pasteClipboard`). Implementa clipboard customizado para seleção com **fallback para sistemas sem suporte à API nativa de Clipboard**. |
| Restaurar tudo (importar backup) | `src/store.ts` (`replaceAllData`) |
| Lixeira local (excluir → lixeira, restaurar, "restaurar da nuvem", excluir definitivamente, purga de 30 dias) | `src/store.ts` (`deleteNotebook`/`deleteFolder`/`deleteSelected` criam entradas `TrashItem`; `restoreFromTrash`, `restoreFromCloud`, `purgeTrashItem`, `runTrashPurge`), `src/db.ts` (`getTrash`/`putTrashItem`/`deleteTrashItem`), `src/types.ts` (`TrashItem`), `src/components/Modals.tsx` (`TrashModal`), `src/components/Sidebar.tsx` (botão da lixeira), `src/uiStore.ts` (modal `'trash'`) |
| Contratos das stores (estado + ações, ver §5.5) | `src/store.ts` (`AppState`), `src/uiStore.ts` (`UiState`), `src/textStore.ts` (`TextUiState`) |

### Nuvem / sincronização

| Assunto | Arquivo(s) |
|---|---|
| Algoritmo de merge e conflitos | `src/utils/sync.ts` |
| Transporte WebDAV + Koofr | `src/utils/webdav.ts`. No Android, `uploadFile` faz stream via plugin local `pick-directory` (`uploadFileStreaming`) e `downloadFile` usa requests Range em chunks (`downloadText` em `http.ts`, decodificado com `decodeCapacitorData` — trata os corpos parseados como JSON que o CapacitorHttp devolve para conteúdo `application/json`) — evita o OOM da bridge para cadernos grandes. |
| Rede Nativa (Android CORS bypass) | `src/utils/http.ts` (`customFetch`, `downloadText`, `decodeCapacitorData`, `isConnectionError`, `withRetry`) — usado por `webdav.ts` e `updateCheck.ts` |
| Resiliência de rede (retry/backoff + mensagem amigável) | `src/utils/http.ts` (`isConnectionError`, `withRetry` — 3 tentativas, backoff 500ms→1s, apenas erros de conexão) + `src/utils/webdav.ts` (`rethrowConnectionError` → `error.networkUnreachable`) |
| Estado local de sync (cloudSync) | `db.ts` + `src/types.ts` (`CloudSyncState`) |
| Orquestração (`syncNow`, `resolveConflicts`, auto-sync) | `src/store.ts` |
| Modal de sincronização / configuração de nuvem | `src/components/Modals.tsx` |
| Modal de conflitos | `src/components/Modals.tsx` (`SyncConflictModal`) |
| Trigger de sync ao abrir | `src/App.tsx` |
| Design document do sync | `docs/superpowers/specs/2026-08-17-sync-bidirecional-design.md` |

### Importação / exportação

| Assunto | Arquivo(s) |
|---|---|
| Importar imagem na página | `Modals.tsx` (`ImportImageModal`) + `store.ts` (`addImageToPage`). Suporta colar da área de transferência via botão. |
| Colar da área de transferência (Editor) | `Editor.tsx` (`onPasteGlobal`). Pressionar **Ctrl+V** em qualquer lugar do editor cola uma imagem da área de transferência na posição do mouse (ou centralizada na página atual). |
| Importar PDF como fundo de página (via criação de página/caderno → "Importar modelo (imagem/PDF)") | `Modals.tsx` (`AddPageModal`/`NewNotebookModal` → `TemplatePicker`, `buildPdfTemplatePage`) + `store.ts` (`createNotebook`, `addPage`, `addPagesFromTemplate`) |
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
| Ocultar barras / painéis | Configurações (**aba Aparência**, `Modals.tsx` `SettingsModal`, seção Aparência) → `settings.hideTopBar`, `settings.hideToolbar`, `settings.hideSidebar`, `settings.hidePageList`; render condicional em `src/App.tsx`; toggles de sidebar/preview na `TopBar.tsx` sempre visíveis (o clique reexibe o painel quando oculto pelas configurações) e **um botão flutuante por barra oculta** em `App.tsx` (`.ui-restore-btn`): barra superior → centro superior (`top-center`, para não sobrepor a barra de ferramentas lateral), ferramentas → meio da borda direita (`right-center`), cadernos/preview → meio da borda esquerda (`left-center`, com `left-center-top`/`left-center-bottom` empilhados quando os dois estão ocultos) |
| Ocultar nº de páginas do caderno | Configurações (**aba Aparência**, seção Aparência) → `settings.hidePageCount`; render condicional do `<span className="page-count">` em `src/components/Sidebar.tsx` |
| Ocultar o cursor da ferramenta | Configurações (**aba Aparência**, seção Aparência) → `settings.hideToolCursor`; usado em `Editor.tsx` para esconder o indicador visual da ferramenta sobre a página |
| Suporte a temas (Escuro/Claro/Sistema) | Configurações (**aba Aparência**) → `settings.theme`; aplicado no `App.tsx` via classes CSS e media queries. |
| Áreas seguras do celular (status bar / notch / gestos) | `index.html` usa `viewport-fit=cover`; `src/styles.css` respeita `env(safe-area-inset-top)` na `.topbar` (altura/padding) e no botão flutuante `.ui-restore-btn.top-center`, e `env(safe-area-inset-bottom)` na `.toolbar` no modo mobile — evita que a barra superior fique coberta/inacessível em celulares com a barra de notificações oculta (edge-to-edge) |
| Barra superior | `src/components/TopBar.tsx`. Contém os toggles de sidebar/preview à esquerda, o título do caderno ao centro, e botões de ação (Importar, Exportar, Sincronizar, Configurações, **Ocultar barras da UI**) à direita. No celular, o lado direito é rolável. |
| Painel de camadas (lateral direita; botão "Camadas" na `TopBar` alterna `layersOpen`) | `src/components/LayersPanel.tsx` + `src/store.ts` (ações de camada e de pastas de camadas) |
| Árvore de pastas/cadernos | `src/components/Sidebar.tsx` (tooltip customizado `.sidebar-name-tooltip` mostra o nome completo de cadernos/pastas ao passar o mouse; `.sidebar-item` dentro das linhas usa `flex: 1 1 auto; min-width: 0` e `.row-menu` com `z-index` para manter o botão "…" clicável mesmo com nomes longos; menu "…" fecha ao clicar fora via listener global de `pointerdown`; conteúdo rolável em `.sidebar-scroll`) |
| Busca de pastas/cadernos por nome | `src/components/Sidebar.tsx` (input de busca `.sidebar-search` no cabeçalho; filtra `folders`/`notebooks` por nome com lista de resultados plana agrupada ao digitar, estado vazio "sem resultados", botão × limpa; clicar em um resultado seleciona o item e expande a pasta pai) |
| Reordenar pastas/cadernos por arrastar (reorder no mesmo nível + mover para dentro de pasta) | `src/components/Sidebar.tsx` (DnD custom via Pointer Events: `onItemPointerDown/Move/Up`, `computeSlot`, `updateDropPosition`, autoscroll, indicador `.sidebar-drop-indicator`, destaque `.drop-target`) + `src/store.ts` (`reorderFolder`/`reorderNotebook` recalculam `order` dos irmãos; `moveFolder`/`moveNotebook` movem para o destino) + campo `order` em `src/types.ts` |
| Seleção múltipla de pastas/cadernos (CTRL/SHIFT no PC, toque longo no touch) | `src/components/Sidebar.tsx` (`toggleSelect`, `selectRange`; timer de ~500ms no `pointerdown` de toque dispara `toggleSelect`; barra `.selection-bar`) + `src/store.ts` (`toggleSelect`, `clearSelection`, `selectedIds`) |
| Redimensionar a barra de cadernos | `src/components/Sidebar.tsx` (handle `.sidebar-resizer` na borda direita, arraste para aumentar/diminuir; largura salva em `settings.sidebarWidth` via `setSettings` no fim do arrasto; limite 160–min(520, 50% da janela); oculto em touch/`pointer: coarse`) |
| Redimensionar o painel de camadas | `src/components/LayersPanel.tsx` (handle `.layers-resizer` na borda **esquerda**, espelho do resizer da barra lateral; largura = `dragWidth ?? settings.layersWidth`, limite 180–min(420, 50% da janela); salva em `settings.layersWidth` via `setSettings` ao soltar; oculto no mobile onde a largura do painel é fixa em 280px) |
| Renomear pasta/caderno (F2) | `src/types.ts` (`DEFAULT_SHORTCUTS.rename` = `f2`), `src/hooks/useShortcuts.ts` (dispara `ink:rename`), `src/components/Sidebar.tsx` (listener de `ink:rename` → `renameNotebook`/`renameFolderName` via modal de prompt; também disponível no menu de contexto "…") |
| Renomear camada / pasta de camadas (F2) | `src/components/LayersPanel.tsx` (listener de `ink:rename` inicia a renomeação inline da pasta selecionada — senão da camada ativa; duplo clique no nome da pasta/camada também renomeia) |
| Renomear título do caderno atual (F2) | `src/components/TopBar.tsx` (listener de `ink:rename` abre o input inline do título quando nem a barra lateral nem o painel de camadas estão abertos; clicar no título também renomeia) |
| Preview de páginas (tamanho fixo das miniaturas, seleção múltipla com CTRL/SHIFT e barra de seleção) | `src/components/PageList.tsx` + `src/renderer/thumbnail.ts` (`.page-thumb-wrap` com `flex-shrink: 0` para não encolher com muitas páginas) |
| Modals (todos) | `src/components/Modals.tsx` + `src/uiStore.ts`; fecham com `Esc`/botão de voltar (evento `ink:esc` → `ModalsHost` chama `close()`; para `prompt`/`confirmDelete` resolve o resolver com `null`) |
| Atualizações de software | `src/utils/updateCheck.ts` (checagem via API do GitHub) + `electron/main.cjs` (electron-updater) + `src/components/Modals.tsx` (`UpdateModal`); verifica automaticamente ao iniciar (`App.tsx`) e permite busca manual nas Configurações; aplicar uma atualização executa o instalador NSIS **silenciosamente** (`quitAndInstall(true, true)`) para que os diálogos interativos de "fechar o app" nunca bloqueiem o update |
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
| Normalização/registro de atalhos | `src/hooks/useShortcuts.ts` (`initGlobalShortcuts` desabilita automaticamente os atalhos quando um modal está aberto ou o usuário está digitando em campos de texto para evitar interferência). |
| Rótulos e normalização de teclas | `src/utils/shortcuts.ts` |
| Atalhos de ocultar barras / rotação livre / modos de seleção (`toggleHideToolbar`, `toggleHideTopBar`, `toggleFreeRotate`, `selectClick`, `selectFree`, `selectCircle`, `selectRect`) | `src/types.ts` (`DEFAULT_SHORTCUTS`) + `src/hooks/useShortcuts.ts`. Nota: o atalho de `pan` é tratado exclusivamente como um modificador "segurar para ativar" no `Editor.tsx` e não altera o estado global da ferramenta. |
| UI de configuração de atalhos | `Modals.tsx` (`SettingsModal` → aba "Atalhos"). Permite busca por nome, mapeamento de teclas (incluindo modificadores isolados como `Alt`) e **restauração de atalhos padrão** de forma independente das demais configurações. |
| Rótulos e normalização de teclas | `src/utils/shortcuts.ts` (`normalizeKey` trata combinações e teclas modificadoras isoladas) |

---

## 10. Convenções e padrões do código

- **Estado**: tudo que é compartilhado passa por Zustand stores; componentes leem com
  `useAppStore((s) => s.xxx)` e escrevem via ações da store (nunca mutando diretamente sem
  passar pela persistência).
- **Persistência**: toda alteração de dados persiste via `db.*` (IndexedDB é o store
  primário). Dentro do editor, edições de canvas persistem via `schedulePersist()`
  (`Editor.tsx`), **debounced (400ms)** persistindo o caderno vivo atual no momento do
  fire — edições de alta frequência (traços de desenho) são gravadas no máximo uma vez por
  janela com o estado mais recente, em vez de um `persistNotebook` completo a cada release
  do ponteiro.
- **Comunicação UI ↔ canvas**: via `CustomEvent` (`ink:*`), nunca props profundas.
- **Performance de Renderização**: O `Editor.tsx` utiliza um **loop de requestAnimationFrame (RAF)** para desacoplar o desenho dos eventos de ponteiro, garantindo uma taxa de quadros estável. Atualizações de alta frequência (como a posição do cursor da ferramenta) são feitas via **manipulação direta do DOM** usando refs para evitar re-renders do React. Dispositivos de entrada de alta precisão (como mesas digitalizadoras) são suportados via **eventos coalescidos** (`getCoalescedEvents`) para traços o mais fluidos possível.
- **Canvas**: `Editor.tsx` é o dono do motor; `PageCanvas` só renderiza e faz hit tests.
- **Funções puras de desenho** (for thumbnail/export) vivem em `renderer/drawUtils.ts` e
  reutilizam `utils/drawText.ts`.
- **Idioma da UI**: pt-BR por padrão (textos de botões/modais em português) com suporte a inglês via
  `src/i18n/` (`t()` + `useI18n()`); strings novas entram nos dicionários `ptBR.ts`/`en.ts`.
- **ID de entidades**: `newId()` de `src/types.ts` (usa `crypto.randomUUID()` quando
  disponível e cai para `uid()` — timestamp base36 + aleatório — em contextos inseguros
  como acesso via IP/HTTP, onde `crypto.randomUUID` does not exist). Não use
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
| `src/components/Modals.tsx` | **Todos os modais**: títulos, labels, botões, dicas, placeholders, opções | "Configurações", "Nova página", "Exportar anotações", "Sincronização em nuvem", "Conflitos de sincronização", "Modelo da primeira página", "Português (Brasil)", "Testar conexão", "Também da nuvem", "Ocultar o cursor da ferramenta" (`modal.hideToolCursor` + `modal.hideToolCursorHint`), dicas de importação, **lixeira** (`modal.trashTitle`, `modal.trashEmpty`, `modal.trashRestore`, `modal.trashRestoreCloud`, `modal.trashPurgeTitle`, `modal.trashPurgeConfirm`, `modal.trashPurgeNote`, `modal.trashKindNote`, `modal.trashKindFolder`, `modal.trashRestoreCloudHint`), dicas de importação |
| `src/components/Sidebar.tsx` | Menus de contexto, prompts, confirmações, títulos de seção, **barra de busca** | "Meus Cadernos", "Sem pastas", "Nova pasta", "Renomear", "Copiar para pasta...", "Mover para pasta...", "Duplicar", "Excluir", "Excluir a nota ...?", "Arraste para redimensionar", "Arraste para reordenar. Em touch, toque longo seleciona vários itens." (`sidebar.dragHint`), "Lixeira" (`sidebar.trash`), **"Buscar pastas e cadernos..." (`sidebar.searchPlaceholder`), "Pastas" (`sidebar.searchFolders`), "Cadernos" (`sidebar.searchNotebooks`), "Nenhuma pasta ou caderno encontrado" (`sidebar.searchNoResults`), "Limpar busca" (`sidebar.searchClear`)** |
| `src/components/TopBar.tsx` | Tooltips, título do app, placeholder | "Alternar barra lateral", "Mostrar/ocultar preview das páginas", "Camadas" (`topbar.toggleLayers`), "Ocultar a barra superior", "Ocultar a barra de ferramentas", "Mostrar a barra superior", "Mostrar a barra de ferramentas", "Mostrar a barra de cadernos", "Mostrar o preview de páginas", "Tela cheia (F11)", "Mamaco Notes", "Selecione ou crie um caderno" |
| `src/components/PageList.tsx` | Título, placeholder de busca, mensagens vazias, barra de seleção múltipla de páginas | "Páginas", "Ir para a página (nº)...", "Nenhuma página encontrada", "{{count}} página(s) selecionada(s)", "Limpar seleção de páginas", "Duplicar páginas selecionadas", "Excluir {{count}} página(s) selecionada(s)?" |
| `src/components/LayersPanel.tsx` | Título do painel, barra de ações (nova camada / nova pasta / duplicar / excluir / mesclar), slider de opacidade da camada ativa, rodapé "Fundo", tooltips de visibilidade/lock, **strings de UX das pastas** | "Camadas", "Adicionar camada", "Duplicar camada", "Excluir camada", "Mesclar camadas", "Mesclar {{count}} camadas", "Fundo", "Fundo da página", "Opacidade", "Renomear camada", "Camada {{n}}" (nomes padrão via `layers.layerN` quando o nome casa com `^Camada \d+$`), "Mostrar/ocultar camada", "Travar camada", "Destravar camada", **"Nova pasta de camadas" (`layers.newFolder`), "Renomear pasta" (`layers.renameFolder`), "Excluir pasta" (`layers.deleteFolder`), "Excluir a pasta \"{{name}}\"? As camadas dentro della serão movidas para a raiz." (`layers.deleteFolderConfirm`), "Nome da nova pasta de camadas:" (`layers.newFolderPrompt`), "Novo nome da pasta de camadas:" (`layers.renameFolderPrompt`), "Arrastar para redimensionar" (`layers.resizePanel`), "Sem camadas" (`layers.folderEmpty`)** |
| `src/components/Editor.tsx` | Placeholder do texto inline, tooltips de zoom | "Digite o texto...", "Diminuir zoom", "Redefinir zoom / recentralizar", "Recentralizar página" |
| `src/utils/shortcuts.ts` | Rótulos dos atalhos exibidos em Configurações (`shortcutLabel`) | "Caneta", "Borracha", "Desfazer", "Aumentar zoom", "Adicionar página", "Excluir página", "Tela cheia", etc. |
| `src/store.ts` | Sufixo de duplicação de itens | `t('copySuffix')` → `' (cópia)'` / `' (copy)'` |
| `src/utils/sync.ts` | Mensagens de erro do merge | `'caderno inválido'`, `'caderno remoto inválido'` |
| `src/utils/webdav.ts` | Mensagens de erro/status da conexão WebDAV | "Servidor Koofr não reconhecido.", "Conexão OK: ...", dica de URL do Koofr |
| `electron/main.cjs` | Menu da janela, títulos de diálogos, filtros de arquivo, logs | "Arquivo", "Editar", "Exibir", "Sair", "Desfazer", "Refazer", "Recortar", "Copiar", "Colar", "Selecionar tudo", "Backup Mamaco Notes", "JSON" |

### 11.3 Configuração e metadados por plataforma

| File | O que traduzir |
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
