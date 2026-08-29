# Arquitetura: Sistema de Tradução (i18n)

[English](i18n-system.md) | **Português**

Este documento descreve o sistema customizado de internacionalização (i18n) usado no Mamaco Notes.

## 1. Visão Geral
O app utiliza uma implementação própria de i18n localizada em `src/i18n/`, sem dependências externas. Suporta **pt-BR** (padrão/fallback) e **en**.

## 2. Componentes Core
- **Dicionários**: 
  - `src/i18n/ptBR.ts` (`ptBRMessages`): A fonte de verdade contendo todas as chaves mestras.
  - `src/i18n/en.ts` (`enMessages`): A tradução para o inglês.
- **API**:
  - `t(key, params?)`: Resolve uma string no momento da chamada com suporte a interpolação `{{param}}`.
  - `useI18n()`: Hook React que força a re-renderização quando o idioma é alterado.
  - `setLanguage(lang)`: Atualiza o estado e notifica o Electron.

## 3. Integração
- **React**: Componentes usam `const { t } = useI18n()` para renderizar textos localizados.
- **Metadados**: O `index.html` e os manifests de PWA usam valores iniciais estáticos corrigidos em runtime.
- **Electron**: O processo principal usa seu próprio dicionário `menuMessages`, pois não pode importar arquivos TypeScript do frontend.

## 4. Como Adicionar uma String Nova
1. Adicione a chave e o valor em `src/i18n/ptBR.ts`.
2. Adicione a tradução correspondente em `src/i18n/en.ts`.
3. Use `t('sua.chave')` no código.
4. Para valores dinâmicos, use `t('chave', { nome: 'valor' })` com `{{nome}}` no dicionário.

## 5. Restrições
- **Proibido Hardcoding**: Strings fixas no JSX são proibidas (exceto nomes nativos de idiomas no seletor).
- **Sincronismo**: Ambos os dicionários devem sempre ter o mesmo conjunto de chaves.
