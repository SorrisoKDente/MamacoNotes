# Plano de Implementação — Camadas (estilo Photoshop) no Mamaco Notes

Data: 2026-08-21
Base: `docs/superpowers/specs/2026-08-21-camadas-design.md` (aprovado)

## Visão geral

Refatorar o modelo de página de listas planas (`strokes`/`images`/`texts`) para uma lista
de **camadas** (`layers`), cada uma agrupando os três tipos de conteúdo, com visibilidade,
opacidade e lock. Adicionar painel lateral direito de camadas com operações de
criar/renomear/duplicar/excluir/reordenar, mostrar/ocultar, opacidade, lock e merge de
camadas selecionadas. Edição (desenhar/borracha/seleção/mover) age apenas na camada ativa.

## Ordem de trabalho e estratégia

O refactor de tipos quebra o typecheck até todas as referências serem migradas. Por isso o
plano é executado em **fases**, e o `npm run typecheck` só passa a compilar integralmente
a partir da Fase 6. **Não rode `npm run build` antes da Fase 6.** Recomenda-se rodar
`npm run typecheck` ao final de cada fase apenas para listar os pontos ainda pendentes
(esperado até a Fase 5).

---

## Fase 1 — Tipos e helpers (`src/types.ts`)

Objetivo: introduzir o modelo de camadas e os helpers de normalização.

1. Adicionar a interface `Layer`:
   ```ts
   export interface Layer {
     id: string
     name: string
     visible: boolean
     opacity: number   // 0..1
     locked: boolean
     strokes: Stroke[]
     images: ImageElement[]
     texts: TextElement[]
   }
   ```
2. Alterar `Page` (linha 74):
   - **remover** `strokes`, `images`, `texts`;
   - **adicionar** `layers: Layer[]` e `activeLayerId: string | null`.
3. Adicionar `makeLayer(name: string, opts?: { strokes?: Stroke[]; images?: ImageElement[]; texts?: TextElement[] }): Layer`
   — `id: newId()`, `visible: true`, `opacity: 1`, `locked: false`.
4. Alterar `makePage` (linha 345): criar 1 camada `makeLayer('Camada 1')` e
   `activeLayerId` = id dessa camada. O nome default "Camada 1" deve vir do i18n na hora de
   exibir (não usar `t()` dentro de `types.ts` — módulo plano). Ver nota na Fase 7.
5. Adicionar `normalizePage(page: Partial<Page>): Page` (função pura):
   - `layers`: se ausente/vazio, cria 1 camada a partir de `page.strokes ?? []`,
     `page.images ?? []`, `page.texts ?? []`;
   - por camada: `name ?? 'Camada 1'`, `visible ?? true`, `opacity ?? 1`,
     `locked ?? false`, `strokes ?? []`, `images ?? []`, `texts ?? []`;
   - `activeLayerId`: se nulo ou id não encontrado em `layers`, usa a última camada;
   - preserva `template/width/height/rotation/backgroundColor/pdf/createdAt/updatedAt`;
   - **remove** os campos planos legados (`strokes/images/texts`) do resultado.
6. Adicionar `getActiveLayer(page: Page): Layer` — retorna a camada apontada por
   `activeLayerId` ou a última.

**Verificação**: `npm run typecheck` → erros esperados em todo o código (listam o que a
Fase 2–6 precisa corrigir).

---

## Fase 2 — Clones e normalização nas stores (`src/store.ts`, `src/utils/sync.ts`)

Objetivo: todos os pontos de clonagem/normalização de página ficarem layer-aware.

### `src/store.ts`

1. `clonePage` (linha 34): clonar `layers` em profundidade (pontos dos traços copiados,
   imagens/textos/camadas espalhados), preservando ids.
2. Adicionar `cloneLayerWithNewIds(layer: Layer): Layer` — como `cloneStrokeIds`/
   `cloneImageIds`/`cloneTextIds`, mas por camada (novos ids para a camada e para o
   conteúdo). Usado em duplicações.
3. `cloneNotebookForCopy` (linha 55) e `cloneTemplatePages` (linha 74): trocar a clonagem
   de arrays planos por `layers.map(cloneLayerWithNewIds)`.
4. `duplicateSelectedPages` (linha 519) e `duplicatePage` (linha 1038): idem.
5. Normalização de dados antigos — substituir os blocos `{ ...p, texts: p.texts ?? [],
   backgroundColor: ... }` por `normalizePage(p)` em:
   - `init` (linhas 419–426);
   - `applySyncChanges` (linha ~321);
   - `replaceAllData` (linhas 1344–1351).
