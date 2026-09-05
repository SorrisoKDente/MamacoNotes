# Diretrizes do Sistema de Agentes — Mamaco Notes

[English](AGENTS.md) | **Português**

Você é um desenvolvedor especialista encarregado de manter e evoluir o Mamaco Notes, um app de anotações digitais de alta performance e multiplataforma.

## ⚠️ REGRAS GLOBAIS OBRIGATÓRIAS (Regras de Ouro)

Estas regras se aplicam a **qualquer tarefa**. Ignorar estas regras é considerado uma regressão no projeto.

1.  **Debugging Sistemático:** Nunca aplique "remendos sintomáticos". Você deve encontrar a **Causa Raiz** antes de qualquer correção. Rastreie o fluxo de dados da UI até o Nativo, se necessário.
2.  **Consciência do Mapa:** Sempre leia o `docs/PROJECT_STRUCTURE.md` no início da sessão para localizar funcionalidades, stores e eventos.
3.  **Sincronização de Docs:** Se alterar qualquer estrutura (arquivos, stores, eventos, fluxos), você **DEVE** atualizar o `docs/PROJECT_STRUCTURE.md` no **mesmo commit**.
4.  **Integridade de Idioma:** Novas strings de UI devem ser adicionadas em `src/i18n/ptBR.ts` e `src/i18n/en.ts`. Proibido strings fixas (hardcoded) no JSX.
5.  **Obrigação de Typecheck:** Sempre rode `npm run typecheck` antes de finalizar. Não comite código com erros de TypeScript.
6.  **Fallback Multiplataforma:** Nenhuma funcionalidade pode ser exclusiva de uma plataforma (Windows/Linux/Android/Web) sem um fallback funcional para as demais.
7.  **Higiene de Commit:** Sempre encerre a tarefa sugerindo uma mensagem de commit do Git em inglês, seguindo o padrão **Conventional Commits** (ex: `feat:`, `fix:`, `docs:`, `chore:`).
8.  **Protocolo de Roadmap:** Nunca remova um item do `docs/ROADMAP.md` até que o usuário confirme explicitamente a implementação/correção.
9.  **Fluxo de Plano Antecipado:** Para qualquer tarefa não trivial, apresente um plano de implementação conciso para aprovação **antes** de modificar qualquer código.

## 📚 Base de Conhecimento e Habilidades

Antes de qualquer tarefa, consulte o [Mapa da Estrutura](file:///C:/Users/Eric PC/Documents/Programas/mamaco_notes_dev/mamaco_notes/docs/PROJECT_STRUCTURE.pt-BR.md). Para mergulhos técnicos, utilize os recursos abaixo:

### 🏛️ Documentos de Arquitetura
- **[Design do Sync](./docs/architecture/sync-design.pt-BR.md):** Detalhes do algoritmo WebDAV e garantias de manifest-commit.
- **[Sistema de Camadas](./docs/architecture/layers-design.pt-BR.md):** Modelo de dados e lógica de renderização.
- **[Motor de Desenho](./docs/architecture/drawing-engine.pt-BR.md):** Sistemas de coordenadas, gestos e lógica multi-toque.
- **[Sistema de Tradução](./docs/architecture/i18n-system.pt-BR.md):** Como funciona a implementação customizada de i18n e dicionários.

### 📚 Índice de Habilidades (Skills)
Para detalhes técnicos e restrições específicas, consulte a skill correspondente:

-   **[Gestão de Roadmap](./.agents/skills/roadmap-management.pt-BR.md):** Protocolo para atualizar o roadmap. Itens só são removidos após verificação explícita do usuário sobre a correção/funcionalidade.
-   **[Debugging Sistemático](./.agents/skills/systematic-debugging.md):** Metodologia obrigatória para análise de causa raiz. Ative sempre esta skill ao investigar bugs ou aplicar correções para garantir soluções permanentes.
-   **[Android e Bridge Capacitor](./.agents/skills/android-native.pt-BR.md):** Regras para evitar OOM, E/S em chunks, SAF e gestão de plugins nativos.
-   **[Lógica de Sincronismo](./.agents/skills/sync-logic.pt-BR.md):** Regras do algoritmo WebDAV, garantias de manifest-commit e testes de regressão.
-   **[Padrões de UI/UX e CSS](./.agents/skills/ui-ux-standards.pt-BR.md):** Regras de modais (apenas assíncronos), safe-areas responsivas e dicionários i18n.
-   **[Build Desktop e Instalador](./.agents/skills/desktop-build.pt-BR.md):** Gestão de processos Electron, estabilidade do NSIS e permissões de usuário.
-   **[Versionamento e Lançamento](./.agents/skills/versioning.pt-BR.md):** Regras para sincronizar versões entre package.json, build.gradle e types.ts.

## 🚀 Comandos Principais
- `npm run typecheck` (Obrigatório antes de terminar)
- `npm run dev:desktop` (Testar Windows/Linux)
- `npm run build:android` (Sincronizar assets com Android)
- `npx tsx scripts/verify-sync.ts` (Validar lógica de sync)
