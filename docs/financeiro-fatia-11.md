# Financeiro: reconciliação ativa da cobrança Inter

## Escopo

Depois que a emissão retorna um `codigoSolicitacao`, o operador Admin ou
Financeiro pode usar **Consultar no Inter** para recuperar a situação atual da
cobrança V3 no ambiente de homologação.

A consulta reconhece os estados documentados pelo Inter: `EM_PROCESSAMENTO`,
`A_RECEBER`, `ATRASADO`, `RECEBIDO`, `MARCADO_RECEBIDO`, `CANCELADO`,
`EXPIRADO`, `FALHA_EMISSAO` e `PROTESTO`.

## Reflexo financeiro

- `EM_PROCESSAMENTO` e `A_RECEBER`: conta a receber fica **Faturada**.
- `ATRASADO` e `PROTESTO`: conta a receber fica **Vencida**.
- `RECEBIDO` e `MARCADO_RECEBIDO`: conta a receber fica **Recebida**, com
  saldo aberto zerado.
- `CANCELADO`, `EXPIRADO` e `FALHA_EMISSAO`: o estado bancário é registrado,
  mas a situação financeira não é alterada automaticamente.

Nosso número, linha digitável, código de barras, TXID, Pix copia e cola, valor
recebido e origem do recebimento são persistidos em campos tipados. O payload
bruto, dados do pagador, credenciais e tokens não são armazenados.

## Segurança e idempotência

A sessão do operador cria uma tentativa exclusiva e auditada. Somente a Edge
Function recebe, via `service_role`, as credenciais protegidas no Vault. Uma
consulta em andamento é reutilizada e consultas concluídas há menos de 15
segundos não voltam ao banco.

Produção continua bloqueada. O webhook será implementado depois de definir um
mecanismo de autenticação que não confie apenas no conteúdo recebido; até lá,
a conciliação é sempre iniciada por um operador autorizado.

## Componentes

- Migration: `20260910112820_inter_charge_active_reconciliation.sql`.
- Edge Function: `consultar-cobranca-inter`.
- Testes da função: `consultar-cobranca-inter/handler.test.ts`.
- Interface: ação **Consultar no Inter** no modal da cobrança.

Referência oficial: [API Cobrança V3 do Inter](https://developers.inter.co/references/cobranca-bolepix).
