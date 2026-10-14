# Alterar e excluir lançamentos do Contas a Pagar

As ações **Alterar** e **Excluir** ficam na coluna Ações de cada conta, para
usuários com permissão de edição em Contas a Pagar e escrita financeira na empresa.

## Alteração

- Documento, descrição e vencimento podem ser corrigidos.
- Contas manuais também permitem alterar valor e competência.
- Valor e período de contas contratuais permanecem definidos pelo contrato e seus
  rateios, preservando os cálculos e snapshots de consumo.
- Em contas parceladas, a alteração afeta somente a parcela selecionada. O grupo
  original e as outras parcelas permanecem preservados.
- É necessário informar o motivo. O banco registra valores anteriores e novos,
  responsável, horário e revisão.

O lançamento alterado volta para revisão. Solicitações de aprovação pendentes ou
aprovadas são encerradas, mantendo as decisões no histórico. Com alçada ativa,
deve ser enviado novamente; com alçada desativada, pode seguir para pagamento.

## Exclusão

A confirmação pede um motivo. A exclusão é lógica: retira a conta e seus rateios
ativos da listagem, do fluxo de caixa e dos relatórios, mantendo o registro,
aprovações, pagamentos cancelados e auditoria. Apenas a parcela selecionada é
excluída. Um ciclo contratual excluído pode ser gerado novamente.

## Proteções

Contas pagas ou canceladas não podem ser alteradas ou excluídas. Se houver uma
programação de pagamento ativa, é necessário cancelá-la antes. A interface informa
o bloqueio nos botões; as mesmas verificações acontecem no banco.

Uma revisão numérica impede que um formulário antigo sobrescreva uma mudança
feita por outro usuário, uma aprovação ou um pagamento. As operações são atômicas:
uma falha de validação não encerra aprovações nem altera parcialmente a conta.

Os RPCs `update_supplier_payable` e `delete_supplier_payable` obtêm o tenant da
sessão e validam permissões, empresa e usuário ativo. O acesso direto à escrita e
à exclusão física continua indisponível aos clientes.

## Verificação

`supabase/tests/payable_mutations_test.sql` cobre edição, exclusão lógica,
parcelas, rateios, aprovações, pagamentos, concorrência, auditoria e isolamento.
O teste de configurações financeiras verifica a compatibilidade dos pagamentos
com e sem alçada após a migration.

`scripts/test-payable-mutations-ui.mjs` verifica os formulários, cancelamento,
erros de gravação, leitura, bloqueios e histórico em 1440, 768 e 390 px. Requer o
build web e `PLAYWRIGHT_MODULE` apontando para o Playwright instalado.
