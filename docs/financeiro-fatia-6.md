# Financeiro: vínculo bancário da empresa operadora

## Escopo desta entrega

Backend para consultar e confirmar a associação entre a empresa operadora e
a configuração Inter da própria tenant, por ambiente. **Não há tela nova,
emissão de boleto, chamada ao banco ou ativação automática de vínculos.**

O cadastro da tenant em **Configurações > Empresa** continua sendo a referência
do CNPJ. O vínculo exige correspondência com o CNPJ da empresa operadora.
Essa comparação e a confirmação do operador não comprovam titularidade bancária:
o resultado sempre informa `bank_ownership_verified: false` e
`dispatch_enabled: false`. A validação bancária continua pendente.

## Contrato da API autenticada

- `review_inter_binding(p_company uuid, p_environment text)`: consulta sanitizada,
  com estado, versão da configuração, últimos quatro dígitos da conta,
  vencimento do certificado e identificador/data da confirmação atual.
- `confirm_inter_binding(p_company uuid, p_environment text,
  p_configuration_version integer, p_previous_binding uuid, p_confirmed boolean)`:
  exige confirmação `true`, versão revisada e perfil **Admin ou Financeiro**,
  além de acesso financeiro de escrita à empresa. Na primeira confirmação,
  `p_previous_binding` é nulo; na reconfirmação, usar o identificador consultado.

Ambientes: `sandbox` e `production`. Não há ambiente implícito. Confirmar um
não confirma nem ativa o outro; a seleção padrão em Configurações permanece intacta.

Estados de consulta: `company_tax_mismatch`, `configuration_missing`,
`certificate_expired`, `confirmation_required`, `bound_to_another_company`,
`confirmation_outdated` e `confirmed`. `confirmed` significa somente vínculo
interno confirmado, nunca autorização para envio ao banco.

## Segurança e histórico

Sessão e tenant derivadas do usuário autenticado. Admin sem acesso financeiro
explícito não consegue consultar ou confirmar. A consulta aceita acesso de leitura;
a confirmação exige escrita e um dos dois perfis indicados. Nenhum RPC retorna
chaves, certificado, identificador do Vault ou conta completa.

A configuração atual admite apenas uma conta por tenant/ambiente. Portanto,
há no máximo um vínculo vigente por tenant/ambiente. Não é permitido transferi-lo
silenciosamente para outra empresa; transferência/revogação terão fluxo próprio.

Toda mudança da versão da configuração exige reconfirmação, inclusive alteração
do ambiente padrão pelo salvamento existente. Mudanças de CNPJ e certificado
vencido também bloqueiam a confirmação. Consulta e confirmação não leem o Vault.

O lock da tenant serializa confirmação e salvamento de credenciais. Retry da
mesma confirmação reutiliza o registro. Reconfirmação de versão nova preserva
o registro antigo com exclusão lógica e gera outro, com ator e auditoria.
Usuários e serviço não possuem escrita direta nessa tabela. Exclusão física
e truncate são bloqueados pelos guards existentes.

Os pedidos da fatia 4 continuam em `blocked_homologation`, sem qualquer alteração.
O futuro processador deverá verificar novamente versão, empresa, certificado,
titularidade e confirmação, e associar a solicitação ao vínculo exato antes do envio.

## Publicação e testes

Migration: `20260909150549_operating_company_inter_binding.sql`.
Testes com fixtures e rollback: `supabase/tests/operating_company_inter_binding_test.sql`.
Incluem isolamento de tenant, Admin/Financeiro, leitura sem escrita, sessão
inativa, versão desatualizada, CNPJ divergente, certificado vencido,
idempotência, auditoria e bloqueio de acesso direto/anônimo/serviço.

Publicação necessária: migration no Supabase. Não há mudança no aplicativo web
ou Edge Functions, portanto não é necessário rebuild no Dokploy nesta fatia.
Nenhum vínculo real é criado por esta migration.

Implantação confirmada em 09/09/2026: migration aplicada e registrada no
Supabase self-hosted. Passaram 39 testes novos e 126 regressões (17 de
preparação Inter, 19 de configuração Inter, 44 da fundação e 46 de fechamento),
totalizando 165. Advisor de segurança sem apontamentos nos novos objetos.
Consulta autenticada da tenant APTech retorna `confirmation_required` nos
dois ambientes; zero vínculos reais criados. RLS habilitada e nenhum envio bancário.
Backup estrutural anterior no servidor:
`/home/administrador/apticket-backups/apticket_schema_before_inter_binding_20260909150549.sql.gz`.

Próxima fatia: interface de consulta e confirmação do vínculo, reutilizando
Configurações/Financeiro. Depois: dados do pagador e processamento homologado
de emissão/retorno, sem habilitar produção por inferência.

Referência de segurança consultada com a skill Supabase:
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