6. `addImageToPage` (linha 1263): `page.images.push(el)` (linha 1294) → resolve a camada
   ativa (`getActiveLayer(page)`) e faz `layer.images.push(el)`.
   - Se a camada ativa estiver **travada**, abortar a inserção (no-op).
7. `addPdfToPage` (linha 1300): inalterado (PDF é fundo da página, fora das camadas).

### `src/utils/sync.ts`

8. `cloneNotebookAsCopy` (linha 82): aplicar `normalizePage` nas páginas remotas antes de
   clonar e clonar `layers` com novos ids (mesmo padrão de `cloneLayerWithNewIds`).

**Verificação**: `npm run typecheck` — erros devem reduzir (referências a `page.strokes`
em canvas/editor/export/thumbnail ainda quebram).

---

## Fase 3 — Migração do IndexedDB (`src/db.ts`)

1. `DB_VERSION = 5` (linha 5).
2. Adicionar `migrateLayers(db)` no padrão de `migrateOrders` (linha 45):
   - transação readwrite em `notebooks`;
   - `store.openCursor()` e, para cada caderno, `normalizePage` em todas as páginas;
   - `put` de volta; `tx.oncomplete` resolve. Idempotente (páginas já com `layers` não são
     alteradas).
3. Em `openDb` (`onupgradeneeded`/`onsuccess`, linhas 68–98): além de `needsOrderMigration`,
   marcar `needsLayersMigration = true` e rodar `migrateLayers(db)` depois de
   `migrateOrders(db)`. Importar `normalizePage` de `./types`.

**Verificação**: abrir o app com banco v4 → páginas antigas ganham 1 camada com o conteúdo
preservado.

---

## Fase 4 — Renderização (`canvas.ts`, `drawUtils.ts`, `thumbnail.ts`, `export.ts`)

### `src/renderer/canvas.ts`

1. Criar método privado `renderPageContent(ctx, page, drawCurrentStroke)` reutilizado por
   `renderSinglePage` (linha 219) e `renderContinuous` (linha 258):
   - iterar `page.layers` em ordem;
   - para cada camada: `if (!layer.visible) continue`; `ctx.save()`;
     `ctx.globalAlpha = layer.opacity`; desenhar `images` → `texts` → `strokes`;
     `ctx.restore()`;
   - desenhar `currentStroke` por último (apenas na página corrente).
2. `selectionBounds` (linha 747), `drawStrokeBoxes` (linha 940), `drawImageBoxes`
   (linha 957) e o bloco de textos (~linha 983): iterar `page.layers` (a seleção só contém
   ids da camada ativa, então filtrar por `sel` como hoje).
   - Importante: não mudar semântica — apenas a fonte dos arrays passa a ser `layers`.

### `src/renderer/drawUtils.ts`

3. Adicionar `drawLayer(ctx, layer: Layer, scale = 1)`:
   `ctx.save(); ctx.globalAlpha = layer.opacity;` desenha imagens→textos→traços (reusa
   `drawStroke`, `drawTextOnCanvas`; imagens precisam ser desenhadas por quem chama se
   dependerem de carregamento assíncrono — ver export/thumbnail); `ctx.restore()`.

### `src/renderer/thumbnail.ts`

4. `renderThumbnail` (linhas 32–40): trocar por iteração de camadas visíveis
   (`ctx.save(); ctx.globalAlpha = layer.opacity`).
5. `loadImagesSequentially` (linha 73): o `page.images.find(...)` deve buscar a imagem em
   **todas** as camadas (função auxiliar local que percorre `page.layers`).

### `src/utils/export.ts`

6. `renderPageToCanvas` (linhas 4–52): reescrever o fluxo para desenhar por camada:
   - template/fundo e PDF no nível da página (como hoje);
   - para cada camada visível: `ctx.save(); ctx.globalAlpha = layer.opacity`; carregar as
     imagens daquela camada (aguardar), desenhar imagens → traços → textos;
     `ctx.restore()`.
   - A ordem de sub-desenho vira **imagens → textos → traços** (consistente com o canvas).
   - `page.images.find` (linha 23) passa a buscar na camada corrente.

**Verificação**: `npm run typecheck` — editor e toolbar ainda quebrados (Fase 5–6).

