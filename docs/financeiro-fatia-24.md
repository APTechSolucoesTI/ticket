# Financeiro: orçamento e desempenho

## Escopo

Esta fatia adiciona o orçamento financeiro mensal por empresa operadora,
categoria e centro de custo. O comparativo reúne valor orçado, valor previsto,
valor realizado e desvio em uma visão anual.

## Lançamentos orçamentários

Em **Financeiro > Orçamento e desempenho > Novo orçamento**, o usuário com
permissão financeira de escrita informa:

- competência mensal;
- natureza de entrada ou saída;
- categoria financeira compatível;
- centro de custo;
- valor orçado;
- observações opcionais.

Cada combinação de competência, natureza, categoria e centro de custo possui
uma única versão vigente. Ao revisar um valor, o sistema encerra a versão
anterior, incrementa a revisão e preserva o histórico.

A remoção encerra somente a versão vigente. Nenhum registro histórico é
excluído fisicamente.

## Comparativo

A visão anual apresenta:

- entradas e saídas orçadas;
- entradas e saídas realizadas;
- resultado orçado;
- resultado realizado;
- desvio absoluto e percentual;
- gráfico mensal de resultado orçado e realizado;
- filtro por exercício, mês, natureza e texto;
- movimentos classificados que ainda não possuem orçamento.

O previsto utiliza a data planejada do fluxo de caixa. O realizado utiliza a
data efetiva e o valor baixado ou recebido. Movimentos cancelados não participam
dos totais.

Para entradas, um desvio positivo é favorável. Para saídas, um desvio positivo
indica gasto acima do orçamento e é destacado como desfavorável.

## Segurança

- A tabela utiliza RLS por tenant e empresa operadora.
- Somente usuários com acesso financeiro de escrita alteram o orçamento.
- A escrita direta pela API é bloqueada.
- As operações passam por funções com validação explícita do usuário e escopo.
- Exclusões físicas e truncamentos são bloqueados.
- Todas as versões são auditadas.
- A visão `financial_budget_variance` utiliza `security_invoker=true`.

## Componentes

- Tabela: `financial_budget_entries`.
- Visão: `financial_budget_variance`.
- Funções: `save_financial_budget_entry` e
  `clear_financial_budget_entry`.
- Interface: `FinancialBudgetDashboard` e `FinancialBudgetDialog`.
- Migration: `20260912123543_financial_budgets.sql`.
- Testes: 28 cenários transacionais de cálculo, revisão, permissões e RLS.

## Próxima fatia

Implementar demonstrativo gerencial de resultado por categoria e centro de
custo, com detalhamento mensal e acumulado do exercício.
