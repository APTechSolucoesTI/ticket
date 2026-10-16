# Anexos de contas a pagar

Na nova conta a pagar e na confirmação de uma previsão de conta fixa, a seção
**Anexos** permite selecionar vários arquivos. Cada arquivo exige um tipo:
**Boleto**, **Nota Fiscal**, **XML** ou **Outros**. Para **Outros**, a descrição
do tipo é obrigatória (até 200 caracteres). Os anexos são opcionais; o limite
é de 20 arquivos por lançamento e 10 MB por arquivo.

Em lançamentos parcelados, cada arquivo exige a escolha de uma parcela dentre
as parcelas calculadas. Alterar o parcelamento exige recalculá-lo e revisar os
destinos. Um lançamento único e uma confirmação de conta fixa vinculam os
arquivos ao título único. Os arquivos ficam disponíveis para download nos
**Detalhes do lançamento**, junto do tipo e da descrição informada.

O envio precede a criação dos títulos. As novas contas, os rateios e os vínculos
dos arquivos são gravados em uma transação. Se o envio ou a gravação falhar,
os títulos não são criados e os arquivos selecionados permanecem no formulário
para nova tentativa. Arquivos enviados sem vínculo são removidos quando uma
tentativa falha. Arquivos vinculados ficam protegidos contra essa limpeza.

O bucket `supplier-payable-attachments` é privado. Os caminhos incluem tenant,
empresa e usuário responsável. As políticas do Storage e a tabela
`supplier_payable_attachments` validam permissão financeira e escopo da empresa.
O banco valida a existência, tamanho, tipo e parcela de cada arquivo e registra
os vínculos na auditoria financeira. Não permite escrita direta dos metadados
pelo cliente. Os modelos de contas fixas e as demais competências permanecem
preservados durante uma confirmação.

## Gerenciamento pela listagem

Cada título possui um botão com ícone de clipe nas ações da listagem. Ele fica
destacado quando existem anexos ativos e discreto quando não existem. O estado
e a quantidade também são informados no texto acessível e na dica do botão.
Os identificadores dos anexos ativos são consultados junto dos títulos, sem
uma chamada separada por linha.

O botão abre **Anexos do lançamento**, com consulta, download, inclusão de
múltiplos arquivos e exclusão mediante confirmação. Tipo e descrição de
**Outros** seguem as regras do cadastro. Nos parcelamentos, o documento e a
parcela selecionados ficam explícitos; os novos arquivos pertencem somente à
parcela cujo botão foi aberto. O limite de 20 considera os arquivos já existentes.

As mutações exigem permissão de edição e escopo de escrita da empresa. Usuários
somente de leitura podem consultar e baixar. Cada inclusão é atômica e usa
bloqueio do título para respeitar o limite em operações concorrentes. Incluir
ou excluir anexos não altera o valor, status ou aprovações do título.

Excluir retira o anexo da listagem, da contagem e do acesso normal ao Storage.
O arquivo privado e o vínculo arquivado são preservados para rastreabilidade,
com usuário e data da exclusão e auditoria de antes/depois. Não há exclusão
física de documentos financeiros nem possibilidade de restaurá-los pela API.
O indicador e as consultas são atualizados após cada alteração.

A suíte `scripts/test-payable-attachments-ui.mjs` verifica indicador, erros,
download, inclusão, parcela, exclusão/cancelamento, nova tentativa, atualização
da listagem e consulta somente de leitura em desktop, tablet e celular.

Verificação: `supabase/tests/payable_attachments_test.sql` cobre transações,
validações e RLS. As suítes `scripts/test-entry-allocations-ui.mjs` e
`scripts/test-fixed-payables-ui.mjs` cobrem os formulários em 1440, 768 e 390 px,
com múltiplos tipos, seleção de parcelas, falhas, nova tentativa e download.

Validação em 16/10/2026: 64 testes específicos e 83 regressões de contas fixas
passaram no banco; as suítes de gerenciamento, criação e confirmação foram
verificadas nas três resoluções.
Upload, download privado e limpeza de um XML temporário também foram verificados
no Storage real. Lint dos componentes alterados e build web passaram. A análise
de segurança do Supabase não acrescentou alertas. O typecheck geral ainda acusa
erros preexistentes em fornecedores, configurações Inter/empresas e contatos do
portal; nenhum envolve os arquivos desta alteração.
