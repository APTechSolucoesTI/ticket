# Financeiro: centros de custo e categorias

## Escopo

Esta fatia adiciona a classificação gerencial dos movimentos do fluxo de caixa.
Cada recebimento ou pagamento pode ser associado a uma categoria financeira e a
um centro de custo da empresa operadora.

## Cadastros

Em **Financeiro > Fluxo de caixa consolidado > Classificações** o usuário pode
consultar e, quando possuir permissão de escrita, cadastrar:

- categorias exclusivas para entradas;
- categorias exclusivas para saídas;
- categorias compatíveis com ambas as naturezas;
- centros de custo da empresa operadora selecionada.

O código é normalizado em letras maiúsculas e deve ser único dentro da empresa.
Cadastros já utilizados não podem ser alterados. Eles podem ser arquivados para
impedir novos usos sem afetar o histórico.

## Classificação dos movimentos

O botão de edição na linha do fluxo abre a classificação do movimento. A
categoria deve ser compatível com entrada ou saída e o centro de custo deve
estar ativo.

Uma reclassificação encerra a versão anterior e cria uma nova versão. O fluxo
exibe sempre a versão atual, enquanto códigos, nomes, responsável e data das
versões anteriores permanecem preservados para auditoria.

A classificação também pode ser removida. Essa operação encerra a versão atual
e volta a apresentar o movimento como não classificado.

## Consulta

O painel apresenta:

- percentual de movimentos classificados no período;
- categoria e centro de custo em cada lançamento;
- filtro por categoria;
- filtro por centro de custo;
- filtro específico para movimentos ainda não classificados.

## Segurança

- Todas as tabelas utilizam RLS por tenant e empresa operadora.
- Somente usuários com acesso financeiro de escrita executam alterações.
- As tabelas não permitem escrita direta pelo cliente autenticado.
- As operações são realizadas por funções validadas no banco.
- Exclusões físicas e truncamentos são bloqueados.
- Inclusões, alterações e encerramentos de versão são auditados.
- A visão `cash_flow_entries` continua com `security_invoker=true`.

## Componentes

- Tabelas: `financial_cost_centers`, `financial_categories` e
  `financial_entry_classifications`.
- Funções: criação, edição, arquivamento, classificação e remoção da
  classificação atual.
- Interface: `FinancialDimensionsDialog` e
  `FinancialEntryClassificationDialog`, integradas ao `CashFlowDashboard`.
- Migration: `20260912003727_financial_cost_centers_and_categories.sql`.
- Testes: 29 cenários transacionais de regras, histórico, permissões e RLS.

## Próxima fatia

Implementar orçamento por categoria e centro de custo, com comparação entre
valor orçado, realizado e desvio no período.
