# Habilidade: Build Desktop e Instalador Windows

[English](desktop-build.md) | **Português**

Esta habilidade cobre a gestão de processos Electron e a configuração do instalador Windows NSIS.

## 🧠 Princípios Core

### 1. Ciclo de Vida do Processo (Instância Única)
- O app deve implementar `requestSingleInstanceLock()`.
- Processos secundários (como o lançamento de um novo instalador) devem ser encerrados imediatamente com `app.exit(0)` para evitar travas de arquivo nos arquivos `.asar` e `.exe`.
- Use `app.on('before-quit', ...)` para forçar a limpeza imediata das conexões com o banco de dados.

### 2. Estabilidade do Instalador NSIS
- **Identidade Fixa:** O instalador deve basear-se no `appId` como seu GUID primário. Nunca use GUIDs gerados aleatoriamente no `package.json`.
- **Escopo:** O padrão deve ser `perMachine: false` (Instalação por usuário) para evitar prompts de administrador obrigatórios, mas habilite `allowElevation: true` para lidar com a limpeza de instalações antigas em "Program Files".
- **Desinstalação:** Sempre forneça a opção `deleteAppDataOnUninstall: true` para permitir que os usuários limpem seus dados do `IndexedDB` durante a remoção.

## 🛠️ Verificação
- Teste a saída do build usando `npm run build:win`.
- Valide o comportamento do instalador localmente antes de fazer push de tags que disparam o GitHub Actions.
