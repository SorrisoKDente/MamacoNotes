# Habilidade: Android Nativo e Bridge Capacitor

[English](android-native.md) | **Português**

Esta habilidade define as restrições técnicas para trabalhar com a plataforma Android no Mamaco Notes.

## 🧠 Princípios Core

### 1. Segurança de Memória (Anti-OOM)
- **O Problema da Bridge Capacitor:** Enviar objetos maiores que 32MB através de `CapacitorHttp` ou `Filesystem.writeFile` causará o fechamento do app com `java.lang.OutOfMemoryError`.
- **A Solução:** Sempre use **E/S em Chunks (Pedaços)**.
  - **Downloads:** Use `downloadText` em `http.ts` (requisições HTTP Range).
  - **Uploads:** Use `uploadFileStreaming` em `chunkedIo.ts` (stream baseado em plugin).
  - **Arquivos Locais:** Use os métodos do plugin `PickDirectory` (`readChunk`, `writeChunk`).

### 2. Gestão de Plugins
- **Plugin Local:** O plugin `PickDirectory` reside em `/plugins/pick-directory`.
- **Evitar Conflitos:** Nunca crie classes de plugin duplicadas em `android/app/src/main/java/com/mamaconotes/app/`. A bridge do Capacitor deve apontar apenas para o diretório `/plugins`.
- **Registro:** Certifique-se de que `PickDirectoryPlugin.class` esteja registrado no `onCreate` da `MainActivity.java`.

### 3. Storage Access Framework (SAF)
- Use URIs `content://` para diretórios persistentes selecionados pelo usuário.
- Sempre verifique `!file.exists()` antes de realizar operações em `DocumentFile`.
- Use `ACTION_CREATE_DOCUMENT` para a funcionalidade "Salvar Como" para garantir o controle do usuário sobre a localização do arquivo.

## 🛠️ Fluxo de Build
1. Aplique as mudanças no código Web ou arquivos Java.
2. Rode `npx cap sync android` para sincronizar assets e plugins.
3. Valide o build com `npm run build:android`.
4. Use `read_logcat` para debugar crashes nativos (procure por `OutOfMemoryError` ou `NullPointerException`).
