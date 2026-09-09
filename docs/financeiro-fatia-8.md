# Financeiro: pré-validação e snapshot do pagador Inter

## Escopo

Esta fatia monta os dados do pagador usando o cliente do contrato e permite
confirmar um snapshot imutável para uma solicitação já preparada. Ela não chama
o Banco Inter, não emite boleto/PIX e mantém toda solicitação em
`blocked_homologation` com `dispatch_enabled: false`.

A referência oficial da API Cobrança exige `seuNumero` com até 15 caracteres,
valor entre R$ 2,50 e R$ 99.999.999,99, vencimento e objeto do pagador. O portal
também informa que a emissão é assíncrona e que o retorno definitivo deve ser
acompanhado por webhook ou consulta ativa. Fonte consultada:
[API Cobrança (Boleto com Pix)](https://developers.inter.co/references/cobranca-bolepix).

## Fonte e validações

O pagador vem de `companies`, através do `company_id` imutável do recebível:

- razão/nome, CNPJ, telefone, logradouro, número, complemento, bairro, cidade,
  UF e CEP;
- CNPJ normalizado e validado pelos dois dígitos verificadores;
- telefone opcional normalizado em DDD e número; se informado e inválido,
  bloqueia a confirmação;
- UF limitada às 27 siglas brasileiras e CEP com oito dígitos;
- valor, vencimento, saldo/status e identidade do recebível conferidos novamente;
- vínculo bancário precisa estar confirmado, vigente e na mesma empresa/ambiente.

O cadastro atual de cliente não possui e-mail financeiro determinístico; por
isso nenhum contato arbitrário é escolhido e `payer_email` permanece nulo.
Uma escolha explícita de contato de cobrança deverá ser adicionada antes de
usar e-mail no payload bancário.

O campo `seuNumero` é gerado de forma estável a partir da solicitação, com 15
caracteres, e possui unicidade por tenant/ambiente entre snapshots vigentes.
O fingerprint considera todos os dados usados no payload. Alterações no cadastro
ou no recebível invalidam a confirmação e exigem nova revisão.

## API e segurança

- `review_inter_payer(p_request uuid)`: retorna estado, faltas, dados normalizados,
  vínculo, fingerprint e snapshot atual, apenas dentro do escopo financeiro.
- `confirm_inter_payer(p_request uuid, p_source_fingerprint text, p_binding uuid,
  p_previous_snapshot uuid, p_confirmed boolean)`: exige confirmação explícita,
  perfil Admin/Financeiro e acesso financeiro de escrita.

Estados: `missing_data`, `binding_required`, `confirmation_required`,
`confirmation_outdated` e `confirmed`. Faltas possíveis: `name`, `tax_id`,
`street`, `number`, `district`, `city`, `state`, `zip`, `phone`, `amount`,
`due_date` e `receivable`.

`inter_payer_snapshots` tem RLS por empresa, leitura apenas para usuários no
escopo e nenhuma escrita direta pela API. Reconfirmação faz exclusão lógica do
snapshot anterior, preserva histórico e registra ator/dados na auditoria. DELETE
físico e TRUNCATE são bloqueados. O helper de CNPJ permanece privado.

## Verificação e publicação

Migration: `20260909170856_inter_payer_snapshot_preflight.sql`.
Testes: `supabase/tests/inter_payer_snapshot_preflight_test.sql`.

Os testes cobrem dados incompletos, CNPJ, normalização, confirmação, retry,
mudança de cadastro/recebível/vínculo, auditoria, RLS, usuário sem escopo,
anônimo, bloqueio de escrita e manutenção do despacho desabilitado.

Publicação necessária apenas da migration no Supabase. Não há alteração web ou
Edge Function nesta fatia; portanto não há deploy no Dokploy. Nenhum snapshot
real é criado automaticamente.

Implantação confirmada em 09/09/2026: migration aplicada e registrada no
Supabase self-hosted. Passaram 31 testes novos e 165 regressões das fatias de
empresa/vínculo, solicitação, configuração, fundação e fechamento, totalizando
196. Advisor de segurança sem apontamentos nos novos objetos. RLS habilitada,
RPCs negadas para anon/service role e zero snapshots reais após a publicação.
Backup estrutural anterior no servidor:
`/home/administrador/apticket-backups/apticket_schema_before_payer_snapshot_20260909170856.sql.gz`.

Próxima fatia: apresentar a revisão do pagador dentro da tela Cobrança Inter,
com indicação dos campos faltantes e link para corrigir o cliente. Só depois
disso será implementado o processador de emissão em homologação, com recuperação
de resultado incerto e retorno assíncrono.
