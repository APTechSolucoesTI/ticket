# Financeiro: fechamento mensal do resultado

## Escopo

Esta fatia implementa o encerramento mensal do resultado financeiro por empresa
operadora, com snapshot imutável, histórico de revisões e reabertura
justificada.

## Fluxo operacional

Em **Financeiro > Fechamento mensal**, usuários com permissão de edição no
módulo financeiro podem:

- selecionar a empresa operadora e o exercício;
- consultar as doze competências e suas situações;
- encerrar uma competência atual ou anterior;
- informar observações no fechamento;
- reabrir uma competência mediante justificativa obrigatória;
- acompanhar responsável, data, revisão e quantidade de linhas consolidadas.

## Regras do fechamento

- A competência deve possuir valores financeiros.
- Todos os movimentos do período devem ter categoria e centro de custo.
- Não é permitido manter dois fechamentos ativos para a mesma competência.
- Cada novo fechamento após uma reabertura incrementa a revisão.
- Competências futuras não podem ser encerradas.
- A reabertura exige justificativa entre 10 e 1000 caracteres.

## Snapshot e bloqueios

O fechamento preserva as linhas e os totais de orçamento, previsão e realização
existentes no momento da confirmação. Enquanto a competência estiver encerrada:

- o demonstrativo gerencial utiliza as linhas do snapshot;
- alterações posteriores nas fontes não modificam o resultado encerrado;
- revisões do orçamento ficam bloqueadas;
- inclusões, substituições ou remoções de classificação ficam bloqueadas.

Após uma reabertura, o demonstrativo volta a usar os valores atuais e os ajustes
voltam a ser permitidos. O snapshot anterior permanece imutável no histórico.

## Segurança e auditoria

- As tabelas de fechamento e snapshot possuem RLS.
- A leitura exige escopo financeiro para a empresa operadora.
- As operações exigem permissão de edição no módulo financeiro.
- Usuários anônimos não possuem acesso às tabelas nem às funções públicas.
- As rotinas privilegiadas ficam no schema privado, com `search_path` fixo.
- Fechamentos e reaberturas são registrados em `financial_audit_log`.
- Linhas de snapshot não permitem alteração ou exclusão física.

## Componentes

- Tabela: `financial_period_closures`.
- Snapshot: `financial_period_snapshot_lines`.
- Função de fechamento: `close_financial_period`.
- Função de reabertura: `reopen_financial_period`.
- Interface: `FinancialPeriodClosure`.
- Migration: `20260912142806_financial_period_closure.sql`.
- Testes novos: 32 cenários transacionais.

## Próxima fatia

Implementar o relatório de histórico dos fechamentos, com comparação entre
revisões, identificação das diferenças após cada reabertura e exportação da
trilha para PDF e Excel XLSX.
