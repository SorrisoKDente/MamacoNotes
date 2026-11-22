# Arquitetura: Motor de Desenho (Renderer)

[English](drawing-engine.md) | **Português**

Este documento descreve o design e a implementação do motor de desenho e renderização do Mamaco Notes.

## 1. Visão Geral
O `Editor.tsx` instancia **uma** `PageCanvas` (`src/renderer/canvas.ts`) sobre um `<canvas>`. Este motor é responsável por renderizar todos os elementos visuais, lidar com sistemas de coordenadas e gerenciar gestos complexos.

## 2. Pipeline de Renderização
- **Fluxo**: `render()` -> `renderSinglePage()` (modo `separate`) ou `renderContinuous()` (vertical/horizontal).
- **Z-Order (Ordem de Profundidade)**:
  1. **Nível da Página**: O fundo (template) e o PDF são desenhados primeiro.
  2. **Nível de Camadas**: Itera `page.layers` da base (índice 0) para o topo.
  3. **Nível de Conteúdo**: Para cada camada visível, traços/imagens/textos são desenhados na ordem z por elemento (`order`; sem ele, o fallback legado **Traços -> Imagens -> Textos**). Veja `layerItems` em `src/types.ts`. Traços consecutivos são agrupados para a passada de máscara de borracha.
- **Traço Ativo**: O traço em andamento é desenhado por cima de tudo para feedback imediato.

## 3. Sistemas de Coordenadas
- `toPageCoords`: Converte pixels da tela para coordenadas relativas à página.
- `toDocumentCoords`: Converte pixels da tela para coordenadas absolutas do documento (entre múltiplas páginas).
- `toScreenCoords`: Converte coordenadas internas de volta para pixels da tela para overlays de UI.
- Estas conversões aplicam automaticamente **Pan, Zoom, Offset da Página e Rotação da Página**.

## 4. Interação e Gestos
Todos os gestos são implementados via handlers de `PointerEvent` no `Editor.tsx`.

### Modos de Drag
Identificados por `dragRef.kind`:
- `pan`, `draw`, `erase`, `select-move/resize/rotate`, `region-draw/move`, `text-rotate/resize`, `page-rotate`, `group-resize/rotate`.

### Multi-toque (Mobile)
- **Threshold**: Um segundo dedo só ativa o pan/pinch após mover > `TWO_FINGER_THRESHOLD` (14px) para evitar problemas de palm rejection.
- **Propriedade**: Apenas o ponteiro que iniciou um drag (`dragOwnerIdRef`) pode efetivá-lo.
- **Gestos**:
  - **2 Dedos**: Apenas Pan e Zoom.
  - **3 Dedos**: Rotação da Página.
  - **Toque Duplo (2 Dedos)**: Desfazer (Undo).
  - **Toque Duplo (3 Dedos)**: Refazer (Redo).

## 5. Motor de Seleção
- **Armazenamento**: Set de IDs (`strokes`, `images`, `texts`) em `selectionRef`.
- **Testes de Região**: Para imagens, testa cantos rotacionados e intersecções com a borda da região.
- **Selecionar Apenas Delimitado**: Quando ativo, divide traços e recorta (crop) imagens na borda da região (`computeDelimitedSelection`).
- **Snapshot/Esc**: Antes de uma seleção destrutiva (como o crop), um snapshot é salvo. Pressionar `Esc` restaura a página ao estado original.

## 6. Otimização
- **Loop RAF**: O desenho é desacoplado dos eventos usando `requestAnimationFrame`.
- **Escala da máscara de borracha**: O bitmap intermediário usado para recortar traços
  usa a mesma escala visível da página (`zoom × DPR`), evitando que todos os traços
  fiquem borrados depois da primeira borracha em zoom diferente de 100%.
- **Blits 1:1 do tamanho da página**: todo bitmap do tamanho da página (cache composto
  `pageCache`, raster do PDF, template de fundo, máscara de borracha) é dimensionado com
  `ceil` (`pageBitmapSize`) e blitado em `bitmapSize / scale` (`pageBitmapSpan`/
  `blitPageBitmap`), então um pixel do bitmap é exatamente um pixel do dispositivo.
  Desenhá-lo em `0,0,page.width,page.height` num `zoom × DPR` fracionário o reamostrava
  duas vezes e deslocava o texto do PDF a cada toque da caneta, o que parecia a página
  "tremendo" durante a escrita. Por isso páginas com PDF continuam usando o cache composto
  durante o traço, com a nitidez de um render direto.
- **Fase subpixel e rotação** (`pageGrid`/`blitRasterBitmap`): caminhos são
  anti-aliased pela posição subpixel, então um bitmap de fase 0 blitado numa origem
  fracionária re-filtra todos os traços existentes ao encostar a caneta. O cache
  composto e a máscara da borracha são rasterizados com o transform linear completo
  do destino (`setTransform(a,b,c,d,tx,ty)`, rotação incluída) e a mesma translação
  fracionária, e blitados na origem inteira do bitmap com transform identidade e
  suavização desligada. Apenas escala e fase identificam o bitmap, então pan por
  pixels inteiros o reutiliza e páginas rotacionadas ganham um bitmap que cobre sua
  bounding box rotacionada; quando o destino é mais fino que o orçamento de pixels,
  a grade cai no blit por span alinhado aos eixos. O bitmap é construído **recortado
  na página** e blitado **sem recorte** — recortar as duas passadas atenuava a borda.
- **Aquecimento do cache ocioso** (`scheduleCacheWarm`): um render ocioso que encontra
  um bitmap válido para o mesmo conteúdo mas com grade de dispositivo desatualizada
  (pan/zoom) o reconstrói após 120 ms de inatividade, fora do caminho do traço. O
  próximo pen-down então blita, em vez de reconstruir a página inteira no primeiro
  pointermove.
- **Layout durante a escrita**: O retângulo do canvas é reutilizado entre frames e só
  é atualizado quando resize ou scroll invalida o cache, evitando leituras forçadas de
  layout no caminho crítico.
- **Dom Direto**: Atualizações de UI de alta frequência (como o cursor da ferramenta) ignoram o React usando refs e manipulação direta de estilos.
- **Eventos Coalescidos**: Usa `getCoalescedEvents` para suavização de entrada de caneta de alta precisão.
