# Rateios em contas a pagar e a receber

Os lançamentos manuais e a ação **Classificar** usam o mesmo editor dos contratos
de clientes e fornecedores. Categorias financeiras e centros de custo têm listas
independentes: cada grupo exige ao menos um item e deve totalizar exatamente 100%.
Um lançamento sem divisão utiliza um item com 100% em cada grupo.

O editor aceita somente itens analíticos ativos, da empresa operadora ou globais
do mesmo tenant. Categorias também respeitam a natureza de entrada ou saída.
Não permite itens repetidos, percentuais zerados nem mais de duas casas decimais.
Itens históricos indisponíveis permanecem identificados e precisam ser
substituídos antes de salvar uma nova classificação.

Na inclusão parcelada, os mesmos percentuais são aplicados a todas as parcelas.
A ação **Classificar** altera apenas o movimento selecionado, mantém todos os
itens existentes e preserva a versão anterior no histórico. Classificações antigas
com um único vínculo são apresentadas como 100%, sem migração dos dados históricos.
O diálogo compartilhado também preserva os rateios abertos pelo fluxo de caixa e
pela conciliação bancária.

## Persistência e segurança

A migration `20261014195156_manual_entry_dimension_allocations.sql` acrescenta:

- `create_manual_receivable_allocated` e `create_manual_supplier_payable_allocated`:
  reutilizam as validações existentes e classificam todas as parcelas na mesma
  transação; qualquer falha reverte o grupo completo.
- `classify_financial_entry_allocated`: valida origem, tenant, empresa, permissão
  financeira e usuário ativo, bloqueia o movimento durante a alteração e usa a
  mesma normalização dos contratos para validar os dois grupos.

Os snapshots armazenam códigos e nomes obtidos do banco. As colunas de vínculo
único espelham o item de maior percentual para compatibilidade. Os relatórios
continuam utilizando a distribuição já existente, que preserva os centavos do
lançamento e os totais de cada dimensão. Os RPCs anteriores permanecem disponíveis
para os clientes existentes.

## Validação

`supabase/tests/manual_entry_allocations_test.sql` contém 56 verificações de
criação, parcelas, reclassificação, arredondamento, histórico, validações,
reversão integral, auditoria, permissões e isolamento entre tenants.
As suítes de contratos e alteração/exclusão de contas a pagar verificam regressões.

`scripts/test-entry-allocations-ui.mjs` utiliza o aplicativo compilado com APIs
isoladas. Verifica os dois módulos em 1440, 768 e 390 px: inclusão única e
parcelada, totais, duplicidade, erros, reabertura, vínculos legados, itens inativos
e acesso somente de leitura. Requer `PLAYWRIGHT_MODULE` apontando para o Playwright.
As evidências ficam em `artifacts/entry-allocations/`.

Lint dos componentes alterados e build web passaram. O typecheck mantém os mesmos
erros anteriores em componentes de fornecedores, integração Inter e contatos do
portal; a comparação com o resultado anterior não acrescentou erros.
