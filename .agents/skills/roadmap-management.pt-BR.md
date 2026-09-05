---
name: roadmap-management
description: Regras para manutenção dos arquivos ROADMAP.md do projeto. Garante que itens só sejam removidos ou marcados como concluídos após confirmação explícita do usuário sobre a correção ou funcionalidade.
---

# Protocolo de Gestão de Roadmap

## Regra Fundamental
**Itens NUNCA devem ser removidos dos arquivos `docs/ROADMAP.md` ou `docs/ROADMAP.pt-BR.md` baseando-se apenas na alegação de implementação da IA.**

## Fluxo de Trabalho
1.  **Implementação**: Após aplicar um fix ou uma nova funcionalidade listada no roadmap, o agente deve reportar a tarefa como concluída.
2.  **Espera de Verificação**: O agente NÃO DEVE atualizar os arquivos de roadmap no mesmo turno da modificação do código.
3.  **Confirmação do Usuário**: O agente deve solicitar explicitamente que o usuário verifique a mudança.
    *   *Exemplo*: "Implementei a confirmação de exclusão em lote. Por favor, teste. Assim que você confirmar que funciona como esperado, removerei o item do Roadmap."
4.  **Atualização do Roadmap**: APENAS quando o usuário responder com uma confirmação (ex: "Funcionou", "Bug corrigido", "Confirmado"), o agente deverá:
    *   Ativar esta skill.
    *   Remover o item correspondente de ambas as versões (Inglês e Português) do roadmap.
    *   Se aplicável, mover o item para uma seção "Concluídos" ou simplesmente deletar, conforme o fluxo do projeto.

## Diretrizes
- Mantenha sempre a sincronia entre `ROADMAP.md` e `ROADMAP.pt-BR.md`.
- Mantenha a ordem alfabética ou de prioridade ao adicionar novos itens.
- Se o usuário reportar um NOVO bug ou melhoria, adicione ao roadmap imediatamente após a fase de investigação.
