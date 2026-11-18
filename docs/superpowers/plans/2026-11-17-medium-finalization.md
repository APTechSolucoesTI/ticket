# Conclusão das pendências médias

**Base:** `aebaebe`; execução inline e tarefa SQL independente delegada conforme skill dispatching-parallel-agents. Sem push, deploy, credenciais reais ou alterações de produção.

## Desenho e escopo

1. Storage: reconciliar o bucket afetado pelo retry de ingestão, `ticket-attachments`. Relatório por tenant e paginação por nome; preservar referências canônicas/legadas (`path`/`storage_path`) em mensagens, filas pendentes, stickers, bindings e permits ativos. Padrão somente leitura. Aplicação explícita usa manifesto, retenção mínima de sete dias (padrão 30), identidade do objeto e nova checagem no banco. Claim permanente do caminho e triggers coordenados por advisory lock impedem vinculação/recriação concorrente; remoção de bytes exclusivamente pela Storage API, nunca SQL direto. Outros buckets são rejeitados, sem alegar cobertura que não foi implementada.
2. SQL: medir com PostgreSQL descartável, preservar todas as métricas e RLS e reduzir as passagens de agregação somente com equivalência comprovada. Não criar índices por suposição; disponibilizar planos/limites no relatório específico.

**Alternativas Storage:** relatório isolado deixa a correção incompleta; check-then-delete sem coordenação pode excluir arquivo recém-vinculado. Escolhida reserva transacional de caminhos velhos sem referências, com guardas de escrita e exclusão explícita recuperável por retry. O bloqueio é permanente: não reutilizar caminhos de objetos recolhidos. Não haverá release automático, evitando que uma tentativa antiga exclua um upload novo.

## Tarefas

- [x] Regressões RED SQL/CLI e GREEN de referências, idade, escopo, manifestos inválidos/obsoletos, falhas e concorrência real.
- [x] Migration/rollback `20261117190000_ticket_storage_reconciliation.sql` e CLI somente leitura por padrão; PostgreSQL real com os dois sentidos de concorrência e rollback serializado; dez testes do módulo e CLI/SDK HTTP aprovados.
- [x] SQL: migration/rollback `20261117200000_dashboard_grouped_metrics.sql`, equivalência completa em PostgreSQL e EXPLAIN com 50.006 tickets. Intermediário passou de 50.006 para 36/74/158 grupos, sem escrita temporária nos períodos 7/14/30.
- [x] Typecheck API/web, 172 testes API/26 suítes, build API e lint de segurança aprovados (zero erros, 140 warnings existentes); revisões independentes concluídas sem achados restantes. Fixes de cursor/Unicode, isolamento e corrida de rollback verificados.
- [x] Arquitetura/backlog e relatórios atualizados com evidências, limites e procedimentos; entrega preparada para commit local após conferência final.

## Evidências e limites finais

Relatórios: `docs/security/reconciliacao-storage-20261118.md` e `docs/security/dashboard-agregacoes-20261118.md`. Ensaios e relatórios locais não equivalem ao Supabase completo ou a operação de produção. Fixtures usam ferramentas PostgreSQL opcionais no cache ignorado; nenhuma dependência do produto adicionada. A otimização SQL visa materialização/I/O; tempos variaram entre períodos, sem conclusão de latência. Não foi justificado novo índice de tickets por essa distribuição. Migrações, CI completo, homologação, backups, ClamAV e observabilidade permanecem atividades operacionais antes/depois da publicação, sem criar novos defeitos médios de código por suposição.

## Regras

Nenhuma exclusão é executada contra serviços reais nesta sessão. Service role somente no processo operacional, lida de variáveis explícitas, nunca `.env` automático ou browser. Funções operacionais sem EXECUTE para anon/authenticated. Manifesto não é autorização suficiente: claim revalida tudo. Falha de Storage mantém a reserva e pode ser repetida; não liberar automaticamente um caminho reservado. Rollback recusa remover guardas enquanto houver claims, pois isso reabriria a corrida com exclusões pendentes. Mudanças de retenção e exclusão são operacionais, não regras de domínio expostas na UI.
