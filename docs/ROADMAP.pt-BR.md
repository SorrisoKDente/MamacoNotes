# 🗺️ Roadmap e Problemas Conhecidos

Este documento rastreia bugs atuais, melhorias planejadas e ideias de longo prazo para o Mamaco Notes.

## 🐛 Bugs Conhecidos (Correções Prioritárias)

- [x] **Navegação do Editor**: Os botões de zoom (+/-) e de recentralizar não funcionam nas versões Desktop e Web (funcionam apenas no Android).
- [x] **Motor de Desenho**: O clique único não registra desenho; o cursor exige um arraste mínimo para iniciar um traço.
- [/] **Desempenho Crítico (Android)**: Lag severo relatado em notas específicas. Atualmente incapaz de reproduzir consistentemente; aguardando novas ocorrências para coletar mais dados para testes.
- [ ] **Falso Positivo de Status da Nuvem**: Ao importar um backup de um dispositivo conectado à nuvem, o app informa estar "Conectado" no novo dispositivo, mesmo que a senha tenha sido (corretamente) excluída do backup e nenhuma conexão possa ser feita.
- [ ] **Artefatos de Desenho Multi-toque**: Dependendo de como dois dedos tocam a tela no celular, linhas indesejadas podem ser criadas conectando os dois pontos.
- [ ] **Exclusão Prematura de Traços**: Alguns traços estão sendo excluídos ou descartados de forma intermitente antes de o usuário terminar de desenhá-los.
- [x] **Geração de Thumbnails**: As prévias dos cadernos no Dashboard estão com zoom incorreto, exibindo apenas o centro da página em vez de ajustar o conteúdo ao quadro.

## ✨ Funcionalidades e Melhorias Planejadas

- [ ] **Fluxo de Navegação**: Implementar a persistência do estado da pasta para que, ao voltar do Editor, o usuário retorne exatamente para a subpasta onde estava.
- [ ] **Atalhos Contextuais (Ctrl+A)**: 
  - **Preview de Páginas**: Selecionar todas as páginas.
  - **Canvas**: Selecionar todos os traços, imagens e textos.
  - **Painel de Camadas**: Selecionar todas as camadas e pastas de camadas.
- [ ] **Clipboard Estendido**: Suporte para Copiar (`Ctrl+C`), Colar (`Ctrl+V`) e Deletar (`Del`) para camadas, cadernos e pastas.
- [ ] **Exclusão Segura**: 
  - Implementar um popup de confirmação para exclusão em lote de camadas ou pastas.
  - **Restrição de Camada**: Garantir que pelo menos uma camada sempre exista; se o usuário tentar apagar todas, solicitar a seleção de uma para ser mantida.

## 💡 Ideias Futuras (Backlog)

### Dashboard e UX
- [ ] **Tooltips de Hover**: Mostrar o nome completo de pastas e cadernos ao passar o mouse sobre eles por um curto período (Sidebar e Grade).
- [ ] **Diff Visual de Sync**: Mostrar uma prévia lado a lado das diferenças entre as versões local e na nuvem quando houver conflito de sincronização.
- [ ] **Interface Desktop Minimalista**: Opção para remover a barra de menu nativa padrão (Arquivo, Editar, Exibir) na versão Electron para uma experiência mais imersiva.
- [ ] **Notas de Versão Ricas**: Renderizar prévias de Markdown diretamente dentro do modal de Atualização de Software.

### Ferramentas de Desenho Avançadas
- [ ] **Canvas Dinâmico**: Opção para criar notas com um canvas "infinito" que cresce automaticamente (limitado ao modo de páginas separadas).
- [ ] **Suporte a Formatos**: Adicionar suporte para exportação em JPEG.
- [ ] **Ferramentas Geométricas**: 
  - Ferramenta de conta-gotas para seleção de cores.
  - Ferramenta dedicada de formas geométricas.
  - Atalho "Shift" durante o desenho para manter linhas retas.
  - Correção automática de formas e caligrafria (estilo Samsung Notes).
- [ ] **Integração com IA**: Conversão de caligrafria para texto digitado (OCR).
