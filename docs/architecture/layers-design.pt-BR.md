# Arquitetura: Sistema de Camadas

Este documento descreve o design do sistema de camadas de desenho no Mamaco Notes.

## 1. Modelo de Dados
O conteúdo do desenho é organizado em uma hierarquia:
- **Caderno (Notebook)**: Uma coleção de páginas.
- **Página (Page)**: Contém suas próprias configurações (largura, altura, fundo) e uma coleção de **Camadas**.
- **Camada (Layer)**: Contém traços, imagens e elementos de texto.

## 2. Ordem de Renderização (Z-Order)
As camadas são armazenadas em um array dentro do objeto `Page`:
- **Índice 0**: A camada mais ao fundo (renderizada primeiro).
- **Último Índice**: A camada mais ao topo (renderizada por último).
Dentro de cada camada, a ordem de renderização é: **Imagens -> Textos -> Traços**.

## 3. Propriedades da Camada
Cada camada possui as seguintes propriedades:
- `visible` (boolean): Controla se a camada é renderizada.
- `opacity` (number, 0-1): Controla a transparência de todo o conteúdo da camada.
- `locked` (boolean): Impede qualquer edição (desenhar, apagar, selecionar) do conteúdo da camada.
- `folderId` (string | null): O ID da `LayerFolder` à qual esta camada pertence.

## 4. Pastas de Camadas
As pastas de camadas fornecem uma maneira de agrupar camadas visualmente na UI.
- Elas possuem apenas um nível de profundidade (sem pastas aninhadas).
- Excluir uma pasta move todas as suas camadas de volta para o nível raiz.
- Mover uma pasta reordena todas as suas camadas constituintes como um bloco.

## 5. Operações
- **Mesclar (Merge)**: Combina múltiplas camadas selecionadas em uma única camada. A camada resultante assume a posição e propriedades da camada selecionada mais ao topo.
- **Normalização**: Cadernos antigos (sem camadas) são migrados automaticamente para uma estrutura de camada única ao serem abertos ou sincronizados.
