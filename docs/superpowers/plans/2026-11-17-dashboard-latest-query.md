# Consulta limitada dos tickets recentes do dashboard

**Base:** `8118406`; execução inline na branch existente, sem push/deploy ou acesso à produção.

**Objetivo e desenho:** remover da RPC `get_ticket_metrics` a chamada completa de `list_ticket_inbox` para obter somente seis registros recentes. Usar uma subconsulta de tickets limitada a seis, antes dos joins de nomes e da serialização JSON. Preservar exatamente o formato de `latest`, a ordenação `created_at DESC NULLS LAST, id ASC`, permissões, tenant e RLS; não alterar as agregações ou os períodos.

**Alternativas:** otimizar a listagem inteira ou criar índices exigiria planos/distribuição reais e afetaria mais fluxos. A consulta dedicada é uma alteração pequena e elimina trabalho que o dashboard não utiliza. A paginação continua independente. A mudança será uma migration incremental com rollback que restaura a implementação anterior; não editar migrations já existentes.

## Tarefas

- [x] Regressões SQL: igualdade de `latest` com os seis primeiros itens da listagem, empates, nomes autorizados/ocultos, zero/poucos itens e isolamento. RED comprovou dependência de EXECUTE da listagem.
- [x] Migration `20261117180000_dashboard_latest_query.sql`, rollback e integração do runner PostgreSQL descartável, com igualdade exata da definição anterior após rollback/reaplicação.
- [x] PostgreSQL real local com mais de 1.200 tickets, contratos web, typecheck web e lint de segurança aprovados (zero erros; 140 warnings existentes).
- [x] Revisão independente sem achados Critical/Important/Minor; relatório técnico/arquitetura atualizados e entrega preparada para commit local após conferência do diff.

## Restrições e revisão

- Função `SECURITY INVOKER`, schema qualificado, `tickets.view`, tenant derivado da sessão e RLS em todas as leituras.
- Left joins de nomes devem permanecer condicionados ao tenant; não limitar após joins se isso repetir processamento de toda a lista.
- Sem promessa de ganho percentual ou latência sem benchmark representativo; os agregados continuam abrangendo o histórico visível.
- Não criar índices por suposição nem mudar contratos do frontend, grants da listagem ou políticas de domínio.
- CI completo Supabase continua distinto do fixture local com PostgreSQL 17.6. A mudança exige aplicar as migrations anteriores antes desta.
