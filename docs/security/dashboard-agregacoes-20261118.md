# Agregações agrupadas do dashboard

Escopo local de 18/11/2026, complementar a `consulta-recentes-dashboard-20261117.md`. Migration/rollback: `20261117200000_dashboard_grouped_metrics.sql`.

## Consulta e contrato

A função `apticket.get_ticket_metrics(integer)` deixa de materializar cada ticket visível para reler esse histórico nas agregações de criação, conclusão e totais. Agora agrega primeiro por um par de datas do calendário de São Paulo: criação e conclusão (`coalesce(resolved_at,closed_at)`). Cada data fora da janela é agrupada em `NULL`. Os totais históricos continuam incluindo esses registros.

Para uma janela de D dias, o conjunto intermediário tem no máximo `(D+1)^2` linhas, independentemente do total de tickets visíveis. O banco ainda precisa ler o histórico visível para calcular status, SLA e durações; o limite se refere à materialização e às suas releituras. A função continua fazendo a consulta separada de até seis tickets recentes, introduzida na migration anterior.

O calendário é uma relação explícita pequena, ligada duas vezes aos tickets antes do agrupamento. Isso permite ao planner estimar os grupos pelas datas do calendário, em vez de estimar milhares de grupos a partir de expressões sobre timestamps. A série possui limite constante de 30 dias e é filtrada pelo período validado (7, 14 ou 30); essa cardinalidade pequena também fica visível em planos genéricos. Não há alteração de `work_mem` ou de opções do otimizador na função.

As contagens são somadas como inteiros. A média usa a soma exata das durações numéricas dividida pelo total de amostras válidas, preservando `NULL` quando não existe amostra. Não se calcula média de médias. Datas inclusivas, timestamp da instrução, preferência de `resolved_at` sobre `closed_at`, duração não negativa, SLA pausado/avulso e buckets zerados permanecem com as regras anteriores.

Assinatura, chaves JSON, `SECURITY INVOKER`, `search_path`, grants, tenant da sessão, permissão `tickets.view` e RLS permanecem no contrato. Não há índice novo, tabela de produto ou dependência adicional. O rollback restaura exatamente a função da migration `20261117180000`, incluindo a consulta limitada de recentes.

## Testes e reprodução

`supabase/tests/ticket_metrics_aggregate_test.sql` é independente do runner local: contém a versão anterior completa como oracle dentro da transação do teste, cria 2.006 tickets principais e seis de outro tenant e desfaz helper, fixtures, grants e políticas em `ROLLBACK`. Compara o JSON inteiro para 7/14/30 dias, conclusão fracionária/negativa/ausente, duração zero, ambos os timestamps de conclusão, futuro, RLS parcial, conjunto vazio e conjunto sem amostra válida. A suíte anterior cobre também nomes relacionados ocultos, permissões e ordenação de recentes.

O runner opcional recria a mesma distribuição com 50.006 tickets principais em 730 dias e seis de outro tenant. Usa PostgreSQL 17.6 descartável em loopback, os índices e políticas selecionados do schema versionado e papel `authenticated`. Extrai o SQL agregado das funções realmente instaladas e executa `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` com os mesmos parâmetros de tenant/tempo/período e `work_mem=1MB`. Explicar apenas a chamada PL/pgSQL mostraria somente o nó `Result`.

```powershell
node scripts/security/test-ticket-metrics-performance.mjs --baseline --output baseline.json
node scripts/security/test-ticket-metrics-performance.mjs --output grouped.json
```

O primeiro comando deve falhar no orçamento de recursos da implementação anterior. O segundo exige equivalência, rollback exato/reaplicação, ausência de escrita temporária no agregado e materialização limitada por pares de datas. O script não aceita URL de banco remoto; o único diretório opcional é o de ferramentas locais PostgreSQL já utilizado pelo runner transacional existente.

## Evidência e limites

RED observado: a implementação anterior materializou 50.006 linhas e escreveu 253 blocos temporários em todos os três períodos, falhando a asserção `253 !== 0`. Registro: `evidence/dashboard-metrics-baseline-20261117.json`. Algumas durações desse arquivo foram afetadas pela interrupção da sessão; não servem para comparação de latência.

Uma primeira tentativa de agrupar diretamente por expressões de timestamp reduziu as linhas materializadas, mas o planner estimou milhares de grupos e escolheu `GroupAggregate` com ordenação em disco: 307–308 blocos temporários. O teste de recurso rejeitou essa tentativa, cujos planos estão em `evidence/dashboard-metrics-grouped-sort-20261118.json`. A relação explícita de calendário corrige a estimativa sem forçar a escolha do otimizador.

GREEN final: o runner terminou com código 0, incluindo regressões, equivalência, rollback/reaplicação e os três planos reais. Cada agregado leu 50.006 tickets uma única vez, com RLS. O intermediário anterior continha 50.006 linhas e escreveu 253 blocos temporários em todos os períodos.

| Dias | Grupos materializados | Memória do HashAggregate principal | Blocos temporários novos | Tempo observado anterior → novo |
|---:|---:|---:|---:|---:|
| 7 | 36 | 48 kB | 0 | 28,35 s → 30,06 s |
| 14 | 74 | 80 kB | 0 | 28,12 s → 28,56 s |
| 30 | 158 | 160 kB | 0 | 30,14 s → 28,49 s |

Os planos completos estão em `evidence/dashboard-metrics-grouped-20261118.json`. São amostras únicas, em máquina compartilhada e sem aquecimento padronizado: comprovam a redução de materialização/I/O temporário nesta fixture, sem demonstrar redução de latência. Não se afirma ganho percentual nem latência de produção. A fixture possui alta concentração em um tenant, e os planos parametrizados extraídos podem diferir de planos genéricos em cache da RPC. Dados reais, concorrência, cache, versão/configuração e custos das políticas influenciam o plano real.

Não foi adicionado índice por suposição: os indicadores precisam de todo o histórico autorizado, e esta distribuição não demonstra seletividade de tenant suficiente para justificar outro índice. Índices existentes são incluídos na medição; uma decisão futura de índice exige observar o plano e a distribuição no ambiente apropriado. Nenhuma conexão, migração, publicação ou alteração de dados em produção foi feita nesta validação.
