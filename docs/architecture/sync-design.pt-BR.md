# Arquitetura: Sincronização Bidirecional

[English](sync-design.md) | **Português**

Este documento descreve o design detalhado e a implementação do sistema de sincronização do Mamaco Notes.

## 1. Visão Geral
O sistema de sync mantém cadernos e pastas consistentes entre dispositivos usando um servidor WebDAV. Ele gerencia conflitos, exclusões (tombstones) e oferece resiliência de rede para dispositivos móveis.

## 2. Componentes Técnicos
- **Transporte**: `src/utils/webdav.ts`. Implementa PROPFIND, MKCOL, PUT e DELETE. Inclui tratamento especial para servidores Koofr.
- **Algoritmo**: `src/utils/sync.ts`. Lógica para `buildPlan` e `runSync`.
- **Estado**: `db.ts` (store `cloudSync`) e `src/types.ts` (`CloudSyncState`).

## 3. Algoritmo de Merge
O algoritmo compara o `manifest.json` remoto com o estado local e o baseline da última sincronização (mapa `cloudSync.notebooks` e `foldersHash`).

### Decisões:
- **Push**: `updatedAt` local > baseline E remoto igual ao baseline.
- **Pull**: `updatedAt` remoto > baseline E local igual ao baseline.
- **Conflito**: Ambos (local e remoto) mudaram desde o baseline.
- **Delete**: Item removido localmente (gera um Tombstone) ou ausente no manifesto remoto.

## 4. Integridade de Dados e Resiliência
- **Garantia de Manifest-Commit**: O baseline local **apenas** avança após o servidor confirmar com sucesso a escrita do novo `manifest.json`. Em caso de falha, ocorre um rollback.
- **E/S em Chunks (Android)**: Cadernos grandes usam HTTP Range requests (`downloadText` no `http.ts`) e uploads nativos em stream (`uploadFileStreaming` no `chunkedIo.ts`) para evitar crashes por falta de memória (OOM).
- **Tombstones**: Itens excluídos são armazenados em `state.tombstones` para evitar que sejam re-baixados se ainda existirem no servidor.
- **Autocorreção**: Arquivos remotos ausentes (404) são reconciliados automaticamente reenviando a cópia local ou limpando a entrada no manifesto.

## 5. Verificação
- **Suíte de Regressão**: `scripts/verify-sync.ts` (teste independente com transporte simulado).
- **Teste de Download**: `scripts/verify-download.ts` (valida a reconstrução de range no Android).
