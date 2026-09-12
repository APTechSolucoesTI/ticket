# Financeiro, fatia 29: conciliação bancária

Esta etapa adiciona contas bancárias operacionais por empresa, importação de extratos OFX e uma fila auditável de conciliação.

## Fluxo operacional

1. Em **Financeiro > Conciliação**, selecione a empresa operadora.
2. Cadastre uma ou mais contas bancárias.
3. Selecione a conta e importe o arquivo OFX.
4. O sistema associa automaticamente apenas correspondências únicas de mesmo valor, com vencimento em uma janela de sete dias.
5. Movimentos ambíguos ou sem correspondência ficam em **Revisar**. O financeiro pode vinculá-los manualmente ou ignorá-los mediante justificativa.

Arquivos repetidos são identificados pelo hash SHA-256 e não geram movimentos duplicados. O FITID impede a repetição do mesmo movimento na conta. Os dados originais do extrato são imutáveis e todas as resoluções ficam na auditoria financeira.

Entradas são comparadas com contas a receber em aberto. Saídas são comparadas com pagamentos de fornecedores agendados. A conciliação cria o vínculo bancário, mas não realiza automaticamente a baixa financeira do título.
