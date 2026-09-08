# Financeiro MSP: fatia 2, fechamento de ciclos

## Entrega para revisão

- `billing_cycles`: snapshot do ciclo fechado, período atendido, termos,
  total e vencimento.
- `billing_cycle_items`: parcelas fixas por versão e variáveis por snapshot,
  com referências às fontes, quantidades, preços, divisor e valor exato.
- Extensão de `contas_receber`, sem criar outro contas a receber: origem
  exclusiva por medição **ou** ciclo, vinculada à empresa operadora.
- `contract_financial_terms`: habilitação explícita, mês âncora do primeiro
  ciclo e métricas obrigatórias.
- RPC de serviço `close_billing_cycles` e Edge Function
  `fechar-ciclos-financeiros`. Agendamento horário pelo pg_cron/pg_net,
  utilizando os segredos existentes no Vault.
- RLS nas tabelas novas e políticas restritivas para recebíveis recorrentes,
  preservando o comportamento dos recebíveis legados.
- Auditoria das inclusões e mudanças de status do recebível recorrente.
  Nenhum evento operacional, gateway ou tela nova nesta fatia.

## Cálculo e reaproveitamento

O contrato existente continua sendo a fonte de cliente, vigência, status e
vencimento. A rotina existente `calcular_vencimento_medicao` é reaproveitada,
inclusive para dias úteis e feriados. O gate de tickets não foi alterado.

O valor-base versionado é **mensal**, coerente com `contracts.monthly_value`.
Em um ciclo de N meses, a parcela fixa integral é `base_amount * N`. O pró-rata
usa dias corridos efetivamente atendidos / dias corridos do ciclo completo.
Início e término parciais e reajustes intermediários geram parcelas distintas;
cada parcela é arredondada para centavos antes da soma.

O corte limita dias 29/30/31 ao último dia do mês, sem causar deriva no mês
seguinte. Os períodos são `[início, fim)`; o término do contrato é inclusivo.
O vencimento é calculado no mês do fechamento ou no seguinte quando o dia
configurado antecederia o fechamento. O lote usa a data de São Paulo.

O variável usa exclusivamente os snapshots da primeira fatia. **Não há coleta
nova nem recálculo dos equipamentos/usuários/tickets/horas neste fechamento.**
Cada métrica obrigatória precisa cobrir o período atendido inteiro, mesmo que
seja um snapshot com consumo zero. Ausência de apuração não significa zero.
Snapshots fora do ciclo, de métricas não configuradas ou já faturados não são
reutilizados de forma silenciosa. O mesmo snapshot continua disponível para
o futuro rateio de AP.

## Atomicidade, idempotência e segurança

- Cada ciclo gera cabeçalho, itens e recebível na mesma transação/subtransação.
  Se houver falha, não deixa recebível ou ciclo parcial. Ciclos anteriores do
  lote permanecem íntegros.
- Lock por contrato e chaves únicas impedem duplicação por retry. O próximo
  ciclo é derivado do último fechado, inclusive se este foi excluído logicamente.
- Total/itens fechados são imutáveis. Fontes já faturadas não podem ser excluídas;
  reajuste retroativo, consumo tardio e alteração do calendário faturado são
  bloqueados. Correções deverão usar um futuro fluxo de estorno, não reescrita.
- O recebível nasce `a_faturar`, sem emitir documento fiscal ou cobrança externa.
- Uma cobrança legada sobreposta bloqueia a recorrência. A aprovação de medição
  não pode gerar recebível sobre período habilitado para recorrência ou já fechado.
- Não existe ativação automática de contratos nem inferência da empresa operadora.
- Somente `service_role` executa o RPC. A Edge Function encaminha o JWT recebido,
  sem trocar o token do usuário por uma chave privilegiada. O PostgREST valida
  o JWT e os privilégios; anônimo/usuário comum não executam o fechamento.
