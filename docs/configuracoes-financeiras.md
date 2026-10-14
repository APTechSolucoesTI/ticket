# Configurações financeiras

Em **Administração → Configurações → Financeiro**, há duas opções independentes:

- **Contas a Pagar → Utiliza Alçada de Aprovação:** Sim ou Não.
- **Contas a Receber → Utiliza Régua de Cobrança:** Sim ou Não.

As opções se aplicam a todas as empresas operadoras do tenant. O padrão é **Sim**
para preservar o comportamento anterior. Ativar a régua permite usar as políticas
existentes por empresa; não cria uma política ou ativa políticas desabilitadas.

Quem possui `configuracoes/view` pode consultar a aba. Somente usuários ativos com
`configuracoes/view` e `configuracoes/edit` podem salvar. Os módulos financeiros
podem consultar as opções, mas a permissão financeira não autoriza alterá-las.
As gravações ocorrem por RPC, com tenant obtido da sessão, RLS e auditoria.

## Contas a pagar

Com **Sim**, continua obrigatório enviar o lançamento rateado para a alçada e
concluir as etapas antes de programar o pagamento.

Com **Não**, o botão Alçadas e o envio de novas solicitações ficam indisponíveis.
Lançamentos ainda não enviados podem ser programados diretamente, desde que o
rateio esteja completo. A programação libera o lançamento na mesma transação,
sem criar uma aprovação fictícia. Validações bancárias, data, permissões,
comprovante e baixa continuam obrigatórias.

Solicitações já iniciadas mantêm seu fluxo e histórico. Um pagamento já programado
sem alçada continua apto à baixa se a configuração for reativada posteriormente.

## Contas a receber

Com **Não**, o módulo informa que a régua está desativada e oculta sua configuração.
O banco impede a avaliação de políticas, a criação de cobranças e eventos de
suspensão, a obtenção de ações pelo worker e novas suspensões de contrato.

Antes do envio externo, a API consulta novamente a configuração. Um trabalho
enfileirado que estiver pausado volta para pendente, sem consumir uma tentativa
ou ser registrado como enviado. Ao reativar, a fila pode retomá-lo. Mensagens cujo
envio externo já começou podem concluir; um envio externo não é reversível.

Políticas, etapas, ações pendentes e histórico são preservados. A liberação de
contratos por quitação continua funcionando mesmo com a régua desativada.

## Validação e publicação

- `supabase/tests/financial_settings_test.sql`: permissões, RLS, auditoria,
  pagamento com/sem alçada, fila e pausa/retomada da régua.
- Testes `collection-dispatch.service.spec.ts` e `collection.processor.spec.ts`:
  nenhum envio durante a pausa e preservação do trabalho.
- `scripts/test-financial-settings-ui.mjs`: persistência, falha de gravação,
  leitura e comportamento dos dois módulos em desktop, tablet e celular.
  Requer build web e `PLAYWRIGHT_MODULE` apontando para o Playwright instalado.

A migration deve ser aplicada antes da atualização da API e do frontend. A API
precisa do RPC `prepare_collection_action_dispatch` para despachar mensagens.
