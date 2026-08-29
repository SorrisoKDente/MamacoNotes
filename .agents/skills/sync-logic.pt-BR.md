# Habilidade: Lógica de Sincronismo e Integridade de Dados

[English](sync-logic.md) | **Português**

Esta habilidade cobre o algoritmo de sincronização bidirecional usado para manter as notas consistentes entre dispositivos.

## 🧠 Princípios Core

### 1. Garantia de Manifest-Commit
- O baseline de sincronização local (`cloudSync.notebooks`/`foldersHash`) deve **apenas** avançar após o servidor confirmar com sucesso a escrita do novo `manifest.json`.
- Se a escrita do manifesto falhar, o processo de sincronização deve realizar um **rollback** para o estado anterior do baseline. Isso garante que a próxima sincronização reavalie o mesmo plano e evita sobrescritas silenciosas de dados.

### 2. Normalização Defensiva
- Dados vindos do Sync ou Backup devem passar por `normalizePage` em `src/types.ts`.
- Garanta valores de fallback para campos ausentes (ex: `layers: []`, `texts: []`, `backgroundColor: '#ffffff'`) para manter a compatibilidade com versões anteriores do cliente.

### 3. Tombstones e Restauração
- Itens excluídos devem gerar um **Tombstone** (armazenado em `cloudSync`).
- Durante a fase de `pull` do `buildPlan`, qualquer ID remoto presente em `state.tombstones` deve ser ignorado para evitar que itens excluídos "voltem".
- A restauração da lixeira deve limpar o tombstone e forçar um `push` para a nuvem.

## 🧪 Verificação
- **Testes de Regressão:** Antes de finalizar mudanças em `sync.ts` ou `webdav.ts`, rode a suíte de regressão:
  `npx tsx scripts/verify-sync.ts`
- **Verificação de Download:** Para mudanças no motor de rede, rode:
  `npx tsx scripts/verify-download.ts`