---

## Fase 5 — Store: estado de UI e ações de camada (`src/store.ts`)

### Estado de UI

1. `AppState`: adicionar `layersOpen: boolean`, `toggleLayers(): void`,
   `setLayersOpen(open: boolean): void` (padrão de `sidebarOpen`/`toggleSidebar`,
   linhas 204–218).
2. Estado inicial `layersOpen: false` (linha ~406).

### Ações de camada (adicionar à interface `AppState` + implementação)

Todas seguem o padrão: resolve notebook selecionado + página atual, `get().pushUndo()`,
muta `page.layers` e `page.activeLayerId`, `page.updatedAt = Date.now()`, e
`await updateNotebookStorage(notebook)`. Se a página não existir ou tiver 0 camadas, no-op.

- `addLayer(): Promise<void>` — cria `makeLayer(nome padrão)` acima da ativa (ou no fim) e
  torna ativa.
- `renameLayer(index, name): Promise<void>` — `name.trim() || nome atual`.
- `duplicateLayer(index): Promise<void>` — `cloneLayerWithNewIds`, insere acima da original
  e torna ativa.
- `deleteLayer(index): Promise<void>` — **bloqueado se `layers.length <= 1`**; remove; a
  ativa passa para a camada mais próxima (preferir a de baixo; se removida foi a de baixo,
  a de cima).
- `moveLayer(from, to): Promise<void>` — splice com clamps.
- `setLayerVisible(index, visible): Promise<void>`.
- `setLayerOpacity(index, opacity): Promise<void>` — clamp 0..1.
- `setLayerLocked(index, locked): Promise<void>`.
- `setActiveLayer(id): Promise<void>` — valida o id; o **Editor** limpa a seleção ao notar
  a troca (Fase 6).
- `mergeSelectedLayers(indices: number[]): Promise<void>` — exige ≥ 2 índices válidos;
  unir camadas ordenadas (base→topo) num único conteúdo; resultado ocupa a posição da mais
  **acima** selecionada; `name`/`visible`/`opacity` da mais acima; `locked: false`; camadas
  não selecionadas preservam ordem; resultado vira a ativa.

**Verificação**: `npm run typecheck` — editor/toolbar ainda pendentes.

---

## Fase 6 — Editor (`src/components/Editor.tsx`)

Objetivo: toda edição passa a operar sobre a **camada ativa**; camada travada bloqueia
modificação de conteúdo.

### Helper de camada ativa

1. Importar `getActiveLayer` (ou criar helper local `activeLayer()` que lê
   `pageRef.current.activeLayerId`). Criar `activeLayerRef`/derivar no render.

### Substituir acessos a `page.strokes/images/texts` pelos arrays da camada ativa

Padrão: onde hoje se usa `pg.strokes`, `pg.images`, `pg.texts` (ou `page.*`), usar
`layer.strokes` etc. com `layer = getActiveLayer(pg)`.

Pontos mapeados (usar `grep -n 'page\.strokes\|page\.images\|page\.texts\|pg\.strokes\|pg\.images\|pg\.texts' src/components/Editor.tsx` para não perder nenhum):

- Linha 192 — `engine.page.images.find(...)` (limpeza do `selectedImageId`): usar camada
  ativa.
- Linhas 700–780 — `computeDelimitedSelection` (`pg.texts`, `pg.strokes`, `pg.images`,
  `pg.strokes = nextStrokes`, `pg.images[idx]`): usar camada ativa.
- Linhas ~860–1020 — mover/pastar/cortar seleção (`pg.strokes.push(...newStrokes)`,
  `pg.strokes = pg.strokes.filter(...)`, `pg.strokes = pg.strokes.map(...)`,
  `from.strokes`, `to.strokes`): usar camada ativa (from/to = camada ativa).
- Linhas ~1160–1190 — `eraseSegment`/`eraseAtPage` (`pg.strokes = next`): camada ativa.
- Linhas ~1246 — `engine.endStroke()` (no `onPointerUp`).
- Linhas ~1370–1650 — hit tests / seleção (`page.texts.find`, `page.strokes.find`,
  `page.images.find`, `engine.hitTestTexts(page.texts, ...)`): camada ativa.
- Linha ~1896 — `page.texts.find` (edição de texto existente).
- Linha ~2077 — `drawPage.strokes.push(stroke)` (fim do traço): `getActiveLayer(drawPage)
  .strokes.push(...)`.
