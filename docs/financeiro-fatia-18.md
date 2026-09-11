# Financeiro: lançamentos e rateio de custos por consumo

## Escopo

Esta fatia transforma os contratos recorrentes de fornecedores em contas a pagar
por competência. O fechamento é manual pela interface nesta etapa e é idempotente:
repetir a geração do mesmo contrato e período devolve o lançamento existente.

## Cálculo

- Contrato fixo gera o valor contratado e fica com rateio pendente.
- Contrato por usuário ativo ou dispositivo reutiliza `consumption_snapshots`.
- Cada snapshot gera um item de rateio ligado ao contrato do cliente.
- Quantidade, preço unitário, cliente, número do contrato e evidência de origem são
  congelados no momento da geração.
- O total é a soma dos itens já arredondados em centavos.
- Competências incompatíveis com a periodicidade ou sem consumo apurado são
  recusadas com mensagem explícita.

## Interface

Em **Financeiro > Contas a pagar > Lançamentos de fornecedores** é possível:

- gerar um lançamento selecionando contrato e competência;
- consultar total lançado e quantidade de rateios pendentes;
- pesquisar por documento, fornecedor ou contrato;
- filtrar rateios concluídos e pendentes;
- abrir o detalhamento do custo distribuído por cliente e contrato.

Custos fixos exibem `Rateio pendente`. As regras percentuais para esses custos
serão configuradas na próxima fatia.

## Segurança e auditabilidade

- RLS por tenant e empresa operadora nas duas tabelas novas;
- somente usuário com escrita financeira pode executar a geração;
- inserção direta pelo cliente, exclusão física e alteração de lançamentos são
  bloqueadas;
- snapshots utilizados no rateio não podem ser arquivados;
- condições financeiras já utilizadas do contrato do fornecedor não podem ser
  reescritas;
- lançamentos e itens entram na auditoria financeira;
- o RPC valida o escopo antes de executar com privilégio elevado.

## Componentes

- Tabelas: `supplier_payables` e `supplier_payable_allocations`.
- RPC: `generate_supplier_payable`.
- Interface: `SupplierPayables`, integrada ao cadastro de fornecedores.
- Testes: 25 cenários transacionais de cálculo, idempotência, isolamento, RLS,
  imutabilidade e auditoria.

## Próxima fatia

Cadastrar regras percentuais de rateio para custos fixos e aplicar essas regras
aos lançamentos antes do fluxo de aprovação por alçada.
