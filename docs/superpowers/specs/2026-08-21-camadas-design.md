# Design — Camadas (estilo Photoshop) no Mamaco Notes

Data: 2026-08-21
Status: aprovado (design revisado e aceito)

## 1. Objetivo

Adicionar **camadas de conteúdo** por página, no modelo de apps de desenho/edição de
imagem (Photoshop/Procreate): cada página passa a ter uma lista ordenada de camadas, cada
camada é um contêiner que agrupa traços, imagens e textos. O usuário pode criar,
renomear, duplicar, excluir, reordenar, ocultar, ajustar opacidade e mesclar camadas
selecionadas.

## 2. Requisitos (decisões aprovadas)

1. **Modelo**: cada camada agrupa **todos** os tipos de conteúdo (traços, imagens,
   textos) — não camadas por tipo.
2. **Operações**: criar, renomear, duplicar, excluir, reordenar (arrastar), mostrar/ocultar
   (visibilidade), opacidade por camada, **travar/destravar camada (lock)** e **mesclar
   camadas selecionadas**.
3. **Alcance da edição**: caneta/marcador/texto/imagem entram na camada ativa. Borracha,
   seleção, mover, redimensionar e rotacionar agem **apenas sobre a camada ativa**. Uma
   camada **travada** não pode receber conteúdo nem ser editada (desenhar, borracha,
   seleção, mover, redimensionar, rotacionar) — mas continua podendo ser renomeada,
   reordenada, duplicada, excluída, ocultada, ter opacidade ajustada, tornar-se ativa e
   participar de um merge.
4. **UI**: painel lateral **direito** fixo, alternado por botão na barra superior.
5. **Merge**: mesclar duas ou mais camadas selecionadas numa só.
6. **Fundo**: exibido como **item fixo** no rodapé do painel (cor de fundo, template,
   PDF), não selecionável nem mesclável.

## 3. Modelo de dados

### 3.1 Tipo `Layer` (novo, em `src/types.ts`)

```ts
export interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number      // 0..1
  locked: boolean
  strokes: Stroke[]
  images: ImageElement[]
  texts: TextElement[]
}
```

### 3.2 `Page` (alterado, em `src/types.ts`)

- **Adiciona**: `layers: Layer[]` e `activeLayerId: string | null`.
- **Remove**: os arrays planos `strokes`, `images`, `texts`.

Regras:

- Ordem do array `layers`: **índice 0 = base** (desenhada primeiro), **último = topo**.
  O painel exibe na ordem inversa (topo primeiro), igual ao Photoshop.
- Dentro de cada camada mantém-se a ordem de sub-desenho atual: **imagens → textos →
  traços**. Como as camadas são desenhadas como uma unidade, uma camada superior cobre
  totalmente uma inferior, independente do tipo de conteúdo (comportamento correto de
  camadas).
- Fundo da página (cor de fundo, template, PDF) **continua no nível da página**, abaixo de
  todas as camadas. Não é uma `Layer`.
- `activeLayerId` persiste a camada ativa no dado; fallback ao validar: se nulo/ausente ou
  id inexistente, usa a última camada do array.

### 3.3 Fábricas e helpers (em `src/types.ts`)

- `makePage(...)`: passa a criar uma página com **uma camada padrão** `"Camada 1"`
  (`visible: true`, `opacity: 1`, `locked: false`, arrays vazios) e `activeLayerId`
  apontando para ela.
- `makeLayer(name?, index?)`: fábrica de `Layer`.
- `normalizePage(page): Page` — função pura que:
  - se `page.layers` ausente/vazio, constrói uma camada única a partir dos arrays planos
    legados (`strokes`/`images`/`texts`, com `?? []`);
  - aplica normalização defensiva em cada camada: `name ?? 'Camada 1'`,
    `visible ?? true`, `opacity ?? 1`, `locked ?? false`, `strokes ?? []`,
    `images ?? []`, `texts ?? []`;
  - valida `activeLayerId` (fallback para a última camada);
  - remove os campos planos legados do objeto resultante.
  - Fica em `types.ts` (sem imports, sem risco de ciclo) para ser usada por db/store/sync.

## 4. Migração e normalização de dados

- `src/db.ts`: `DB_VERSION` **4 → 5**. Em `onupgradeneeded`, rodar `migrateLayers()`
  (idempotente): percorrer a object store `notebooks` e reescrever cada página com
  `normalizePage`. Nenhuma object store nova; os dados antigos (arrays planos) são
  convertidos em uma camada única.
