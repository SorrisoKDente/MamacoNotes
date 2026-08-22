# AGENTS.md — Instruções para agentes de IA no Mamaco Notes

[English](AGENTS.md) | **Português**

> Este arquivo deve ser seguido por **qualquer agente de IA** ao trabalhar neste projeto
> (criar funcionalidades, corrigir bugs, refatorar, documentar, etc.).

## 1. Obrigatório: leia a estrutura antes de qualquer trabalho

1. Se você ainda **não leu** `docs/PROJECT_STRUCTURE.md` nesta sessão, **leia-o primeiro**,
   antes de criar código, corrigir bug ou planejar qualquer mudança. Ele é o mapa de
   localização de informação do projeto (onde está cada funcionalidade, cada store, cada
   evento, cada camada).
2. **Se você alterar o funcionamento de qualquer estrutura do projeto** (arquivos,
   componentes, stores, eventos `ink:*`, tipos de dados, funcionalidades, fluxos ou
   plataformas), **você DEVE atualizar `docs/PROJECT_STRUCTURE.md` na mesma mudança**,
   conforme o prompt no topo daquele arquivo. Nunca finalize a tarefa com a documentação
   desatualizada em relação ao código.
3. **Se você adicionar novas funcionalidades ou alterar as existentes**, você DEVE
   atualizar tanto o `README.md` quanto o `README.pt-BR.md` para refletir essas mudanças
   em ambos os idiomas.

## 2. Contexto do projeto

**Mamaco Notes** é um app de anotações digitais com caneta (estilo Samsung Notes). O
código-fonte é um único frontend **React + TypeScript + Vite**, que roda em **4 ambientes**:

| Plataforma | Como roda |
|---|---|
| **Windows** | Electron (`electron/main.cjs`) + empacotamento electron-builder (NSIS/portable) |
| **Linux** | Electron + empacotamento electron-builder (AppImage/deb) |
| **Android** | Capacitor (`capacitor.config.ts`) |
| **Web / PWA** | Navegador com service worker (`vite-plugin-pwa`) |

> **Regra de plataforma**: o programa **precisa funcionar em Windows, Linux e Android**
> (e, de preferência, também no navegador). **Nenhuma mudança pode quebrar ou ser
> exclusiva de uma plataforma** sem fornecer fallback para as demais.

## 3. Regras de compatibilidade entre plataformas

- **Nunca** use APIs exclusivas de uma plataforma sem fallback. Exemplos já resolvidos no
  projeto e que devem ser mantidos:
  - Detecção de ambiente: use `window.inkfolioDesktop` (Electron) e `window.Capacitor`
    (Android); o restante é tratado como Web/PWA.
  - Acesso ao sistema de arquivos: no desktop use a bridge `window.inkfolioDesktop`
    (`pick-directory`, `write-file`, `read-file`, `save-file`, `open-file` via preload);
    no navegador use a File System Access API (com fallback para download). Veja
    `src/utils/localSave.ts`, `src/utils/backup.ts`.
  - Service worker do PWA: registre **somente** fora do Electron e do Capacitor.
  - Fontes do sistema: use Local Font Access com fallback para uma lista embutida
    (`src/utils/fonts.ts`).
- **Idioma**: toda a UI (textos de botões, modais, menus, mensagens) é em **português
  (pt-BR)** com suporte a **inglês (en)** via `src/i18n/`. **Sempre** que criar uma nova
  funcionalidade, componente ou fluxo que tenha texto de UI, a string **deve** ser
  adicionada aos dicionários de **todas as línguas suportadas** (`src/i18n/ptBR.ts` e
  `src/i18n/en.ts`) — nunca como string literal hardcoded. Consuma com `t('chave')` em
  módulos planos ou `useI18n()` em componentes React. Consulte a **seção 11 (Tradução)**
  de `docs/PROJECT_STRUCTURE.md` para saber todos os pontos que contêm texto.
- **Caminhos/separadores**: não assuma separador de caminho de um SO específico; use
  APIs multiplataforma.
- **Android**: mudanças que exijam novas permissões/plugins do Capacitor devem ser
  adicionadas a `capacitor.config.ts` e `cap sync android` precisa rodar. Teste o build
  com `npm run build:android`.

## 4. Arquitetura — siga os padrões existentes

- **Estado global**: use as stores Zustand (`src/store.ts` para dados, `src/uiStore.ts`
  para modais, `src/textStore.ts` para edição de texto). Não invente stores novas para o
  que já existe; se precisar de estado/estado novo, **atualize o contrato** (interface no
  topo do arquivo) e a documentação.
- **Persistência**: toda escrita de dados passa pela store → `src/db.ts` (IndexedDB) →
  `scheduleLocalBackup()`. Não grave no IndexedDB fora desses caminhos.
- **Comunicação UI ↔ canvas**: use `window.dispatchEvent(new CustomEvent('ink:...'))` e
  não props profundas. Ao adicionar evento, registre-o na **seção 7** de
  `docs/PROJECT_STRUCTURE.md`.
- **Desenho**: o motor de renderização é a classe `PageCanvas` (`src/renderer/canvas.ts`);
  `Editor.tsx` é o dono de toda a interação (gestos de pointer). Funções puras de desenho
  reutilizáveis (thumbnails, exportação) vão em `src/renderer/drawUtils.ts`.
- **IDs**: gere ids com `newId()` de `src/types.ts` (usa `crypto.randomUUID()` quando
  disponível e cai para `uid()` em contextos inseguros, como acesso via IP/HTTP no
  navegador). Nunca chame `crypto.randomUUID()` diretamente — ele não existe fora de
  contextos seguros (HTTPS/localhost) e quebraria o PWA acessado por rede local.
- **Templates de página**: dimensões/tipos de template vêm de `src/types.ts`; ao
  adicionar um template novo, verifique os modais e o canvas.

## 5. Recomendações adicionais

- **Typecheck obrigatório**: depois de qualquer mudança de código, rode
  `npm run typecheck` (equivalente a `tsc --noEmit`). Não finalize com erros de tipo.
- **Build de verificação**: se a mudança envolver build/empacotamento, verifique com
  `npm run build` (gera o frontend). Builds de desktop/android são lentos; use apenas
  quando necessário (`build:desktop`, `build:android`).
- **Migração do IndexedDB**: ao mudar o schema (novas object stores/campos), **aumente a
  versão** (`DB_VERSION` em `src/db.ts`) e implemente a migração em `onupgradeneeded`.
  Nunca quebre dados existentes de usuários.
- **Não quebre o sync**: dados vêm de backup/sync e podem estar em versões antigas.
  Mantenha a normalização defensiva (ex.: `texts ?? []`, `backgroundColor ?? '#ffffff'`)
  em `src/store.ts` (`applySyncChanges`, `init`, `replaceAllData`) e atualize o
  `SyncManifest`/algoritmo em `src/utils/sync.ts` somente com cuidado e migração.
- **Eventos `ink:*`**: são a "API" entre UI e canvas. Ao renomear/remover payload,
  procure todos os usos (dispatch e listener) e atualize a tabela da documentação.
- **Padrão de código**: siga o estilo existente (sem comentários desnecessários, nomes
  claros em inglês para código, textos de UI em pt-BR). Não introduza dependências novas
  sem necessidade.
- **Modificar o comportamento**: antes de mudar um fluxo existente (ex.: salvar, sincronizar,
  exportar), leia o código atual do fluxo e a seção correspondente da documentação para
  não regredir funcionalidades.