- Linha ~2317 — restaurar snapshot delimitado (`pg.strokes = pendingSnap.strokes`).
- Linha ~1035–1130 — `commitDraftAt`/`commitInlineText` → `activeLayer.texts.push(...)`.
- Linha ~2273 — inserção central de texto.

### Lock (camada travada)

2. No `onPointerDown` (início de gesto), antes de iniciar `draw`/`erase`/`region-draw`/
   `select-move` etc.: se a ferramenta modifica conteúdo **e** `getActiveLayer(page)
   .locked === true`, **não iniciar o drag** (retornar; pan/zoom continuam permitidos).
   Ferramentas bloqueadas: `pen`, `highlighter`, `eraser`, `text` (inserção), `select`
   (seleção/mover/resize/rotate). Texto já existente de camada travada também não pode ser
   editado/removido.
3. `commitDraftAt`/`commitInlineText` e `addImageToPage` (store, já na Fase 2) também
   checam o lock.

### Limpar seleção ao trocar de camada ativa

4. Criar `prevActiveLayerIdRef`. Num efeito que roda quando a página/`dataVersion` muda:
   se `activeLayerId` mudou, `selectionRef.current = { strokes: new Set(), images:
   new Set(), texts: new Set() }`, `selectionRegionRef.current = null`,
   `setSelectedImageId(null)` e `requestRender()`.

### Ferramentas/texto

5. Conferir painéis do `Toolbar.tsx` (não devem exigir mudança, pois a seleção vem do
   Editor via `ink:image-selected` etc.). Revisar apenas se algo ler `page.strokes`.

**Verificação**: `npm run typecheck` deve passar a compilar (pode restar algum ponto
esquecido — o typecheck aponta).

---

## Fase 7 — i18n (`src/i18n/ptBR.ts`, `src/i18n/en.ts`)

Adicionar chaves nos dois dicionários (pt-BR fonte de verdade):

```
layers.panelTitle       "Camadas"            "Layers"
layers.add              "Adicionar camada"   "Add layer"
layers.duplicate        "Duplicar camada"    "Duplicate layer"
layers.delete           "Excluir camada"     "Delete layer"
layers.merge            "Mesclar camadas"    "Merge layers"
layers.mergeCount       "Mesclar {{count}} camadas"  "Merge {{count}} layers"
layers.background       "Fundo"              "Background"
layers.backgroundHint   "Fundo da página"    "Page background"
layers.opacity          "Opacidade"          "Opacity"
layers.rename           "Renomear camada"    "Rename layer"
layers.layerN           "Camada {{n}}"       "Layer {{n}}"
layers.toggleVisible    "Mostrar/ocultar camada"  "Show/hide layer"
layers.lock             "Travar camada"      "Lock layer"
layers.unlock           "Destravar camada"   "Unlock layer"
topbar.toggleLayers     "Camadas"            "Layers"  (tooltip do botão na TopBar)
```

> **Nota sobre nomes padrão**: o default "Camada 1" é gerado em `types.ts` (módulo plano,
> sem `t()`). O painel deve exibir `t('layers.layerN', { n })` **somente quando** o nome
> for o default gerado (ou sempre ao criar, gravando o nome já traduzido no momento da
> criação via parâmetro). Decisão: `addLayer`/`normalizePage` gravam `"Camada {{n}}"` como
> string base e o painel substitui `{{n}}` por `t(...)` na exibição quando o nome casa com
> o padrão `^Camada \d+$`. Implementar na `LayersPanel` (Fase 8).

---

## Fase 8 — Painel de camadas, TopBar, App e CSS

### Novo `src/components/LayersPanel.tsx`

- Store: lê `notebook`, `currentPageIndex`, `dataVersion` (re-render), ações de camada,
  `getActiveLayer`/`normalizePage` (via `types`).
- Layout:
  - **Barra de ações** (topo): botões nova / duplicar / excluir / mesclar (desabilitado com
    < 2 selecionadas) + label e **slider de opacidade** da camada ativa (0–100 → 0..1).
  - **Lista** (ordem topo → base, i.e. `layers` invertido):
    - item com: olho (visibilidade), cadeado (lock), nome (com destaque da ativa);
    - clique = `setActiveLayer` (e seleção única para merge: CTRL/Meta alterna, SHIFT faixa,
      toque longo alterna no touch — copiar padrões de `Sidebar.tsx`);
    - duplo-clique no nome = edição inline (input autoFocus, Enter/blur confirma → `renameLayer`);
    - **arrastar para reordenar** via Pointer Events (copiar padrão de `Sidebar.tsx`:
      `computeSlot`/indicador `.drop-indicator`).
  - **Rodapé**: item fixo "Fundo" (com `layers.backgroundHint`), não selecionável.
