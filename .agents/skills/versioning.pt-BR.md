# Habilidade: Versionamento e Gestão de Lançamento

[English](versioning.md) | **Português**

Esta habilidade define o fluxo de trabalho obrigatório para atualizar a versão do aplicativo em todas as plataformas suportadas.

## 🧠 Princípios Core

### 1. Requisito de Sincronização
A versão deve ser atualizada em quatro locais específicos simultaneamente para garantir a consistência entre a UI Web, o app desktop Electron e o pacote Android.

### 2. Arquivos para Atualizar

#### A. [package.json](../../package.json)
- **Campo:** `version`
- **Formato:** Versionamento Semântico (ex: `1.2.3`).
- **Impacto:** Usado pelo build do Electron, manifest PWA e lógica de verificação de atualização.

#### B. [src/types.ts](../../src/types.ts)
- **Constante:** `APP_VERSION`
- **Formato:** Deve ser idêntico ao `package.json`.
- **Impacto:** Exibido na UI (Configurações > Geral) e usado para logs locais.

#### C. [android/app/build.gradle](../../android/app/build.gradle)
- **Campos:**
  - `versionName`: Deve ser idêntico ao `package.json` (ex: `"1.2.3"`).
  - `versionCode`: Um inteiro incremental.
- **Fórmula Padrão:** `(Major * 10000) + (Minor * 100) + Patch`
  - *Exemplo:* `1.2.2` vira `10202`.
  - *Exemplo:* `1.0.69` vira `10069`.
- **Impacto:** Crítico para atualizações na Google Play Store.

#### D. [package-lock.json](../../package-lock.json)
- **Ação:** Execute `npm install` (ou um build simples) após alterar o `package.json` para garantir que o lockfile esteja sincronizado.

## 🛠️ Fluxo de Lançamento
1. Incremente a versão nos 4 arquivos mencionados acima.
2. Execute `npm run typecheck` para garantir que não haja quebras no `types.ts`.
3. Execute `npm run build:android` para sincronizar a nova versão com o projeto Android.
4. Atualize o `docs/PROJECT_STRUCTURE.md` se a mudança de versão vier acompanhada de mudanças estruturais.
5. Comite todas as mudanças de versão em um único commit "Release vX.Y.Z".
