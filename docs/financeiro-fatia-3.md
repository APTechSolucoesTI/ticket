# Financeiro: consulta de faturas recorrentes

## Escopo desta revisão

Por solicitação do usuário, a homologação real do Inter ficou para o final.
Esta fatia intermediária dá visibilidade ao fechamento já existente, sem
depender de chamadas bancárias ou habilitar contratos reais.

Em **Financeiro > Contas a receber de contratos**:

- Identificação da origem: Medição ou Ciclo recorrente.
- Filtro por origem, combinado com o filtro de status existente.
- **Detalhar fatura** para ciclos: período completo e efetivamente atendido,
  vencimento original, total congelado, itens fixos/variáveis e referências
  das versões de valor e apurações de consumo.
- Fórmula do pró-rata com dias atendidos, valor integral do ciclo e divisor.
- Valores unitários com até seis casas decimais; valores finais exibidos
  conforme os centavos calculados no banco, sem refazer o cálculo.
- Os boletins de medição e a revisão financeira existentes são preservados.

O vencimento mostrado no detalhe é o do fechamento. Saldo/status/vencimento
atualizados continuam na listagem e revisão existentes. Períodos exclusivos
no banco são apresentados com a última data incluída na tela.

## Segurança e limites

`getBillingCycle` usa sessão validada e cliente Supabase do próprio usuário,
sem service role. Reutiliza a RLS existente de ciclos/itens e a concessão
explícita por empresa/grupo. Admin sem concessão não ganha acesso financeiro.
Consulta paginada dos itens evita truncamento silencioso; faturas com dez mil
itens ou mais são recusadas com orientação, não exibidas parcialmente.

Não há novas tabelas, políticas, eventos ou migrations nesta fatia. Não há
escrita financeira, emissão bancária, conciliação, coleta de consumo ou
provisionamento automático de acessos. Não foi feita chamada ao Inter.
Sem ciclos reais fechados, o botão aparece apenas quando houver um recebível
recorrente autorizado; não são inseridos dados de demonstração em produção.

## Validação

- 46 testes pgTAP do fechamento/isolamento executados no Supabase com rollback.
- Build e lint dos arquivos alterados passaram.
- Typecheck: somente os 18 erros preexistentes em `demo.Tickets.$id.tsx`.
- `scripts/test-cycle-ui.mjs`: fluxo da página real com APIs simuladas, em
  1440/768/390 px, filtro de origem, detalhe, erro/retry, data final inclusiva,
  precisão unitária e limites do modal. Evidências locais fora do Git.

## Próxima fatia do roteiro

Emissão e conciliação idempotentes via Edge Functions continuam pendentes,
assim como telas de regras/provisionamento. A consulta não substitui essas
entregas. Testes de homologação do Inter permanecem pendentes para o final,
antes de habilitar emissão real.
