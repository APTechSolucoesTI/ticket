# Financeiro: tela de preparação e consulta Inter

## Como utilizar

1. Acesse **Financeiro > Contas a receber de contratos**.
2. Em um recebível de **ciclo recorrente**, clique em **Cobrança Inter**.
3. Confira cliente, documento, saldo e vencimento consultados no servidor.
4. Escolha **Homologação** ou **Produção / Oficial**. A tela inicia em
   homologação; trocar a aba limpa a confirmação anterior.
5. Marque a confirmação e clique em **Registrar preparação**.
6. A solicitação mostra protocolo, valor/vencimento preparados, data do
   registro e **Aguardando homologação**. Uma solicitação existente não
   apresenta novamente o botão de registrar.

O botão de consulta aparece para ciclos recorrentes, inclusive em modo
somente leitura. A preparação exige acesso financeiro de escrita à empresa,
recebível a faturar, saldo positivo e nenhuma baixa parcial. O banco revalida
todas as condições. Medições legadas e avulsos permanecem fora deste fluxo.

**Nenhuma cobrança é enviada ao Inter**, em qualquer ambiente. Preparação
não muda saldo/status/vencimento do recebível e não valida dados do pagador
ou credenciais. A emissão real e seus testes continuam pendentes.

## Consulta e revisão

As abas consultam as solicitações de cada ambiente. Se valor/vencimento
mudou ou a solicitação foi desativada, a tela avisa para solicitar revisão;
não sobrescreve o registro. **Atualizar consulta** busca o estado atual.
Esta tela é de conferência: ainda não implementa cancelamento, substituição
de solicitação ou desbloqueio para envio.

## Implementação e segurança

- `inter-charges.functions.ts`: consultas com sessão validada, RLS existente,
  filtro de tenant e checagem do acesso de escrita por empresa.
- Preparação chama a Edge Function publicada na fatia 4 com o bearer do
  próprio usuário; não usa service role. Valor, tenant e ator não são aceitos
  pelo formulário. A confirmação é validada também na função de servidor.
- `InterChargeDialog`: estados de carga, erro/retry, vazio, somente leitura,
  confirmação, envio e sucesso; prevenção de duplo envio na interface.
- A idempotência e a auditoria continuam sendo garantidas pelo banco.

Não há novas tabelas, políticas, migrations ou Edge Functions. Publicação
necessária apenas do aplicativo web, pelo fluxo GitHub → Dokploy.

## Verificação

- 17 testes pgTAP e sete testes do handler existentes, sem chamadas ao Inter.
- Playwright com APIs simuladas em 1440/768/390 px: confirmação por ambiente,
  registro, consulta, alteração da origem, somente leitura e erro/retry.
- Regressão do detalhamento de ciclos nas mesmas três larguras.
- Lint e build passaram. Typecheck mantém somente os 18 erros preexistentes
  em `demo.Tickets.$id.tsx`.
- Scripts: `scripts/test-inter-charge-ui.mjs` e `scripts/test-cycle-ui.mjs`.

Próxima parte pendente: vínculo bancário da empresa, dados do pagador,
revisão corretiva e processamento de emissão/retorno. Não habilitar envio
real antes da homologação.