- `src/store.ts`:
  - `init`, `applySyncChanges`, `replaceAllData` e os pontos atuais de normalização
    (`texts ?? []` etc.) passam a usar `normalizePage`.
  - `clonePage` / `cloneStrokeIds` / `cloneImageIds` / `cloneTextIds` passam a clonar
    `layers` (deep).
  - `SyncManifest`/algoritmo de sync não mudam de versão (camadas viajam dentro do JSON da
    página; dados antigos são normalizados na leitura).
- `src/utils/sync.ts`: no caminho de conflito **keep both** (hoje regenera ids de
  traços/imagens/textos), iterar as camadas em vez dos arrays planos.

## 5. Renderização

- `src/renderer/canvas.ts` (`renderSinglePage` e `renderContinuous`):
  - desenhar fundo (template/backgroundColor) e PDF no nível da página (como hoje);
  - iterar `page.layers` em ordem; para cada camada **visível**:
    `ctx.save()` → `ctx.globalAlpha = layer.opacity` → desenhar `images` → `texts` →
    `strokes` → `ctx.restore()`;
  - traço atual (`currentStroke`) continua desenhado por cima, na camada ativa.
- `src/renderer/drawUtils.ts`: novo helper `drawLayer(ctx, layer, scale)` (aplica
  `globalAlpha` e desenha imagens→textos→traços) para reuso em thumbnail/export.
- `src/renderer/thumbnail.ts`: desenhar por camada (visibilidade + opacidade).
- `src/utils/export.ts` (`renderPageToCanvas`): desenhar por camada; o carregamento
  assíncrono de imagens (dataUrl) deve ser agrupado por camada para aplicar a opacidade
  correta da camada. Ordem de sub-desenho passa a ser **imagens → textos → traços**
  (consistente com o canvas).

## 6. Store (Zustand) — estado e ações

- **Estado**: `Page.activeLayerId` persiste a camada ativa (no dado da página, não em store
  separada — simples e sobrevive a reload). Estado de UI `layersOpen: boolean` (abrir/fechar
  o painel) adicionado ao estado principal, junto de `sidebarOpen`/`pageListOpen`.

- **Ações novas** (todas operam sobre a página atual via `updatePage` → `pushUndo` +
  persistência existentes):
  - `addLayer()` — cria camada acima da ativa e torna ativa.
  - `renameLayer(index, name)`.
  - `duplicateLayer(index)` — duplica (deep) acima da original e torna ativa.
  - `deleteLayer(index)` — **bloqueado quando há apenas 1 camada**; ao excluir, a ativa
    passa para a camada mais próxima.
  - `moveLayer(from, to)` — reordena no array.
  - `setLayerVisible(index, visible)`.
  - `setLayerOpacity(index, opacity)` — clamp 0..1.
  - `setLayerLocked(index, locked)` — alterna o lock.
  - `setActiveLayer(id)` — **limpa a seleção corrente** (o Editor escuta e limpa a
    seleção do canvas).
  - `mergeSelectedLayers(indices)` — exige ≥ 2 camadas selecionadas:
    - conteúdo unido em ordem (base primeiro, topo por último);
    - resultado ocupa a posição da camada **mais acima** entre as selecionadas;
    - nome = nome da mais acima;
    - `visible`/`opacity` = valores da mais acima;
    - resultado **destravado** (`locked: false`), padrão Photoshop;
    - camadas não selecionadas preservam ordem relativa;
    - resultado vira a camada ativa.

- Garantias: toda ação de camada grava no IndexedDB, incrementa `dataVersion` (re-render +
  auto-sync) e agenda `scheduleLocalBackup()` — mesmo fluxo das demais ações.

## 7. Interação no Editor (`src/components/Editor.tsx`) e `canvas.ts`

- Helper `activeLayer(page)` → resolve `page.layers` via `activeLayerId` (fallback última).
- Substituir as referências a `page.strokes`/`page.images`/`page.texts` pelos arrays da
  camada ativa nos seguintes fluxos:
  - desenho (fim do traço entra em `activeLayer.strokes`);
  - borracha de traços (`eraseAtPage`/`eraseSegment`) e de imagens — somente camada ativa;
  - commit de texto (`commitDraftAt`/`commitInlineText`) → `activeLayer.texts`;
  - `addImageToPage`/importação de imagem → `activeLayer.images`;
  - hit tests e seleção (`computeSelection`, regiões, `finalizeRegion`) — somente camada
    ativa;
  - mover/redimensionar/rotacionar seleção — somente camada ativa;
  - ao trocar de camada ativa (`setActiveLayer`), limpar a seleção.
- **Camada travada** (`activeLayer.locked`): bloqueia todos os gestos de modificação de
  conteúdo no canvas — início de traço (caneta/marcador), borracha, inserção de texto/
  imagem e qualquer seleção/mover/redimensionar/rotacionar tornam-se **no-op** (o
  `onPointerDown` dessas ferramentas é ignorado na camada travada). Ainda é possível fazer
  pan/zoom e operações administrativas pelo painel (renomear, reordenar, duplicar, excluir,
  visibilidade, opacidade, tornar ativa, participar de merge).
