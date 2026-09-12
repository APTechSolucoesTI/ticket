# Financeiro: histórico comparativo dos fechamentos

## Escopo

Esta fatia amplia o fechamento mensal com consulta e exportação do histórico de
revisões de cada competência.

## Funcionalidades

- consulta de todas as revisões, inclusive as reabertas;
- comparação da diferença de resultado em relação à revisão anterior;
- identificação dos responsáveis pelo fechamento e pela reabertura;
- exibição das justificativas de reabertura;
- exportação do histórico para PDF e Excel XLSX;
- acesso ao histórico também para usuários financeiros somente leitura.

## Interface

O ícone de histórico aparece nas competências que já tiveram ao menos um
fechamento. O relatório utiliza os dados imutáveis registrados em
`financial_period_closures` e não recalcula revisões anteriores.

## Banco de dados

Esta etapa apenas consulta os registros entregues pela Fatia 27 e não altera o
schema. Portanto, não requer nova migration.

## Próxima fatia

Implementar importação de extrato OFX, conciliação automática de entradas e
saídas e fila de exceções para lançamentos sem correspondência segura.
