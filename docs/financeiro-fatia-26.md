# Financeiro: exportação do resultado gerencial

## Escopo

Esta fatia adiciona a exportação do demonstrativo gerencial de resultado para
Excel XLSX e PDF diretamente em **Financeiro > Resultado**.

## Conteúdo exportado

Os arquivos preservam o contexto selecionado na tela:

- empresa operadora;
- exercício;
- filtro de centro de custo;
- agrupamento por categoria financeira ou centro de custo;
- valores mensais de janeiro a dezembro;
- acumulado, orçamento e desvio;
- detalhamento de receitas e despesas;
- resultado operacional.

## Excel XLSX

A planilha possui cabeçalho de identificação, filtros aplicados e uma tabela
numérica pronta para conferência, fórmulas complementares e análises externas.

## PDF

O relatório é gerado em A4 horizontal, com identidade visual do APTicket,
cabeçalho repetido quando houver mais de uma página e destaque para os totais
gerenciais.

## Comportamento da interface

- Os botões ficam indisponíveis quando não existem dados no filtro atual.
- A interface informa quando a geração está em andamento.
- O usuário recebe confirmação de sucesso ou uma mensagem em caso de falha.
- As bibliotecas de geração são carregadas sob demanda para não aumentar o
  carregamento inicial da área financeira.

## Banco de dados

Esta fatia utiliza a visão `financial_management_statement` entregue na etapa
anterior e não altera o esquema do banco de dados. Portanto, não requer nova
migration.

## Próxima fatia

Implementar o fechamento mensal do resultado financeiro, com snapshot dos
valores consolidados, trilha de auditoria e bloqueio controlado de alterações
em competências encerradas.
