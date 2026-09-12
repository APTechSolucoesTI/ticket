# Financeiro: fluxo de caixa consolidado

## Escopo

Esta fatia reúne em uma única visão financeira as contas a receber contratuais e
as contas a pagar de fornecedores. O painel separa previsão e realização sem
alterar as fontes originais dos lançamentos.

## Fontes consolidadas

- Medições aprovadas em `contas_receber`.
- Ciclos de faturamento recorrente em `contas_receber`.
- Lançamentos de fornecedores em `supplier_payables`.
- Programações e baixas efetivas em `supplier_payments`.

Contas a receber históricas sem empresa operadora resolvida não são atribuídas
automaticamente no fluxo. Isso evita apresentar valores em uma empresa incorreta.

## Regras do fluxo

- Recebíveis aparecem como entradas e fornecedores como saídas.
- A previsão usa a data de vencimento do lançamento.
- Uma programação de pagamento substitui o vencimento pela data programada.
- A realização usa a data efetiva da baixa ou do recebimento.
- O valor realizado do fornecedor usa o montante efetivamente pago.
- Diferenças identificadas na conciliação permanecem visíveis no movimento.
- Vencimentos em aberto anteriores à data atual são classificados dinamicamente
  como vencidos.
- Registros cancelados permanecem consultáveis, mas não compõem os indicadores
  projetados.

## Interface

Em **Financeiro > Fluxo de caixa consolidado** estão disponíveis:

- seleção da empresa operadora;
- período inicial e final;
- entradas previstas, saídas previstas, saldo projetado e saldo realizado;
- gráfico mensal comparando saldo projetado e realizado;
- busca por documento, contraparte ou descrição;
- filtros por entrada, saída e status;
- tabela detalhada com origem, vencimento, previsto, realizado e divergência.

O período inicial compreende o mês atual e os cinco meses seguintes.

## Segurança

- A visão `cash_flow_entries` utiliza `security_invoker=true`.
- As políticas RLS das tabelas de origem continuam sendo aplicadas.
- O acesso permanece limitado às empresas concedidas ao usuário financeiro.
- A visão é somente leitura para usuários autenticados.
- Usuários anônimos não possuem acesso.

## Componentes

- View: `cash_flow_entries`.
- Interface: `CashFlowDashboard`, integrada à rota `/finance`.
- Migration: `20260912002745_consolidated_cash_flow.sql`.
- Testes: 24 cenários transacionais de consolidação, valores, datas, status,
  conciliação, privilégios e RLS.

## Próxima fatia

Implementar centros de custo e classificação financeira para permitir análises
de resultado por categoria, fornecedor, cliente e unidade operacional.
