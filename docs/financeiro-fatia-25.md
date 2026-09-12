# Financeiro: demonstrativo gerencial de resultado

## Escopo

Esta fatia adiciona um demonstrativo gerencial no formato de DRE para acompanhar
receitas, despesas e resultado operacional por exercício. A fonte é o fluxo de
caixa classificado e o orçamento financeiro vigente.

## Estrutura do demonstrativo

O relatório apresenta as seguintes linhas principais:

- receita operacional;
- despesas operacionais;
- resultado operacional.

Cada linha possui valores realizados de janeiro a dezembro, acumulado do
exercício, valor orçado e desvio. As despesas são apresentadas com sinal
negativo para compor corretamente o resultado.

## Análises disponíveis

Em **Financeiro > Resultado** o usuário pode:

- selecionar empresa operadora e exercício;
- filtrar um centro de custo específico;
- consultar somente movimentos sem centro de custo;
- agrupar o detalhamento por categoria ou centro de custo;
- acompanhar receita, despesa, resultado e margem operacional;
- comparar o resultado realizado com o orçamento;
- visualizar a composição mensal em gráfico;
- identificar movimentos sem classificação completa.

Os códigos e nomes exibidos são os snapshots preservados nas classificações e
no orçamento, mantendo a leitura histórica mesmo após o arquivamento de uma
dimensão.

## Cálculos

- Receita realizada: soma das entradas efetivamente recebidas.
- Despesa realizada: soma absoluta dos pagamentos efetivados.
- Resultado operacional: receitas menos despesas.
- Margem operacional: resultado dividido pela receita.
- Desvio: resultado realizado menos resultado orçado.
- Economia de despesa: considerada desvio favorável.
- Gasto acima do orçamento: considerado desvio desfavorável.

## Segurança

- A visão utiliza `security_invoker=true`.
- O acesso respeita as políticas RLS das fontes financeiras.
- O usuário consulta somente empresas concedidas no seu escopo financeiro.
- Usuários anônimos não possuem acesso ao demonstrativo.
- A visão é somente leitura para o cliente autenticado.

## Componentes

- Visão: `financial_management_statement`.
- Interface: `FinancialManagementStatement`.
- Migration: `20260912133321_financial_management_statement.sql`.
- Testes: 21 cenários transacionais de sinais, totais, desvios e RLS.

## Próxima fatia

Implementar exportação do demonstrativo para PDF e Excel XLSX, incluindo os
filtros aplicados e a identificação da empresa operadora.
