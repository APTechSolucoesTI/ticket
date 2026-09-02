alter type apticket.status_medicao_contrato add value if not exists 'aprovada' after 'gerada';

alter table apticket.medicoes_contrato
  add column if not exists aprovada_em timestamptz,
  add column if not exists aprovada_por uuid references apticket.profiles(id) on delete set null,
  add column if not exists aprovada_por_nome text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid references apticket.profiles(id) on delete set null,
  add column if not exists cancelada_por_nome text,
  add column if not exists justificativa_cancelamento text;

create table if not exists apticket.contas_receber (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  medicao_id uuid not null unique references apticket.medicoes_contrato(id) on delete restrict,
  contrato_id uuid not null references apticket.contracts(id) on delete restrict,
  company_id uuid not null references apticket.companies(id) on delete restrict,
  cliente_nome text not null,
  documento_referencia text not null,
  descricao text not null,
  competencia date not null,
  valor_original numeric(14,2) not null check (valor_original >= 0),
  valor_aberto numeric(14,2) not null check (valor_aberto >= 0),
  vencimento_em date not null,
  status_cobranca apticket.status_cobranca_avulsa not null default 'a_faturar',
  observacoes text,
  aprovado_em timestamptz not null,
  aprovado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint contas_receber_competencia_primeiro_dia_check
    check (competencia = date_trunc('month', competencia)::date)
);

create index if not exists contas_receber_fila_idx
  on apticket.contas_receber (tenant_id, status_cobranca, vencimento_em)
  where deleted_at is null;

alter table apticket.contas_receber enable row level security;

revoke all on table apticket.contas_receber from public, anon, authenticated;
grant select, update on table apticket.contas_receber to authenticated;
grant all on table apticket.contas_receber to service_role;

drop policy if exists "contas_receber select" on apticket.contas_receber;
create policy "contas_receber select" on apticket.contas_receber
for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'financeiro', 'view')
);

drop policy if exists "contas_receber update" on apticket.contas_receber;
create policy "contas_receber update" on apticket.contas_receber
for update to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
)
with check (
  tenant_id = apticket.current_tenant_id()
  and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
);

create or replace function apticket.bloquear_alteracao_medicao()
returns trigger
language plpgsql
set search_path = pg_catalog, apticket
as $$
begin
  if (
    to_jsonb(new) - array[
      'status',
      'aprovada_em',
      'aprovada_por',
      'aprovada_por_nome',
      'cancelada_em',
      'cancelada_por',
      'cancelada_por_nome',
      'justificativa_cancelamento'
    ]
  ) is distinct from (
    to_jsonb(old) - array[
      'status',
      'aprovada_em',
      'aprovada_por',
      'aprovada_por_nome',
      'cancelada_em',
      'cancelada_por',
      'cancelada_por_nome',
      'justificativa_cancelamento'
    ]
  ) then
    raise exception using errcode = '55000', message = 'A medição é histórica e não pode ser alterada.';
  end if;
  return new;
end
$$;

create or replace function apticket.proteger_conta_receber()
returns trigger
language plpgsql
set search_path = pg_catalog, apticket
as $$
begin
  if row(
    new.tenant_id, new.medicao_id, new.contrato_id, new.company_id,
    new.cliente_nome, new.documento_referencia, new.descricao,
    new.competencia, new.valor_original, new.aprovado_em, new.aprovado_por,
    new.created_at
  ) is distinct from row(
    old.tenant_id, old.medicao_id, old.contrato_id, old.company_id,
    old.cliente_nome, old.documento_referencia, old.descricao,
    old.competencia, old.valor_original, old.aprovado_em, old.aprovado_por,
    old.created_at
  ) then
    raise exception using errcode = '55000', message = 'A origem da conta a receber não pode ser alterada.';
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function apticket.proteger_conta_receber() from public, anon;

drop trigger if exists contas_receber_proteger_alteracao on apticket.contas_receber;
create trigger contas_receber_proteger_alteracao
before update on apticket.contas_receber
for each row execute function apticket.proteger_conta_receber();

create or replace function apticket.cancelar_medicao_contrato_confirmada(
  p_medicao_id uuid,
  p_justificativa text,
  p_actor_id uuid,
  p_tenant_id uuid
)
returns apticket.medicoes_contrato
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_medicao apticket.medicoes_contrato;
  v_actor_nome text;
  v_justificativa text := btrim(coalesce(p_justificativa, ''));
begin
  if char_length(v_justificativa) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'A justificativa deve ter entre 10 e 1000 caracteres.';
  end if;

  select profile.name into v_actor_nome
  from apticket.profiles as profile
  where profile.id = p_actor_id
    and profile.tenant_id = p_tenant_id
    and profile.is_active;

  if v_actor_nome is null
    or not apticket.has_permission(p_actor_id, 'contratos', 'edit') then
    raise exception using errcode = '42501', message = 'Usuário sem permissão para cancelar a medição.';
  end if;

  select * into v_medicao
  from apticket.medicoes_contrato
  where id = p_medicao_id
    and tenant_id = p_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Medição não encontrada.';
  end if;

  if v_medicao.status <> 'gerada' then
    raise exception using errcode = '22023', message = 'Somente uma medição gerada pode ser cancelada.';
  end if;

  update apticket.medicoes_contrato
  set status = 'cancelada',
      cancelada_em = now(),
      cancelada_por = p_actor_id,
      cancelada_por_nome = v_actor_nome,
      justificativa_cancelamento = v_justificativa
  where id = p_medicao_id
  returning * into v_medicao;

  return v_medicao;
