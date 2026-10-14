# Contas a pagar fixas

A gestão fica em **Financeiro → Contas a pagar fixas**, também acessível pelo
botão **Contas fixas** no contas a pagar, na rota `/finance/payables/fixed`.
Utiliza a permissão `financeiro_contas_fixas` (`view` e `edit`), subordinada ao
acesso de contas a pagar. A confirmação exige também edição de contas a pagar
e escrita financeira na empresa operadora. Os acessos existentes foram copiados
do módulo de contas a pagar e podem ser ajustados na matriz de permissões.

## Modelo e previsão

O formulário segue o molde manual: fornecedor, tipo de documento, descrição,
valor, observações e rateios independentes de categorias e centros, cada grupo
totalizando 100%. Não solicita número do documento nem permite parcelamento.
Acrescenta mês inicial, dia de vencimento e **Lançar até** opcional. Para dias
inexistentes, utiliza o último dia do mês, inclusive em anos bissextos.

Com limite, gera todas as competências do início ao fim, inclusive. Sem limite,
gera do início até 11 meses após o maior entre início e mês atual, preservando
previsões vencidas e mantendo a janela atual de 12 meses. O cadastro, a edição
e a reativação completam a janela imediatamente. O job pg_cron
`apticket-fixed-payable-forecasts` executa diariamente às 06:20 UTC / 03:20 de
São Paulo; no início de cada mês amplia a janela e também recupera lacunas.

Uma restrição única parcial por tenant, modelo e competência impede duplicidade
de ocorrências ativas. A exclusão individual deixa um marcador permanente de mês
pulado. Reduzir o limite arquiva previsões fora do período; ampliá-lo pode gerar
novamente as retiradas pelo limite, preservando meses pulados explicitamente.

Editar o modelo pede confirmação de escopo e aplica as condições somente às
previsões do mês atual em diante ainda não confirmadas. Competências passadas e
confirmadas permanecem preservadas. Também é possível editar uma previsão
isolada. Inativar interrompe novas gerações e mantém as previsões existentes.
Excluir arquiva o modelo e suas previsões não confirmadas, preservando o histórico
dos títulos confirmados.

## Confirmação e separação financeira

Foram escolhidas tabelas separadas (`fixed_payables` e
`fixed_payable_occurrences`). A tabela de títulos exige documento, e seu status
é utilizado por aprovação, pagamento, conciliação e relatórios. Acrescentar
previsões nela exigiria alterar todos esses consumidores e aumentaria o risco
de contabilizar uma estimativa como título. Por isso **Previsão** é um estado
próprio da ocorrência (`forecast`), e não um novo estado do título.

A listagem reúne as duas fontes, mostra documento “—” e badge **Previsão**,
permite filtrar títulos e previsões e separa **Previsto** de **A pagar**. Previsões
não entram em `supplier_payables`, `supplier_payments`, `cash_flow_entries`,
`cash_flow_allocation_entries`, conciliação, alçadas nem resultados/fechamentos.
As consultas existentes continuam trabalhando exclusivamente com títulos reais.
As novas consultas paginam todas as ocorrências para não truncar os totais no
limite padrão do PostgREST.

**Confirmar** exige documento e permite revisar fornecedor, descrição, tipo,
valor, vencimento, rateios e observações. Reutiliza a criação manual existente:
gera um título único em `scheduled`, com classificação e histórico normais, e
registra a referência na ocorrência. Não altera o modelo nem outros meses.
Assim, seguem disponíveis aprovação, anexos, programação, comprovantes e baixa
do contas a pagar. O título confirmado recebe a identificação **Fixa confirmada**.

Todas as mutações são RPCs atômicos, com RLS nas tabelas, tenant e escopo financeiro
validados, bloqueios na ordem modelo → ocorrência e revisões concorrentes.
Confirmação dupla é rejeitada. Funções privadas e manutenção global não são
executáveis pelos clientes. Modelos, ocorrências e confirmações usam a auditoria
financeira existente; não há escrita direta ou exclusão física pelo cliente.

Desfazer confirmação fica como melhoria futura: exige coordenar cancelamento de
aprovação, pagamento programado, conciliação, fechamento e documento já utilizado.
A implementação atual mantém o histórico e as ações normais do título confirmado.

## Verificação

- `supabase/tests/fixed_payables_test.sql`: 83 verificações de geração, janela,
  vencimentos, limites, edição, meses pulados, confirmação atômica, relatórios,
  permissões/RLS, auditoria e fluxo completo de aprovação e baixa com comprovante.
- Regressões: `payable_mutations_test.sql` (68) e
  `manual_entry_allocations_test.sql` (56).
- `scripts/test-fixed-payables-ui.mjs`: cadastro, validação, escopo de edição,
  ocorrências, confirmação, totais, filtros, inativação, exclusão e leitura em
  1440, 768 e 390 px; verifica também totais com mais de 1.000 ocorrências.
- Regressões no navegador: edição/exclusão e rateios nos dois módulos financeiros.

As suítes antigas `supplier_payable_approvals_test.sql` e
`supplier_payment_settlement_test.sql` têm fixtures incompatíveis com mudanças
anteriores do banco. O fluxo da nova funcionalidade foi verificado diretamente
na suíte de contas fixas, com o modelo atual de fornecedores e rateios.
Lint dos arquivos alterados e build web passaram; o typecheck mantém os erros
preexistentes de fornecedores, integração Inter e contatos do portal.
