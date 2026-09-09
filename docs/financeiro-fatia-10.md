# Financeiro: emissão manual de cobrança Inter no sandbox

## Como usar

1. Em **Financeiro**, abra **Cobrança Inter** em uma conta a receber de medição aprovada ou de ciclo recorrente.
2. Na aba **Homologação**, registre a preparação e confirme o pagador.
3. Confira novamente ambiente, pagador, valor e vencimento.
4. Marque a autorização de envio e clique em **Emitir no sandbox**.
5. Use **Atualizar consulta** para acompanhar o estado registrado.

O botão exige perfil Admin ou Financeiro, acesso financeiro de escrita e um
snapshot de pagador confirmado e vigente. Ele nunca aparece na aba
**Produção / Oficial**, que permanece bloqueada.

## Estados e segurança operacional

- `dispatching`: tentativa exclusiva em andamento; cliques concorrentes
  reutilizam a mesma tentativa.
- `submitted`: o Inter aceitou a solicitação e devolveu `codigoSolicitacao`;
  uma nova emissão não é permitida.
- `failed`: falha confirmada antes do envio ou rejeição bancária determinística;
  admite nova tentativa manual, com limite e intervalo mínimo.
- `uncertain`: houve timeout, indisponibilidade 5xx ou resposta inválida depois
  do início do POST. O sistema não repete o envio automaticamente.

Cada solicitação admite até cinco tentativas e respeita intervalo mínimo de um
minuto. Uma execução abandonada expira em dois minutos e passa para
`uncertain`, preservando a regra de não duplicar cobrança.

O usuário autenticado apenas cria a tentativa. A Edge Function recupera com a
service role o snapshot imutável e as credenciais do Vault, executa OAuth com
mTLS e envia o payload exclusivamente ao host de sandbox. Certificados,
chaves, client secret, token e corpo de erro bancário não são retornados nem
persistidos. Tentativas têm RLS, leitura por escopo financeiro, auditoria e
bloqueio de alteração/exclusão direta.

O endpoint de Cobrança V3 do Inter responde de forma assíncrona com
`codigoSolicitacao`; o acompanhamento definitivo será implementado por webhook
ou consulta ativa na próxima fatia. Referências oficiais:
[Cobrança V3 / Boleto com Pix](https://developers.inter.co/references/cobranca-bolepix)
e [Changelog da API](https://developers.inter.co/changelog).

## Componentes

- Migrations: `20260909180411_inter_sandbox_dispatch_processor.sql` e
  `20260909231713_enable_inter_for_measurement_receivables.sql`.
- Edge Function: `emitir-cobranca-inter`.
- Testes de banco: `inter_sandbox_dispatch_processor_test.sql`.
- Teste de medição e regressão: `contract_measurements_test.sql` e
  `inter_charge_requests_test.sql`.
- Testes da função: `emitir-cobranca-inter/handler.test.ts`.
- Teste de interface: `scripts/test-inter-charge-ui.mjs`.

## Verificação e publicação

A validação automatizada não emite cobrança real. O banco é exercitado em uma
transação revertida e a comunicação HTTP usa simulações locais. A emissão no
sandbox ocorre apenas pelo clique explícito de um operador autorizado.

Skills: Supabase orientou RLS, RPCs, Vault, migração e Edge Function; Lovable
orientou os estados visuais e o comportamento responsivo do modal.

Próxima etapa: consultar o resultado assíncrono pelo `codigoSolicitacao`,
processar webhook idempotente e refletir os estados bancários sem liberar
produção automaticamente.