- O job não altera contratos suspensos/cancelados. Contratos ativos e expirados
  podem fechar períodos efetivamente atendidos; término parcial vem de `ends_at`,
  não de uma data de cancelamento inferida.

## Operação técnica nesta etapa

Antes de habilitar um contrato, o backend deve provisionar empresa e acessos,
termos, valores vigentes e snapshots exigidos, conforme a fatia 1. Configurar:

- `billing_anchor_month`: primeiro dia do mês do primeiro ciclo a cobrar;
- `cutoff_day` e `billing_interval_months`: calendário de fechamento;
- `required_metrics`: métricas esperadas, ou array vazio para fixo puro;
- `billing_enabled = true`: adesão explícita após conferir a transição do legado.

Não habilitar antes de conferir apuração e histórico. Ainda não há tela para
essa configuração. A listagem financeira existente consegue mostrar os novos
recebíveis, respeitando as permissões, mas o cabeçalho ainda menciona medições;
não há botão de boletim para uma origem sem medição. O detalhamento dos itens
está disponível no banco/API autorizada, não em tela dedicada nesta entrega.

Requisição interna: `POST /functions/v1/fechar-ciclos-financeiros`, com JWT de
serviço no Authorization e JSON `{ "limit": 50 }`. Opcionalmente informar
`contract_id` e `as_of` (AAAA-MM-DD, nunca futuro). Limite: 1 a 100 ciclos.
Nenhum segredo deve ser colocado no frontend.

Resposta: `generated`, `errors` por contrato e `limit_reached`. HTTP 409 indica
falha parcial; corrigir a apuração/configuração e repetir. HTTP 503 pode ocorrer
em indisponibilidade/timeout; retry é seguro. O lote padrão é 50 e o agendamento
executa no minuto 10 de cada hora. Consultar logs da Edge Function e respostas
do pg_net para acompanhar falhas. A fila do pg_net não é um histórico permanente.

## Validação e publicação

Migration: `20260908153237_recurring_cycle_closure.sql`.
Testes: `supabase/tests/recurring_cycle_closure_test.sql` (46 cenários),
44 testes da fundação e 31 do motor de medições, com rollback dos fixtures.
A função tem quatro testes de handler, sem dependências externas de teste,
além de typecheck e lint Deno. Total: 125 testes.

Publicar a migration antes da Edge Function. Depois da publicação e do teste
de acesso, executar como administrador do banco:
`select apticket_finance_private.schedule_cycle_closure();`.
Os segredos reutilizados são `apticket_internal_functions_url` e
`apticket_edge_service_role_key`, no Vault. Não há chaves na migration.

Referência de implantação usada pelo skill Supabase:
[agendamento de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

Implantação confirmada em 08/09/2026: migration aplicada e registrada; Edge
Function publicada no Supabase self-hosted a partir do código versionado;
cron `apticket-fechar-ciclos-financeiros` ativo. Teste HTTP de serviço retornou
200 com zero cobranças e chamada sem autenticação retornou 401. Os 125 testes
passaram; typecheck e lint também. O advisor de segurança executou sem apontar
os novos objetos financeiros; verificações de catálogo confirmaram RLS e RPC
sem permissão de execução para anon/authenticated.

Backup estrutural anterior à migration no servidor:
`/home/administrador/apticket-backups/apticket_schema_before_cycle_closure_20260908.sql.gz`.
Nenhum contrato real habilitado e nenhum recebível real criado nesta publicação.
O deploy necessário foi o da Edge Function; o frontend/Dokploy não exigiu
rebuild, pois não houve alteração no aplicativo web.

## Próximo ponto de revisão

Esta fatia não emite boleto/PIX/cartão, não implementa NFS-e, AP, conciliação,
régua de cobrança, dashboard, cadastro visual de regras ou coleta automática
de snapshots. Revisar o cálculo mensal/pró-rata e a transição do legado antes
da próxima integração. Nenhum contrato real deve ser habilitado por inferência.
