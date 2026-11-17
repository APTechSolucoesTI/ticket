# Preferências seguras das listagens — plano de implementação

> **For agentic workers:** executar inline com superpowers:executing-plans, diagnóstico e TDD; solicitar revisão independente ao concluir.

**Goal:** cumprir o contrato de listagens do AGENTS: identificação sempre visível, preferências por usuário/listagem, restauração fiel e rascunho aplicado somente após confirmação.

**Architecture:** política/validação pura de preferências, hook com armazenamento por tenant/usuário/listagem, diálogo com rascunho por abertura e tabela com aplicação atômica. Na caixa de tickets, URL explícita prevalece; ausência de tamanho restaura preferência e materializa a URL antes da consulta.

**Tech Stack:** TypeScript, React, Zod, Radix, TanStack Router/Query, localStorage; sem dependência ou migration nova.

**Spec:** AGENTS.md fornecido na conversa, seções 5.3, 5.6, 6.8 e 8; pendências de `docs/security/paginacao-indicadores-20261117.md`.

**Base:** `d99cfb3`, continuação autorizada na branch existente `codex/priority-session-whatsapp`.

## Restrições

- Tamanhos 10/20/30/50/100, padrão 10. Estado remoto continua controlado pelo servidor/URL.
- Pelo menos um identificador visível; colunas essenciais marcadas como obrigatórias não podem ser ocultadas.
- Quando não houver metadado explícito, primeira coluna funciona como identificador para compatibilidade das listagens existentes.
- Storage inválido ou indisponível usa fallback seguro; ordem antiga válida é importada sem gravar novamente no formato legado.
- Cancelar e Escape descartam rascunho; atualizar dados durante diálogo aberto não perde edições. Restaurar padrão não persiste antes de Aplicar.
- Tema claro/escuro, teclado, foco restaurado, controles nomeados e mobile 44 px.
- Nenhuma operação em produção, push ou alteração de banco nesta entrega.

## Foco da revisão

1. Mudança de usuário, tenant ou listKey não mistura preferências.
2. Payloads antigos, inválidos, duplicados ou com colunas removidas mantêm identificação e obrigatórias.
3. Atualização de linhas com diálogo aberto preserva rascunho e posição das colunas.
4. URL compartilhada prevalece sobre preferência; histórico restaura o mesmo tamanho.
5. Aplicar somente colunas não volta à página 1; mudar tamanho volta e não repagina localmente o modo remoto.

## Task 1: política, armazenamento e integração

**Arquivos:** criar `apps/web/src/lib/table-preferences.ts`; modificar `hooks/use-column-preferences.ts`, `components/configurable-table.tsx`, `components/column-settings-dialog.tsx`, `components/ticket/inbox/TicketInboxList.tsx`, rota/hook de tickets e testes de listagem.

- [x] Escrever regressões do hook real para ocultação indevida, duplicatas/legado, obrigatórias, tamanho, isolamento e storage indisponível; observar RED.
- [x] Ampliar ensaio Chrome para perda de rascunho em refetch, Aplicar/Cancelar/Restaurar, identificador e restauração do tamanho; observar RED.
- [x] Implementar validação e normalização de `TablePreferences = {visibleOrder, pageSize}`, identificadores e obrigatórias; armazenamento versionado por identidade/listKey.
- [x] Aplicar preferências de forma atômica; preservar rascunho entre renders; restauração usa defaults reais; controles acessíveis e foco.
- [x] Materializar tamanho inicial na URL da caixa de tickets, preservando URL explícita e histórico; impedir consulta de tamanho provisório.
- [x] Verificar GREEN: regressões, 144 testes API, typechecks, lint aplicável, build e navegador desktop/tablet/mobile claro/escuro.
- [x] Revisão independente, relatório, atualização da documentação e entrega em commit local na branch existente.

## Evidências

- RED observado para ocultação indevida, duplicatas, tenant compartilhado, rascunho perdido e dois cenários de tamanho antigo da revisão independente.
- HTTP reproduziu o 307 com tamanho 10 implícito. Chrome também detectou uma consulta transitória causada pela mistura de location pendente e search do match anterior; a liberação agora usa o mesmo estado validado da consulta.
- GREEN: 22 regressões React/Query/DOM, fronteiras da query, 144 testes API; builds/typechecks web/API e lints aplicáveis. Ensaios Chrome/HTTP e inspeção visual concluídos.
- Revisão independente final sem achados Critical/Important adicionais. Limites de storage/CI/produção registrados no [relatório](../../security/preferencias-listagens-20261117.md).
