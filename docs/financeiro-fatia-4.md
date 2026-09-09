# Financeiro: preparação idempotente de cobranças Inter

## Entrega técnica para revisão

Primeira parte da etapa de emissão: registro interno da intenção de cobrança
para **recebíveis de ciclos recorrentes**, sem chamada ao banco. Homologação
real permanece para o final, conforme solicitado. Esta entrega **não emite
boleto/PIX e não implementa webhook ou conciliação**.

- `inter_charge_requests`: tenant, empresa operadora, recebível, ambiente,
  valor e vencimento obtidos do banco, autor e data da solicitação.
- Uma solicitação por recebível/ambiente, inclusive quando excluída
  logicamente. Retry devolve o mesmo ID, sem nova inclusão nem nova auditoria.
- `prepare_inter_charge`: valida sessão ativa, acesso financeiro de escrita,
  empresa e ciclo não excluídos, recebível a faturar, saldo positivo e sem
  baixa parcial. Lock na origem serializa solicitações concorrentes.
- Divergência de valor/vencimento após preparação é conflito; não sobrescreve
  a solicitação nem prepara automaticamente uma segunda cobrança.
- RLS de leitura por empresa/grupo; escrita direta bloqueada inclusive ao
  serviço; auditoria reutiliza `financial_audit_log`, com ator do JWT.
- Edge Function `preparar-cobranca-inter` encaminha o JWT original ao
  PostgREST. Não substitui a sessão por credencial de serviço, não recebe
  tenant, ator, valor ou vencimento do cliente e não lê o Vault.

## Operação nesta fatia

Endpoint técnico. A interface de preparação foi adicionada depois, na
[fatia 5](financeiro-fatia-5.md):

```http
POST /functions/v1/preparar-cobranca-inter
Authorization: Bearer <sessão do usuário APTicket>
Content-Type: application/json

{"receivable_id":"<uuid do recebível>","environment":"sandbox"}
```

Ambiente obrigatório: `sandbox` ou `production`, independente do padrão do
tenant. Retorno: `id`, `reused`, `status: blocked_homologation` e mensagem de
que não houve emissão. `production` também fica bloqueado.

Nenhum valor muda em `contas_receber`. O registro não significa "Faturado".
Credenciais e dados cadastrais do pagador não são validados nesta preparação;
serão necessários antes de construir/enviar o pedido bancário. Não existe
job consumindo estas solicitações, nem estado liberado no CHECK do banco.

Medições legadas e avulsos não possuem a vinculação de empresa operadora
necessária a este fluxo e não foram migrados por inferência.

## Validação e implantação

Migration: `20260909015744_inter_charge_requests.sql`.
Testes: `supabase/tests/inter_charge_requests_test.sql` (17 pgTAP, rollback)
e sete testes de handler. Deno check/lint/fmt. Nenhum teste chama o Inter.
Publicar migration antes da Edge Function. Não há mudança no frontend,
portanto esta fatia não exige rebuild do Dokploy.

## Próxima parte da emissão

Ainda implementar: tela de preparação/revisão, vínculo da conta bancária à
empresa operadora, dados do pagador, revisão de solicitações alteradas,
worker de emissão e recuperação de resultado incerto, credenciais por
ambiente e reuso de token, webhook validado, conciliação idempotente e fila
de exceções. Somente depois da homologação habilitar envio ao banco.
Não basta remover o CHECK: revalidar origem, configuração, vencimento,
permissões e estado antes de qualquer envio real.

Referência de segurança: [RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).
