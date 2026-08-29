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
  3. **Nível de Conteúdo**: Para cada camada visível, desenha **Imagens -> Textos -> Traços** nesta ordem específica.
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
- **Dom Direto**: Atualizações de UI de alta frequência (como o cursor da ferramenta) ignoram o React usando refs e manipulação direta de estilos.
- **Eventos Coalescidos**: Usa `getCoalescedEvents` para suavização de entrada de caneta de alta precisão.
