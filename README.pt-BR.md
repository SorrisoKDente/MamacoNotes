# Mamaco Notes

[English](README.md) | **Português**

O **Mamaco Notes** é um aplicativo de anotações digitais projetado para escrita à mão e desenho, servindo como uma alternativa multiplataforma ao Samsung Notes. Ele foi construído para funcionar perfeitamente no **Windows**, **Linux**, **Android** e na **Web**.

Este projeto foi desenvolvido quase 100% usando o **MonkeyCodeAI**, aproveitando o desenvolvimento assistido por IA para criar uma aplicação robusta e rica em recursos.

## 🚀 Principais Funcionalidades

-   **Suporte Multiplataforma**: Disponível como app Desktop (Electron para Windows/Linux), app Mobile (Capacitor para Android) e PWA (Progressive Web App).
-   **Motor de Desenho Avançado**: Um motor customizado em Canvas 2D que suporta:
    -   Ferramentas de Caneta e Marcador sensíveis à pressão.
    -   Borracha eficiente (apaga traços e partes de imagens).
    -   Ferramenta de seleção com regiões de forma livre, retângulo e círculo.
    -   Seleção delimitada (divide traços e recorta imagens dinamicamente).
-   **Gerenciamento de Camadas**: Sistema de camadas de nível profissional que permite:
    -   Adicionar, renomear, duplicar e mesclar camadas.
    -   Ajustar opacidade e alternar visibilidade ou bloqueio.
    -   Organizar conteúdo (imagens, texto, traços) hierarquicamente.
-   **Sincronização em Nuvem**: Sincronização bidirecional via **WebDAV**. Atualmente validado principalmente com o **Koofr**; embora suporte o protocolo WebDAV padrão (Nextcloud, ownCloud, etc.), a compatibilidade total com outros provedores ainda está sendo verificada.
-   **Integração com PDF e Imagens**:
    -   Importe PDFs como novos cadernos ou como fundo de páginas.
    -   Insira e transforme imagens (mover, redimensionar, rotacionar).
    -   Exporte suas notas como arquivos PNG ou PDF de alta qualidade.
-   **Organização**:
    -   Pastas e cadernos aninhados para fácil categorização.
    -   Reordenação por arrastar e soltar de pastas, cadernos e páginas.
    -   Suporte a seleção múltipla para ações em lote (copiar, mover, excluir).
-   **UI & UX Inteligente**:
    -   Suporte a multi-toque para tablets e celulares (zoom de pinça, pan).
    -   Gestos customizados: toque duplo com 2 dedos para **Desfazer**, toque duplo com 3 dedos para **Refazer**, 2 dedos para mover/zoom e giro com 3 dedos para **Girar a página**.
    -   Localização completa em **Português (pt-BR)** e **Inglês**.
    -   Suporte a modo Escuro/Claro e visibilidade customizável de barras (com botões flutuantes para restauração rápida).
    -   Opção para ocultar o cursor da ferramenta para uma experiência de desenho mais limpa.
-   **Segurança e Persistência**:
    -   Dados armazenados localmente usando **IndexedDB**.
    -   Restauração de sessão para reabrir automaticamente o último caderno e página.
    -   Backups automáticos em disco (Electron) ou diretório do navegador.
    -   Importação/exportação de backup manual completo (JSON).

## 🛠️ Stack Tecnológica

-   **Frontend**: [React 18](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
-   **Ferramenta de Build**: [Vite 6](https://vitejs.dev/)
-   **Gerenciamento de Estado**: [Zustand](https://github.com/pmndrs/zustand)
-   **Persistência**: IndexedDB (local) & WebDAV (nuvem)
-   **Desktop**: [Electron](https://www.electronjs.org/)
-   **Mobile**: [Capacitor](https://capacitorjs.com/)
-   **Motor de Desenho**: Implementação customizada em HTML5 Canvas 2D
-   **Processamento de PDF**: `pdfjs-dist`

## 📁 Estrutura do Projeto

Para um mapa detalhado dos arquivos, arquitetura e busca de informações, consulte a [Documentação da Estrutura do Projeto](docs/PROJECT_STRUCTURE.md).

## 📜 Código Aberto e Futuro

Este projeto é **código aberto** e livre para usar à vontade. Embora tenha começado como uma ferramenta pessoal, estou comprometido com a melhoria contínua, correção de bugs e aprimoramento da experiência geral.

## 💡 Sugestões e Suporte

Estou sempre aberto a sugestões e feedback! Se você tiver ideias de melhorias ou quiser reportar um problema, por favor, me avise.

Se você achar este projeto útil e quiser apoiar financeiramente o seu desenvolvimento, você pode doar através de:
- ☕ **Ko-fi**: [ko-fi.com/yabaihonyaku](https://ko-fi.com/yabaihonyaku)
- 💸 **Pix (Brasil)**: `yabaihonyaku@gmail.com`

## 🤖 Desenvolvido com IA

O Mamaco Notes é um testemunho do poder da IA na engenharia de software moderna. Toda a arquitetura, lógica de desenho, algoritmos de sincronização e componentes de UI foram desenvolvidos através de um processo colaborativo com o **MonkeyCodeAI**.

---

*Feito com 🍌 pela Equipe Mamaco.*  
*P.S.: Se você também "veio ver o macaco", sinta-se em casa!*
