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
- **Garantia de Commit da Resolução**: Ao escolher a versão da nuvem, o caderno baixado é aplicado e persistido antes de gravar o novo baseline. Se a resolução falhar, o erro é exibido e o baseline anterior é preservado, impedindo que uma cópia local antiga sobrescreva a nuvem.
- **E/S em Chunks (Android)**: Cadernos grandes usam HTTP Range requests (`downloadText` no `http.ts`) e uploads nativos em stream (`uploadFileStreaming` no `chunkedIo.ts`) para evitar crashes por falta de memória (OOM).
- **Integridade dos Ranges**: Os downloads Android usam blocos de 128 KiB, solicitam conteúdo binário explicitamente, validam o início/fim de cada `Content-Range` e a quantidade de bytes antes de concatenar os blocos, e tentam blocos menores quando um proxy WebDAV retorna uma resposta truncada.
- **API de Conteúdo do Koofr**: Downloads do Koofr usam o endpoint `/content/api/v2/mounts/{mountId}/files/get` em vez do endpoint WebDAV com Range, evitando respostas parciais falsas retornadas por alguns caminhos WebDAV do Koofr.
- **Identificação no Progresso**: O progresso mostra o caminho remoto e também o caminho lógico local (`pasta/subpasta/caderno`), permitindo distinguir cadernos com nomes semelhantes.
- **Verificação de Upload**: Uploads nativos de JSON são lidos novamente e analisados antes de serem considerados bem-sucedidos, impedindo que um corpo truncado avance a sincronização.
- **Falha na Resolução de Conflitos**: Se a cópia escolhida não puder ser baixada ou aplicada, o baseline não é confirmado, o progresso permanece em estado de erro e as escolhas de conflito ficam disponíveis para tentar novamente.
- **Tombstones**: Itens excluídos são armazenados em `state.tombstones` para evitar que sejam re-baixados se ainda existirem no servidor.
- **Autocorreção**: Arquivos remotos ausentes (404) são reconciliados automaticamente reenviando a cópia local ou limpando a entrada no manifesto.
- **Recuperação de Órfãos**: Cadernos encontrados na pasta remota `notebooks`, mas ausentes no `manifest.json`, são validados e adicionados ao manifesto antes do planejamento.
- **Reparo de Bitmap de PDF**: Os fundos de PDF são sincronizados como `pdfs/<pageId>.png` (hashes no manifesto), e o JSON do caderno carrega apenas `pdf: { name, pageNumber }`. Um app anterior à 2.4.2 não lê esse formato e grava a página sem o bitmap. Na primeira sincronização de cada versão do app, o cliente varre o banco local em busca de páginas que mantiveram os metadados `pdf` mas estão sem bitmap (`db.getPagesMissingPdfBitmap`) e baixa a imagem de volta, mesmo quando o `updatedAt` do caderno é igual ao baseline e ele nunca é puxado. Um 404 deixa a página como está, erros de rede não falham a execução, e o caderno reparado é persistido e mesclado no editor aberto sem resetar o undo.

## 5. Verificação
- **Suíte de Regressão**: `scripts/verify-sync.ts` (teste independente com transporte simulado).
- **Teste de Download**: `scripts/verify-download.ts` (valida a reconstrução de range no Android).
