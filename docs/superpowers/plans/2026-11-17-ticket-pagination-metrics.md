# Paginação remota e indicadores completos

**Base:** `3bedd3b`; branch local existente. Aplicar diagnóstico, regressões e revisão independente.

## Contrato

- `list_ticket_inbox`: RPC invoker, tenant/usuário derivados da sessão/RLS, página inicial 1 e tamanho 10; tamanhos 10/20/30/50/100. Busca literal por número/assunto/cliente/contato; filtros combinados; ordenação por whitelist e desempate estável por ID; total exato e ajuste da última página.
- `get_ticket_metrics`: agregações de todos os tickets visíveis, sem limite de 500. Períodos 7/14/30, dias em America/Sao_Paulo, médias válidas e SLA aberto sem pausa. Retornar somente seis tickets recentes além dos agregados.
- Validar entradas e respostas com Zod; query keys incluem usuário, tenant, filtros e paginação; cancelar buscas obsoletas e manter resultado anterior com indicação de atualização.
- Estado da listagem na URL. Paginação compartilhada entre lista e Kanban; informar que o quadro representa a página atual. Busca com debounce de 350 ms.
- Reutilizar ConfigurableTable com modo remoto, evitando paginação/ordenação somente da página. Preservar comportamento das outras listagens.
- Migração incremental e rollback; nenhuma publicação ou alteração de produção nesta entrega.

## Tarefas

- [x] Regressões SQL com mais de 1.000 tickets, paginação/filtros/ordem e isolamento de tenant/permissão.
- [x] Migração e tipos/validação das RPCs.
- [x] Hook remoto, URL, atualização e integração lista/Kanban; regressões do controle da tabela.
- [x] Dashboard e visão geral usando agregados completos; últimos seis registros com nomes autorizados.
- [x] PostgreSQL isolado, testes API/sessão, typechecks, lint, builds e revisão independente.
- [x] Inspeção desktop/tablet/mobile, documentação e entrega em commit local na branch existente.

## Evidências e revisão

Relatório: [paginação e indicadores](../../security/paginacao-indicadores-20261117.md).

A revisão independente reproduziu o salto de página ao misturar snapshot anterior com tamanho novo, inclusive quando offline. A correção mantém página/tamanho do mesmo snapshot e bloqueia controles durante consulta/placeholder. O ensaio Chrome confirmou a troca página 3/tamanho 10 → página 1/tamanho 100, com pausa offline e resposta atrasada. Também foram adicionadas comparação natural pt-BR e regressões do modo local da tabela.

Limites registrados no relatório: job Supabase completo somente no CI; lint Windows com exceção local de CRLF; nenhuma operação em produção.
