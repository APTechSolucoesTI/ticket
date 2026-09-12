# Conclusão do módulo financeiro

O ciclo planejado do Financeiro foi concluído até a camada gerencial e de conciliação.

## Entregas disponíveis

- empresas operadoras e concessões financeiras explícitas;
- configurações do Banco Inter separadas entre homologação e produção;
- emissão, consulta, webhook verificado e baixa de cobranças Inter para recorrências e medições;
- contas a receber, cobrança de inadimplência e eventos contratuais;
- fornecedores, contratos, rateios, aprovações, pagamentos e conciliação de diferenças;
- fluxo de caixa previsto e realizado, individual ou consolidado por empresas permitidas;
- categorias, centros de custo, orçamento, demonstrativo gerencial e fechamento mensal versionado;
- comparação e exportação do histórico de revisões do fechamento;
- múltiplas contas bancárias, importação idempotente de OFX e fila de conciliação;
- rentabilidade por cliente e contrato;
- MRR dos próximos doze meses e simulação de inadimplência e cancelamento.

## Acesso

Usuários Admin ou Financeiro com concessão para a empresa operadora acessam **Financeiro** no menu principal. Os atalhos do cabeçalho levam a Conciliação, Rentabilidade, Fluxo de caixa, Orçamento, Demonstrativo e Fechamento.

Em **Conciliação**, cadastre a conta operacional e importe o OFX. Em **Rentabilidade**, selecione uma empresa ou todas as empresas permitidas e ajuste os percentuais do cenário. Em **Fechamento**, encerre a competência somente depois de resolver as pendências mostradas pelo sistema.

## Garantias verificadas

- 689 asserções transacionais de banco aprovadas;
- 42 testes unitários da API aprovados;
- TypeScript sem erros;
- builds de produção do frontend e backend aprovados;
- migrations registradas no histórico do Supabase;
- isolamento por tenant e empresa coberto por RLS e testes de negação.

O lint integral ainda lista formatação histórica em arquivos que não fazem parte destas entregas. Todos os arquivos alterados neste ciclo passaram no lint direcionado, sem ampliar esse passivo.
