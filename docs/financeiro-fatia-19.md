# Financeiro: rateio de custos fixos de fornecedores

## Escopo

Esta fatia permite distribuir o valor de um contrato fixo de fornecedor entre
contratos de clientes. As regras são versionadas por mês de vigência e cada
versão deve totalizar exatamente 100%.

## Regras de negócio

- Apenas contratos de fornecedor ativos e com cobrança fixa aceitam a
  configuração.
- Somente contratos de clientes vinculados à mesma tenant e empresa operadora
  podem participar.
- Um contrato de cliente aparece no máximo uma vez em cada versão.
- Percentuais devem ser maiores que zero, limitados a 100% e somar exatamente
  100%.
- Para uma competência, vale a versão mais recente cuja vigência seja anterior
  ou igual ao início do ciclo.
- Uma versão que já originou rateios é imutável. Alterações posteriores exigem
  uma nova vigência.
- Uma versão ainda não utilizada pode ser corrigida antes do fechamento.
- O arredondamento é feito em centavos e eventual resíduo fica na parcela de
  maior percentual, preservando exatamente o valor total da conta.
- Cliente, contrato, percentual e origem da regra ficam congelados em cada
  parcela gerada.

## Interface

Em **Financeiro > Contas a pagar > Fornecedores**, contratos fixos exibem o
botão de percentual. Ao abrir o rateio, o usuário pode:

- escolher o mês inicial de vigência;
- aproveitar como base a regra vigente no mês anterior;
- incluir ou remover contratos de clientes;
- informar até seis casas decimais por percentual;
- acompanhar visualmente o total distribuído;
- salvar somente quando a distribuição atingir 100%.

Ao salvar, a regra é aplicada automaticamente a todos os lançamentos pendentes
do contrato alcançados pela vigência. O detalhe do lançamento mostra o
percentual e o custo atribuído a cada cliente. O botão **Aplicar rateio** permite
reprocessar manualmente um lançamento pendente depois da configuração.

## Segurança e auditoria

- RLS isola versões e regras por tenant e empresa operadora.
- Leitores financeiros podem consultar, mas apenas perfis com escrita
  financeira podem configurar ou aplicar rateios.
- Inserção direta pelo cliente e exclusão física são bloqueadas.
- As funções públicas validam novamente tenant, empresa e permissão financeira.
- Alterações de regras e parcelas geradas entram na auditoria financeira.

## Componentes

- Tabelas: `supplier_allocation_rule_sets` e `supplier_allocation_rules`.
- RPCs: `save_supplier_allocation_rules` e
  `apply_supplier_payable_allocation`.
- Interface: `FixedAllocationDialog`, integrada a `PayableSuppliers`, e detalhe
  ampliado em `SupplierPayables`.
- Testes: 29 cenários transacionais de validação, versionamento, arredondamento,
  aplicação automática, idempotência, isolamento, RLS, imutabilidade e
  auditoria.

## Próxima fatia

Implementar aprovação de contas a pagar por alçada, com responsáveis, limites,
histórico de decisões e bloqueio do pagamento até a conclusão do fluxo.
