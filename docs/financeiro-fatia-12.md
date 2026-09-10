# Financeiro: webhook verificado do Banco Inter

## Escopo

Cada ambiente configurado em **Configurações > Banco Inter** pode registrar seu
próprio webhook da API Cobrança V3. A URL pública usa HTTPS e contém um segredo
aleatório rotativo que nunca é exibido na interface nem armazenado em texto
puro nas tabelas operacionais.

## Regra de confiança

O callback do Inter é tratado somente como um aviso. O APTicket conserva apenas
o identificador da cobrança, a situação notificada e o horário, sem payload
bruto, dados do pagador ou valores informados no callback.

Antes de alterar o contas a receber, um job consulta novamente a cobrança na API
do Inter usando OAuth, certificado mTLS e o `codigoSolicitacao`. Somente essa
resposta autenticada pode marcar uma conta como faturada, vencida ou recebida.

## Fluxo

1. Admin ou Financeiro configura o webhook no ambiente escolhido.
2. O Inter registra a URL HTTPS e o APTicket guarda apenas o hash do segredo.
3. O endpoint público valida o segredo, normaliza e deduplica o evento.
4. O BullMQ enfileira uma reconciliação ativa com novas tentativas exponenciais.
5. A Edge Function consulta o Inter e atualiza evento, cobrança e recebível na
   mesma transação.

O ambiente oficial pode ter o webhook configurado, embora a emissão oficial de
cobranças continue bloqueada até a liberação específica desse fluxo.

## Componentes

- Migration: `20260910122951_inter_charge_verified_webhooks.sql`.
- Edge Function: `configurar-webhook-inter`.
- Endpoint público: `POST /backend/webhooks/inter/:environment`.
- Fila: `inter-webhook`.
- Processamento bancário: `consultar-cobranca-inter`.

Referência oficial: [API Cobrança V3 do Inter](https://developers.inter.co/references/cobranca-bolepix).