end
$$;

revoke all on function apticket.cancelar_medicao_contrato_confirmada(uuid, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function apticket.cancelar_medicao_contrato_confirmada(uuid, text, uuid, uuid)
  to service_role;

create or replace function apticket.aprovar_medicao_contrato(p_medicao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_tenant_id uuid := apticket.current_tenant_id();
  v_medicao apticket.medicoes_contrato;
  v_actor_nome text;
  v_company_id uuid;
  v_conta_id uuid;
  v_ja_aprovada boolean := false;
begin
  if auth.uid() is null
    or v_tenant_id is null
    or not apticket.has_permission(auth.uid(), 'contratos', 'edit') then
    raise exception using errcode = '42501', message = 'Sem permissão para aprovar a medição.';
  end if;

  select profile.name into v_actor_nome
  from apticket.profiles as profile
  where profile.id = auth.uid()
    and profile.tenant_id = v_tenant_id
    and profile.is_active;

  if v_actor_nome is null then
    raise exception using errcode = '42501', message = 'Usuário ativo não encontrado.';
  end if;

  select * into v_medicao
  from apticket.medicoes_contrato
  where id = p_medicao_id
    and tenant_id = v_tenant_id
    and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Medição não encontrada.';
  end if;

  if v_medicao.status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Uma medição cancelada não pode ser aprovada.';
  elsif v_medicao.status = 'faturada' then
    raise exception using errcode = '22023', message = 'Uma medição faturada não pode ser aprovada novamente.';
  elsif v_medicao.status = 'aprovada' then
    v_ja_aprovada := true;
  elsif v_medicao.status <> 'gerada' then
    raise exception using errcode = '22023', message = 'A medição não está disponível para aprovação.';
  else
    update apticket.medicoes_contrato
    set status = 'aprovada',
        aprovada_em = now(),
        aprovada_por = auth.uid(),
        aprovada_por_nome = v_actor_nome
    where id = p_medicao_id
    returning * into v_medicao;
  end if;

  select company_id into v_company_id
  from apticket.contracts
  where id = v_medicao.contrato_id
    and tenant_id = v_tenant_id;

  if v_company_id is null then
    raise exception using errcode = 'P0002', message = 'Cliente do contrato não encontrado.';
  end if;

  insert into apticket.contas_receber (
    tenant_id, medicao_id, contrato_id, company_id, cliente_nome,
    documento_referencia, descricao, competencia, valor_original,
    valor_aberto, vencimento_em, aprovado_em, aprovado_por
  ) values (
    v_tenant_id,
    v_medicao.id,
    v_medicao.contrato_id,
    v_company_id,
    v_medicao.cliente_nome,
    'MED-' || replace(v_medicao.numero_contrato, '/', '-') || '-' || to_char(v_medicao.competencia, 'YYYYMM'),
    'Medição do contrato ' || v_medicao.numero_contrato || ' - competência ' || to_char(v_medicao.competencia, 'MM/YYYY'),
    v_medicao.competencia,
    v_medicao.valor_total,
    v_medicao.valor_total,
    v_medicao.data_vencimento,
    coalesce(v_medicao.aprovada_em, now()),
    coalesce(v_medicao.aprovada_por, auth.uid())
  )
  on conflict (medicao_id) do nothing
  returning id into v_conta_id;

  if v_conta_id is null then
    select id into v_conta_id
    from apticket.contas_receber
    where medicao_id = v_medicao.id;
  end if;

  return jsonb_build_object(
    'medicao_id', v_medicao.id,
    'conta_receber_id', v_conta_id,
    'status', 'aprovada',
    'ja_aprovada', v_ja_aprovada
  );
end
$$;

revoke all on function apticket.aprovar_medicao_contrato(uuid) from public, anon;
grant execute on function apticket.aprovar_medicao_contrato(uuid) to authenticated, service_role;

revoke execute on function apticket.atualizar_status_medicao_contrato(
  uuid,
  apticket.status_medicao_contrato
) from authenticated;

create or replace function apticket.atualizar_cobrancas_vencidas()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_tenant uuid := apticket.current_tenant_id();
  v_avulsas integer := 0;
  v_medicoes integer := 0;
begin
  if v_tenant is null
     or not apticket.has_permission(auth.uid(), 'financeiro', 'view') then
    raise exception 'Sem permissão para atualizar cobranças vencidas';
  end if;

  update apticket.tickets_cobranca_avulsa
  set status_cobranca = 'vencido', updated_at = now()
  where tenant_id = v_tenant
    and status_cobranca = 'faturado'
    and vencimento_em < current_date
    and deleted_at is null;
  get diagnostics v_avulsas = row_count;

  update apticket.contas_receber
  set status_cobranca = 'vencido', updated_at = now()
  where tenant_id = v_tenant
    and status_cobranca = 'faturado'
    and vencimento_em < current_date
    and deleted_at is null;
  get diagnostics v_medicoes = row_count;

  return v_avulsas + v_medicoes;
end
$$;