- `canvas.ts`: os métodos de hit test/desenho já recebem arrays por parâmetro — passar os
  arrays da camada ativa (mudança mínima de assinatura). Os boxes de seleção continuam
  iterando os arrays da camada ativa.

## 8. Painel de camadas (novo `src/components/LayersPanel.tsx`)

- Painel lateral **direito** fixo; renderizado em `src/App.tsx` quando `layersOpen`.
- Botão novo na `TopBar` alterna `layersOpen` (com tooltip via i18n). Segue o padrão dos
  painéis existentes (sidebar/pageList). No mobile, posicionado como painel fixo (mesmo
  comportamento do PageList).
- Conteúdo:
  - **Lista** de camadas na ordem **topo → base**.
  - Cada item: ícone de olho (visibilidade), ícone de cadeado (lock, alterna
    `setLayerLocked`), nome, destaque da camada ativa; duplo-clique no nome abre edição
    inline (renomear); clique seleciona/torna ativa.
  - **Reordenar por arrastar** — reusa o padrão DnD via Pointer Events da `Sidebar`
    (indicador de posição; autoscroll se necessário).
  - **Seleção múltipla** para merge: CTRL/Meta clique alterna, SHIFT clique seleciona faixa,
    toque longo alterna no touch (padrões já usados na Sidebar/PageList).
  - **Barra de ações** no topo do painel: nova, duplicar, excluir, mesclar (mesclar
    desabilitado com < 2 selecionadas) e **slider de opacidade** da camada ativa (0–100%).
    Opacidade da camada travada ainda pode ser ajustada.
  - **Rodapé**: item fixo **"Fundo"** (não selecionável, não mesclável, sem ações) —
    informativo da cor/template/PDF da página.
- Sem novos eventos `ink:*`: o painel opera só via store; o Editor re-renderiza pela
  assinatura de `dataVersion`/página corrente (fluxo existente).

## 9. i18n, CSS, documentação

- Novas strings em `src/i18n/ptBR.ts` e `src/i18n/en.ts` (nunca hardcoded):
  "Camadas", "Adicionar camada", "Duplicar camada", "Excluir camada", "Mesclar camadas",
  "Mesclar {{count}} camadas", "Fundo", "Fundo da página", "Opacidade", "Renomear camada",
  "Camada {{n}}" (nomes padrão), "Mostrar/ocultar camada", "Travar camada",
  "Destravar camada".
- `src/styles.css`: estilos do painel de camadas (lista, itens, barra de ações, rodapé,
  indicador de arraste).
- `docs/PROJECT_STRUCTURE.md`: atualizar na mesma mudança — mapa de arquivos
  (LayersPanel), modelo de dados (§5.1: `Page.layers`/`Layer`), contratos das stores
  (§5.5: novas ações + `layersOpen`), índice de busca (§9), seção de i18n (§11).

## 10. Compatibilidade de plataformas

- Nenhuma API exclusiva de plataforma; nada novo no Electron/Capacitor/PWA.
- Painel funcional com toque (Android) usando os mesmos padrões de pointer/touch já
  existentes (toque longo p/ seleção múltipla, duplo-clique = renomear via toque duplo).

## 11. Verificação

- `npm run typecheck` sem erros.
- `npm run build` OK.
- Migração: abrir banco v4 (páginas com arrays planos) e confirmar 1 camada por página com
  conteúdo preservado; backup/sync antigos normalizados ao importar.
- Checklist manual (Windows/Linux/Web/Android):
  - desenhar em camadas diferentes e confirmar empilhamento correto;
  - ocultar camada, opacidade 0–100%, reordenar por arraste;
  - mesclar 2+ camadas selecionadas (nome/posição/opacidade do resultado, resultado
    destravado);
  - travar/destravar: desenho, borracha, seleção e mover bloqueados na camada travada;
    renomear/reordenar/visibilidade/opacidade/merge ainda funcionam nela;
  - borracha/seleção/mover agindo só na camada ativa; troca de camada limpa seleção;
  - não permitir excluir a última camada;
  - exportar PNG/PDF e thumbnails com opacidade/visibilidade corretas;
  - undo/redo de operações de camada;
  - mobile (painel, toque longo, renomear por duplo toque).

## 12. Fora de escopo (v1)

- Modos de mesclagem (blend modes) — sem `globalCompositeOperation`.
- Máscaras de camada, grupos/pastas de camadas, camada de ajuste.
- Mover conteúdo entre camadas (mover-seleção para outra camada).
