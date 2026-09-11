# Financeiro: suspensão contratual por inadimplência

## Escopo

O backend consome os eventos produzidos pela régua de cobrança e aplica a
suspensão ao contrato somente quando o título continua vencido, possui saldo e
o contrato está ativo e vigente.

Cada decisão gera um bloqueio financeiro auditável que relaciona o evento, o
contrato e a conta a receber. A execução ocorre no mesmo agendamento da régua,
a cada 15 minutos.

## Liberação após a baixa

Quando todos os títulos que sustentam a suspensão deixam de estar vencidos ou
ficam sem saldo, o contrato volta automaticamente para `active`. Se a vigência
já terminou, o resultado é `expired`.

A liberação publica o evento append-only
`contract.financial_suspension_released`. Reprocessamentos são idempotentes e
não criam uma segunda transição.

## Preservação de decisões manuais

- contrato já suspenso antes do evento financeiro não é assumido pelo worker;
- contratos cancelados, expirados ou fora da vigência não são alterados;
- se um usuário mudar o status durante uma suspensão financeira, a decisão
  manual prevalece;
- a baixa nunca reativa uma suspensão que não tenha sido aplicada pelo próprio
  fluxo financeiro.

## Segurança operacional

- processamento restrito ao `service_role`;
- contratos, títulos e eventos são bloqueados durante a decisão concorrente;
- eventos interrompidos voltam para processamento após 30 minutos;
- falhas têm até cinco tentativas com espera progressiva;
- bloqueios não permitem exclusão física e entram na auditoria financeira;
- RLS limita a leitura à tenant e à empresa operadora concedida.

## Componentes

- Migrations: `20260911122041_process_contract_delinquency_events.sql` e
  `20260911123123_harden_contract_event_rpc.sql`.
- Worker: fila BullMQ `collection`, junto ao ciclo da régua de cobrança.
- Testes: fluxo transacional com suspensão, baixa, idempotência, isolamento de
  credencial e preservação de suspensão manual.
