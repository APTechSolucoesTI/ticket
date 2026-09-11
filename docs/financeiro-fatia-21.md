# Financeiro: programação e baixa de pagamentos

## Escopo

Esta fatia conclui o primeiro fluxo operacional de Contas a Pagar. Um lançamento
aprovado pode ser programado para pagamento, baixado com comprovante e conciliado
contra o valor originalmente aprovado.

## Dados bancários do fornecedor

- Cada fornecedor pode possuir várias contas ou chaves PIX.
- Uma única conta ativa é marcada como principal.
- O cadastro aceita conta corrente, poupança ou conta de pagamento, além de PIX.
- CPF ou CNPJ do titular é normalizado antes da gravação.
- Um dado bancário já utilizado não é reescrito. Para mudar o destino, deve ser
  criada uma nova versão.
- A conta não pode ser arquivada enquanto houver um pagamento programado nela.

Na lista de fornecedores, o botão com ícone de banco abre o cadastro bancário.

## Programação e baixa

1. Somente um lançamento com status **Aprovado** pode ser programado.
2. A programação congela o valor, a data, a forma de pagamento, o responsável e
   todos os dados do destino bancário.
3. Uma programação pode ser cancelada mediante justificativa. O lançamento
   permanece aprovado e pode ser programado novamente.
4. A baixa exige data e hora, valor efetivamente pago, referência da transação e
   comprovante em PDF, PNG, JPG ou WEBP de até 10 MB.
5. A confirmação muda o pagamento e o lançamento para **Pago**.
6. O sistema compara o valor pago ao valor programado. Valores iguais ficam como
   **Valor conciliado**; diferenças positivas ou negativas ficam destacadas para
   conferência.

O fluxo está disponível no detalhe de cada lançamento em **Financeiro > Contas a
pagar > Lançamentos de fornecedores**.

## Segurança e auditoria

- RLS isola dados bancários, pagamentos e comprovantes por tenant e empresa
  operadora.
- Somente usuários com escrita financeira podem cadastrar destinos, programar,
  cancelar ou baixar pagamentos.
- Os comprovantes ficam em bucket privado e são abertos por URL assinada de curta
  duração.
- O caminho do arquivo contém tenant, empresa operadora e pagamento; o backend
  confirma a existência e o escopo antes da baixa.
- Inclusão direta de pagamentos, exclusão física, regressão de status e alteração
  de snapshots são bloqueadas.
- Cadastro bancário, programação, cancelamento e baixa entram na auditoria
  financeira.

## Componentes

- Tabelas: `supplier_bank_accounts` e `supplier_payments`.
- Bucket privado: `supplier-payment-receipts`.
- RPCs: `save_supplier_bank_account`, `archive_supplier_bank_account`,
  `schedule_supplier_payment`, `settle_supplier_payment` e
  `cancel_supplier_payment`.
- Interface: `SupplierBankAccountsDialog` e `SupplierPaymentSection`.
- Testes: 30 cenários transacionais de validação, workflow, RLS, comprovantes,
  cancelamento, conciliação, imutabilidade e auditoria.

## Próxima fatia

Implementar a visão consolidada de fluxo de caixa, reunindo contas a receber e a
pagar por competência, vencimento, realização e empresa operadora.