- Estado local: `selectedLayerIds: string[]` (para merge), id da camada sendo renomeada,
  drag de reordenação.
- Ao trocar de página/caderno, limpar `selectedLayerIds`.

### `src/components/TopBar.tsx`

- Adicionar botão (padrão dos existentes, linhas 43–84) com `title={t('topbar.toggleLayers')}`
  e ícone novo (reusar classe CSS), chamando `toggleLayers()`; estado `layersOpen` via store.

### `src/App.tsx`

- Renderizar `{layersOpen && <LayersPanel />}` à direita do `editor-area` (dentro de
  `workspace`, antes ou depois do `Toolbar`).
- Mobile: incluir `layersOpen` no backdrop (`drawer-backdrop` fecha ao tocar fora) —
  ajustar condição das linhas 113–121.

### `src/styles.css`

- Estilos: `.layers-panel` (largura ~260px, borda, scroll), `.layer-item` (ativo/travado/
  selecionado), `.layer-eyeball`, `.layer-lock`, `.layer-opacity`, `.layer-actions`,
  `.layer-footer`, `.drop-indicator`.

---

## Fase 9 — Documentação (`docs/PROJECT_STRUCTURE.md`)

Atualizar na mesma mudança:

1. **§4 Mapa de arquivos**: adicionar `src/components/LayersPanel.tsx`.
2. **§5.1 Modelo de dados**: `Page.layers`, `Layer`, `activeLayerId`; nota da migração
   legada.
3. **§5.2 Persistência**: `DB_VERSION` 4 → 5 + `migrateLayers`.
4. **§5.5 Contratos**: novas ações de camada + `layersOpen`/`toggleLayers`/`setLayersOpen`.
5. **§6 Motor de desenho**: ordem de renderização por camada (visibilidade/opacidade).
6. **§9 Índice de busca**: linha para "Camadas / painel de camadas" apontando para
   `LayersPanel.tsx` + ações na store.
7. **§11 Tradução**: strings novas de `layers.*`/`topbar.toggleLayers`.

---

## Fase 10 — Verificação final

1. `npm run typecheck` — sem erros.
2. `npm run build` — OK.
3. Testes manuais (Windows/Linux/Web/Android):
   - migração de banco v4 (arrays planos) → 1 camada por página, conteúdo preservado;
   - backup/sync antigos normalizados ao importar;
   - desenhar em camadas diferentes (empilhamento correto), ocultar, opacidade 0–100%,
     reordenar por arraste, renomear por duplo-clique;
   - travar/destravar (bloqueia desenho/borracha/seleção/mover; permite renomear/reordenar/
     visibilidade/opacidade/merge);
   - mesclar 2+ camadas selecionadas (nome/posição/opacidade, resultado destravado);
   - borracha/seleção/mover só na camada ativa; troca de camada limpa seleção;
   - não excluir a última camada;
   - exportar PNG/PDF e thumbnails com visibilidade/opacidade corretas;
   - undo/redo de operações de camada;
   - mobile (painel, toque longo, backdrop fecha painel).

## Riscos e mitigação

- **Editor é o arquivo maior (~3500 linhas)**: os acessos a `page.strokes/images/texts`
  são o ponto crítico. Mitigação: o helper `getActiveLayer` concentra a resolução; usar o
  typecheck como lista de pendências e o grep acima como conferência.
- **Assíncrono de imagens em export/thumbnail**: agrupar por camada para aplicar
  `globalAlpha` corretamente.
- **Sync com dados antigos**: `normalizePage` em todos os pontos de entrada (db/store/sync)
  garante compatibilidade sem mudar o `SyncManifest`.
- **Performance de renderização com muitas camadas**: custo é linear no total de elementos
  (igual ao atual); opacidade por camada é só um `save/restore` por camada.

## Critério de conclusão

Typecheck e build limpos, migração validada, checklist manual da Fase 10 executado e
`docs/PROJECT_STRUCTURE.md` sincronizado com o código.
