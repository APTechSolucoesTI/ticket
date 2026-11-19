# Registration Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Uniformizar as janelas de cadastro sem perda de rascunhos ao minimizar.

**Architecture:** Evoluir o componente Radix compartilhado e registrar suas janelas minimizadas em uma barra global. Separar geometria/controles do corpo existente, mantendo as regras de negócio em seus módulos.

**Tech Stack:** React 19.2, TypeScript, Radix, Tailwind 4, Lucide, Playwright/Vite para testes isolados.

**Spec:** `docs/superpowers/specs/2026-11-19-registration-windows-design.md`

## Global Constraints

- Fundo bloqueado enquanto aberto e liberado somente ao minimizar.
- Preservar estado e DOM; não chamar `onOpenChange(false)` ao minimizar.
- Tokens semânticos, temas claro/escuro, foco e teclado acessíveis.
- Nenhuma chave privilegiada ou persistência nova de dados sensíveis no browser.
- Sem reescrever histórico publicado e sem migration nesta atualização.

## Review Focus

- Minimização não deixa `aria-hidden`, scroll lock ou focus trap ativos.
- Campos não controlados, arquivos e estado interno sobrevivem à restauração.
- Diálogos aninhados e menus portados continuam acima da janela correta.
- Classes particulares de formulários não impedem maximização ou rolagem.
- Confirmações obrigatórias não ganham uma forma de escapar do fluxo.

### Task 1: Contrato compartilhado e testes de navegador

**Files:** `apps/web/src/components/ui/dialog.tsx`, `dialog-window.tsx`, `dialog-window-state.ts`, `dialog-resources.ts`, `apps/web/src/components/rich-text-editor-impl.tsx`, `apps/web/src/routes/__root.tsx`, `scripts/security/test-dialog-windows.mjs`.

**Interfaces:** preservar exports existentes; adicionar `windowControls?: boolean`, `showCloseButton?: boolean` a `DialogContent` e uma barra `DialogWindowDock` no root.

- [x] Criar fixture isolada com os componentes reais e testes de comportamento; registrar RED pela ausência dos controles.
- [x] Implementar geometria, cabeçalho acessível, minimizar/restaurar com estado preservado e barra global.
- [x] Confirmar em navegador a suspensão e restauração dos efeitos Radix e a manutenção de texto/arquivo/estado React.
- [x] Testar arraste, teclado, resize, aninhamento, menus, temas e três tamanhos de tela; corrigir o mecanismo se `Activity` não cumprir o contrato.
- [x] Executar typecheck/lint/build e revisar a integração nos cadastros com classes especiais.

### Task 2: Migração dos modais artesanais de tickets

**Files:** `apps/web/src/routes/_authenticated/tickets.$id.tsx`.

**Interfaces:** consumir o contrato da Task 1. Manter callbacks de pausa, apontamento, situação e início do atendimento.

- [x] Migrar pausa, apontamento e históricos para o componente compartilhado; o apontamento Salvar/Ignorar mantém bloqueio obrigatório, conforme a especificação.
- [x] Preservar o callback completo de Ignorar apontamento ao fechar e os bloqueios de mutação.
- [x] Migrar as três escolhas obrigatórias em modo sem controles de janela, sem fechamento por Escape/fundo.
- [x] Verificar nomes acessíveis, guards `readOnly`, typecheck e regressões dos fluxos.

### Task 3: Verificação e publicação

**Files:** workflow de segurança e evidências/documentação da entrega, se necessário.

- [ ] Integrar o teste novo ao CI e executar os checks aplicáveis.
- [ ] Realizar revisão independente da implementação e do inventário de cobertura.
- [ ] Enviar commits, aguardar CI verde e integrar na main sem reescrever histórico.
- [ ] Publicar frontend no Dokploy, preservar reversão e validar serviços/HTTPS e configuração pública do build.
- [ ] Confirmar deploy automático reativado e relatar commit, CI e resultado.
