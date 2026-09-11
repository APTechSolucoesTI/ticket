# Financeiro: aprovação de contas a pagar por alçada

## Escopo

Esta fatia adiciona aprovação sequencial aos lançamentos de fornecedores. Cada
empresa operadora configura faixas de valor e os responsáveis que devem decidir
em cada etapa antes de o pagamento ser liberado.

## Configuração das alçadas

- Cada alçada possui nome, valor mínimo, valor máximo opcional e uma sequência
  de aprovadores.
- Faixas ativas não podem se sobrepor.
- O último intervalo pode ficar sem limite máximo.
- Todos os aprovadores devem estar ativos, possuir permissão de edição no
  Financeiro e acesso de escrita à empresa operadora.
- Um mesmo usuário não pode ocupar duas etapas da mesma alçada.
- Alçadas já utilizadas tornam-se imutáveis para preservar o histórico. A
  alteração deve ser feita arquivando a versão anterior e criando outra.
- Uma alçada com solicitação pendente não pode ser arquivada.

## Fluxo do lançamento

1. O lançamento nasce com situação **Agendado**.
2. O rateio deve estar concluído antes do envio.
3. Ao enviar, o sistema escolhe a alçada ativa que contempla o valor total e
   congela os responsáveis, nomes, valor e regra utilizada.
4. O lançamento passa para **Aguardando aprovação**.
5. Cada responsável decide somente quando sua etapa é a primeira pendente.
6. A última aprovação altera o lançamento para **Aprovado**.
7. Uma rejeição exige justificativa, devolve o lançamento para **Agendado** e
   permite um novo envio sem apagar a tentativa anterior.
8. A transição para **Pago** é bloqueada enquanto o lançamento não estiver
   aprovado.

## Interface

Em **Financeiro > Contas a pagar > Lançamentos de fornecedores**:

- **Alçadas** abre a configuração de faixas e aprovadores;
- os indicadores mostram lançamentos com rateio pendente e aguardando
  aprovação;
- os filtros permitem localizar lançamentos por situação e rateio;
- o detalhe reúne a distribuição de custo, o histórico das solicitações e a
  etapa atual;
- **Enviar para aprovação** aparece em lançamentos agendados e rateados;
- **Aprovar etapa** e **Rejeitar** aparecem somente para o responsável atual.

## Segurança e auditoria

- RLS isola políticas, solicitações e etapas por tenant e empresa operadora.
- As tabelas são somente leitura para o cliente; alterações ocorrem por RPCs
  que revalidam usuário, empresa, permissão e estado do fluxo.
- A lista de aprovadores expõe somente usuários elegíveis da empresa.
- Inclusão direta, exclusão física e transições inválidas são bloqueadas.
- Configurações, envios e decisões entram na auditoria financeira.

## Componentes

- Tabelas: `supplier_approval_policies`,
  `supplier_approval_policy_steps`, `supplier_payable_approval_requests` e
  `supplier_payable_approval_steps`.
- RPCs: `save_supplier_approval_policy`,
  `archive_supplier_approval_policy`, `list_supplier_approval_approvers`,
  `submit_supplier_payable_for_approval`, `approve_supplier_payable` e
  `reject_supplier_payable`.
- Interface: `SupplierApprovalPoliciesDialog` e detalhe ampliado em
  `SupplierPayables`.
- Testes: 43 cenários transacionais cobrindo faixas, responsáveis, ordem,
  aprovações, rejeições, reenvio, bloqueio de pagamento, RLS e auditoria.

## Próxima fatia

Implementar a programação e a baixa de pagamentos, com dados bancários do
fornecedor, comprovantes e conciliação do valor pago.
