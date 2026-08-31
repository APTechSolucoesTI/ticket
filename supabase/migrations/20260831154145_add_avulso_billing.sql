begin;

create type apticket.tipo_atendimento as enum ('contratual', 'avulso');
create type apticket.motivo_avulso as enum ('cliente_sem_contrato', 'equipamento_sem_contrato');
create type apticket.status_cobranca_avulsa as enum (
  'a_faturar',
  'faturado',
  'vencido',
  'recebido',
  'cancelado'
);

alter table apticket.tickets
  add column tipo_atendimento apticket.tipo_atendimento not null default 'contratual',
  add column motivo_avulso apticket.motivo_avulso;

alter table apticket.tickets
  add constraint tickets_motivo_avulso_consistente check (
    (tipo_atendimento = 'contratual' and motivo_avulso is null)
    or (tipo_atendimento = 'avulso' and motivo_avulso is not null)
  );

create index tickets_tipo_atendimento_idx
  on apticket.tickets (tenant_id, tipo_atendimento, created_at desc);

create table apticket.tabela_precos_avulso (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  nome text not null default 'Tabela padrão',
  limite_valor_fixo_minutos integer not null default 90
    check (limite_valor_fixo_minutos > 0),
  valor_fixo numeric(12,2) not null default 0 check (valor_fixo >= 0),
  valor_hora_tecnica numeric(12,2) not null default 0 check (valor_hora_tecnica >= 0),
  vigente_desde date not null default current_date,
  vigente_ate date,
  ativa boolean not null default true,
  criado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint tabela_precos_avulso_vigencia_valida
    check (vigente_ate is null or vigente_ate >= vigente_desde)
);

create index tabela_precos_avulso_tenant_vigencia_idx
  on apticket.tabela_precos_avulso (tenant_id, vigente_desde desc)
  where deleted_at is null;

create unique index tabela_precos_avulso_uma_ativa_idx
  on apticket.tabela_precos_avulso (tenant_id)
  where ativa and deleted_at is null;

create table apticket.tickets_cobranca_avulsa (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references apticket.tickets(id) on delete restrict,
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  tabela_preco_id uuid references apticket.tabela_precos_avulso(id) on delete set null,
  limite_valor_fixo_minutos integer not null default 90,
  valor_fixo_snapshot numeric(12,2) not null default 0,
  valor_hora_snapshot numeric(12,2) not null default 0,
  minutos_apurados integer not null default 0 check (minutos_apurados >= 0),
  valor_base numeric(12,2) not null default 0 check (valor_base >= 0),
  valor_final numeric(12,2) not null default 0 check (valor_final >= 0),
  valor_ajustado_manualmente boolean not null default false,
  justificativa_ajuste text,
  status_cobranca apticket.status_cobranca_avulsa not null default 'a_faturar',
  vencimento_em date,
  observacoes text,
  revisado_em timestamptz,
  revisado_por uuid references apticket.profiles(id) on delete set null,
  criado_por uuid references apticket.profiles(id) on delete set null,
  atualizado_por uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint cobranca_avulsa_ajuste_justificado check (
    not valor_ajustado_manualmente
    or nullif(trim(coalesce(justificativa_ajuste, '')), '') is not null
  )
);

create index tickets_cobranca_avulsa_fila_idx
  on apticket.tickets_cobranca_avulsa (tenant_id, status_cobranca, created_at desc)
  where deleted_at is null;

create table apticket.tickets_cobranca_avulsa_audit (
  id uuid primary key default gen_random_uuid(),
  cobranca_id uuid not null references apticket.tickets_cobranca_avulsa(id) on delete restrict,
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  actor_id uuid references apticket.profiles(id) on delete set null,
  valores_anteriores jsonb not null,
  valores_novos jsonb not null,
  created_at timestamptz not null default now()
);

create index tickets_cobranca_avulsa_audit_idx
  on apticket.tickets_cobranca_avulsa_audit (cobranca_id, created_at desc);

insert into apticket.permissions (module, action)
values ('financeiro', 'view'), ('financeiro', 'edit')
on conflict (module, action) do nothing;

insert into apticket.role_permissions (role_id, permission_id)
select r.id, p.id
from apticket.roles r
join apticket.permissions p on p.module = 'financeiro'
where r.is_system
on conflict do nothing;

insert into apticket.roles (tenant_id, name, description, is_system)
select t.id, 'Financeiro', 'Faturamento e recebimento de atendimentos avulsos', false
from apticket.tenants t
where not exists (
  select 1 from apticket.roles r
  where r.tenant_id = t.id and lower(r.name) = 'financeiro'
);

insert into apticket.role_permissions (role_id, permission_id)
select r.id, p.id
from apticket.roles r
join apticket.permissions p
  on (p.module = 'financeiro' and p.action in ('view', 'edit'))
  or (p.module in ('tickets', 'relatorios') and p.action = 'view')
where lower(r.name) = 'financeiro'
on conflict do nothing;

insert into apticket.tabela_precos_avulso (tenant_id)
select t.id from apticket.tenants t
where not exists (
  select 1 from apticket.tabela_precos_avulso tp
  where tp.tenant_id = t.id and tp.ativa and tp.deleted_at is null
);

create or replace function apticket.seed_tenant_default_roles(_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = apticket
as $$
declare
  v_admin uuid;
  v_agent uuid;
  v_req uuid;
  v_fin uuid;
begin
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Admin', 'Acesso total ao workspace', true)
    returning id into v_admin;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Agente', 'Atende tickets e opera o dia a dia', false)
    returning id into v_agent;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Solicitante', 'Abre e acompanha os próprios tickets', false)
    returning id into v_req;
  insert into apticket.roles (tenant_id, name, description, is_system)
    values (_tenant_id, 'Financeiro', 'Faturamento e recebimento de atendimentos avulsos', false)
    returning id into v_fin;

  insert into apticket.role_permissions (role_id, permission_id)
    select v_admin, id from apticket.permissions;

  insert into apticket.role_permissions (role_id, permission_id)
    select r, id
    from apticket.permissions, unnest(array[v_agent, v_req]) as r
    where module not in ('papeis','permissoes','usuarios','financeiro')
      and not (module = 'canais' and action = 'edit')
      and not (module = 'empresa' and action = 'edit')
      and not (module = 'configuracoes' and action = 'edit')
      and not (module = 'base_conhecimento' and action in ('create','edit','delete'))
      and not (module = 'respostas_padrao' and action in ('create','edit','delete'))
      and not (
        module in ('departamentos','familia_servicos','servicos_prestados','tipos_contrato','slas','figurinhas')
        and action in ('create','edit','delete')
      );

  insert into apticket.role_permissions (role_id, permission_id)
    select v_fin, id from apticket.permissions
    where (module = 'financeiro' and action in ('view', 'edit'))
       or (module in ('tickets', 'relatorios') and action = 'view');

  insert into apticket.tabela_precos_avulso (tenant_id, criado_por)
    values (_tenant_id, null);
end;
$$;

create or replace function apticket.resolver_atendimento_ticket(
  _tenant_id uuid,
  _company_id uuid,
  _equipment_id uuid default null,
  _aberto_em timestamptz default now()
)
returns table (
  tipo apticket.tipo_atendimento,
  motivo apticket.motivo_avulso,
  contrato_id uuid,
  sla_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_data date := (_aberto_em at time zone 'America/Sao_Paulo')::date;
begin
  if _company_id is null or not exists (
    select 1
    from apticket.contracts c
    where c.tenant_id = _tenant_id
      and c.company_id = _company_id
      and c.status = 'active'
      and v_data between c.starts_at and c.ends_at
  ) then
    return query select
      'avulso'::apticket.tipo_atendimento,
      'cliente_sem_contrato'::apticket.motivo_avulso,
      null::uuid,
      null::uuid;
    return;
  end if;

  if _equipment_id is not null then
    return query
    select
      'contratual'::apticket.tipo_atendimento,
      null::apticket.motivo_avulso,
      c.id,
      c.sla_policy_id
    from apticket.contracts c
    join apticket.contract_equipments ce
      on ce.contract_id = c.id
     and ce.equipment_id = _equipment_id
     and ce.tenant_id = _tenant_id
    where c.tenant_id = _tenant_id
      and c.company_id = _company_id
      and c.status = 'active'
      and v_data between c.starts_at and c.ends_at
    order by c.starts_at desc
    limit 1;

    if found then return; end if;

    return query select
      'avulso'::apticket.tipo_atendimento,
      'equipamento_sem_contrato'::apticket.motivo_avulso,
      null::uuid,
      null::uuid;
    return;
  end if;

  return query
  select
    'contratual'::apticket.tipo_atendimento,
    null::apticket.motivo_avulso,
    c.id,
    c.sla_policy_id
  from apticket.contracts c
  where c.tenant_id = _tenant_id
    and c.company_id = _company_id
    and c.status = 'active'
    and v_data between c.starts_at and c.ends_at
  order by c.starts_at desc
  limit 1;
end;
$$;

create or replace function apticket.classificar_ticket_antes_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_result record;
begin
  select * into v_result
  from apticket.resolver_atendimento_ticket(
    new.tenant_id, new.company_id, new.equipment_id, coalesce(new.created_at, now())
  );

  new.tipo_atendimento := v_result.tipo;
  new.motivo_avulso := v_result.motivo;
  new.contract_id := v_result.contrato_id;
  new.sla_policy_id := v_result.sla_id;
  if new.tipo_atendimento = 'avulso' then
    new.sla_first_response_due_at := null;
    new.sla_resolution_due_at := null;
    new.sla_breached := false;
  end if;
  return new;
end;
$$;

create or replace function apticket.criar_cobranca_ticket_avulso(_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_ticket apticket.tickets%rowtype;
  v_preco apticket.tabela_precos_avulso%rowtype;
begin
  select * into v_ticket from apticket.tickets where id = _ticket_id;
  if not found or v_ticket.tipo_atendimento <> 'avulso' then return; end if;

  select * into v_preco
  from apticket.tabela_precos_avulso p
  where p.tenant_id = v_ticket.tenant_id
    and p.ativa
    and p.deleted_at is null
    and (v_ticket.created_at at time zone 'America/Sao_Paulo')::date >= p.vigente_desde
    and (p.vigente_ate is null
      or (v_ticket.created_at at time zone 'America/Sao_Paulo')::date <= p.vigente_ate)
  order by p.vigente_desde desc
  limit 1;

  insert into apticket.tickets_cobranca_avulsa (
    ticket_id, tenant_id, tabela_preco_id, limite_valor_fixo_minutos,
    valor_fixo_snapshot, valor_hora_snapshot, valor_base, valor_final, criado_por
  ) values (
    v_ticket.id,
    v_ticket.tenant_id,
    v_preco.id,
    coalesce(v_preco.limite_valor_fixo_minutos, 90),
    coalesce(v_preco.valor_fixo, 0),
    coalesce(v_preco.valor_hora_tecnica, 0),
    coalesce(v_preco.valor_fixo, 0),
    coalesce(v_preco.valor_fixo, 0),
    auth.uid()
  ) on conflict (ticket_id) do nothing;
end;
$$;

create or replace function apticket.criar_cobranca_ticket_avulso_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform apticket.criar_cobranca_ticket_avulso(new.id);
  return new;
end;
$$;

create or replace function apticket.proteger_classificacao_ticket()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if pg_trigger_depth() = 1 and (
    new.tipo_atendimento is distinct from old.tipo_atendimento
    or new.motivo_avulso is distinct from old.motivo_avulso
  ) then
    raise exception 'A classificação do atendimento é imutável após a abertura do ticket';
  end if;
  return new;
end;
$$;

create or replace function apticket.validar_equipamento_ticket_avulso()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_ticket apticket.tickets%rowtype;
  v_equipment apticket.equipments%rowtype;
  v_result record;
begin
  select * into v_ticket from apticket.tickets where id = new.ticket_id;
  select * into v_equipment from apticket.equipments where id = new.equipment_id;
  if v_ticket.id is null or v_equipment.id is null
     or v_ticket.tenant_id <> new.tenant_id
     or v_equipment.tenant_id <> new.tenant_id
     or v_equipment.company_id is distinct from v_ticket.company_id then
    raise exception 'Equipamento não pertence ao cliente e tenant do ticket';
  end if;

  if v_ticket.tipo_atendimento = 'contratual' then
    select * into v_result
    from apticket.resolver_atendimento_ticket(
      v_ticket.tenant_id, v_ticket.company_id, new.equipment_id, v_ticket.created_at
    );
    if v_result.tipo = 'avulso' then
      update apticket.tickets
      set tipo_atendimento = 'avulso',
          motivo_avulso = v_result.motivo,
          contract_id = null,
          sla_policy_id = null,
          sla_first_response_due_at = null,
          sla_resolution_due_at = null,
          sla_breached = false
      where id = v_ticket.id;
      perform apticket.criar_cobranca_ticket_avulso(v_ticket.id);
    elsif v_result.contrato_id is distinct from v_ticket.contract_id then
      update apticket.tickets
      set contract_id = v_result.contrato_id,
          sla_policy_id = v_result.sla_id
      where id = v_ticket.id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function apticket.recalcular_cobranca_avulsa(_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_minutos integer;
  v_cobranca apticket.tickets_cobranca_avulsa%rowtype;
  v_base numeric(12,2);
begin
  select * into v_cobranca
  from apticket.tickets_cobranca_avulsa
  where ticket_id = _ticket_id and deleted_at is null;
  if not found then return; end if;

  select coalesce(sum(minutes), 0)::integer into v_minutos
  from apticket.time_entries where ticket_id = _ticket_id;

  v_base := case
    when v_minutos <= v_cobranca.limite_valor_fixo_minutos
      then v_cobranca.valor_fixo_snapshot
    else round((v_minutos::numeric / 60) * v_cobranca.valor_hora_snapshot, 2)
  end;

  update apticket.tickets_cobranca_avulsa
  set minutos_apurados = v_minutos,
      valor_base = v_base,
      valor_final = case when valor_ajustado_manualmente then valor_final else v_base end,
      revisado_em = case
        when v_base is distinct from v_cobranca.valor_base
          and status_cobranca not in ('recebido', 'cancelado') then null
        else revisado_em
      end,
      revisado_por = case
        when v_base is distinct from v_cobranca.valor_base
          and status_cobranca not in ('recebido', 'cancelado') then null
        else revisado_por
      end,
      updated_at = now()
  where id = v_cobranca.id;
end;
$$;

create or replace function apticket.recalcular_cobranca_por_apontamento()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    perform apticket.recalcular_cobranca_avulsa(old.ticket_id);
    return old;
  end if;
  perform apticket.recalcular_cobranca_avulsa(new.ticket_id);
  return new;
end;
$$;

create or replace function apticket.recalcular_cobranca_por_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.tipo_atendimento = 'avulso'
     and new.status in ('resolved', 'closed')
     and new.status is distinct from old.status then
    perform apticket.recalcular_cobranca_avulsa(new.id);
    update apticket.tickets_cobranca_avulsa
      set revisado_em = null, revisado_por = null, updated_at = now()
      where ticket_id = new.id and status_cobranca <> 'cancelado';
  end if;
  return new;
end;
$$;

create or replace function apticket.proteger_edicao_cobranca_avulsa()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.ticket_id := old.ticket_id;
  new.tenant_id := old.tenant_id;
  new.created_at := old.created_at;
  new.updated_at := now();

  if pg_trigger_depth() = 1 then
    new.tabela_preco_id := old.tabela_preco_id;
    new.limite_valor_fixo_minutos := old.limite_valor_fixo_minutos;
    new.valor_fixo_snapshot := old.valor_fixo_snapshot;
    new.valor_hora_snapshot := old.valor_hora_snapshot;
    new.minutos_apurados := old.minutos_apurados;
    new.valor_base := old.valor_base;
    new.deleted_at := old.deleted_at;
    new.valor_ajustado_manualmente := old.valor_ajustado_manualmente;
    if new.valor_final is distinct from old.valor_final then
      if nullif(trim(coalesce(new.justificativa_ajuste, '')), '') is null then
        raise exception 'Informe a justificativa para ajustar o valor final';
      end if;
      new.valor_ajustado_manualmente := true;
    end if;
    new.atualizado_por := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function apticket.auditar_cobranca_avulsa()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(
    old.valor_final, old.status_cobranca, old.vencimento_em, old.observacoes,
    old.justificativa_ajuste, old.revisado_em
  ) is distinct from row(
    new.valor_final, new.status_cobranca, new.vencimento_em, new.observacoes,
    new.justificativa_ajuste, new.revisado_em
  ) then
    insert into apticket.tickets_cobranca_avulsa_audit (
      cobranca_id, tenant_id, actor_id, valores_anteriores, valores_novos
    ) values (
      new.id,
      new.tenant_id,
      auth.uid(),
      jsonb_build_object(
        'valor_final', old.valor_final,
        'status_cobranca', old.status_cobranca,
        'vencimento_em', old.vencimento_em,
        'observacoes', old.observacoes,
        'justificativa_ajuste', old.justificativa_ajuste,
        'revisado_em', old.revisado_em
      ),
      jsonb_build_object(
        'valor_final', new.valor_final,
        'status_cobranca', new.status_cobranca,
        'vencimento_em', new.vencimento_em,
        'observacoes', new.observacoes,
        'justificativa_ajuste', new.justificativa_ajuste,
        'revisado_em', new.revisado_em
      )
    );
  end if;
  return new;
end;
$$;

create or replace function apticket.prever_atendimento_avulso(
  _company_id uuid,
  _equipment_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_tenant uuid := apticket.current_tenant_id();
  v_equipment uuid;
  v_result record;
begin
  if v_tenant is null
     or not apticket.has_permission(auth.uid(), 'tickets', 'create')
     or not exists (
       select 1 from apticket.companies c
       where c.id = _company_id and c.tenant_id = v_tenant
     ) then
    raise exception 'Sem permissão para verificar o atendimento';
  end if;

  if coalesce(cardinality(_equipment_ids), 0) = 0 then
    select * into v_result
    from apticket.resolver_atendimento_ticket(v_tenant, _company_id, null, now());
    return jsonb_build_object(
      'tipo_atendimento', v_result.tipo,
      'motivo_avulso', v_result.motivo,
      'contract_id', v_result.contrato_id
    );
  end if;

  foreach v_equipment in array _equipment_ids loop
    if not exists (
      select 1 from apticket.equipments e
      where e.id = v_equipment and e.tenant_id = v_tenant and e.company_id = _company_id
    ) then
      raise exception 'Equipamento inválido para o cliente';
    end if;
    select * into v_result
    from apticket.resolver_atendimento_ticket(v_tenant, _company_id, v_equipment, now());
    if v_result.tipo = 'avulso' then
      return jsonb_build_object(
        'tipo_atendimento', v_result.tipo,
        'motivo_avulso', v_result.motivo,
        'contract_id', null
      );
    end if;
  end loop;

  return jsonb_build_object(
    'tipo_atendimento', 'contratual',
    'motivo_avulso', null,
    'contract_id', v_result.contrato_id
  );
end;
$$;

create or replace function apticket.atualizar_cobrancas_vencidas()
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_tenant uuid := apticket.current_tenant_id();
  v_count integer;
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
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create trigger tickets_classificar_atendimento
  before insert on apticket.tickets
  for each row execute function apticket.classificar_ticket_antes_insert();

create trigger tickets_criar_cobranca_avulsa
  after insert on apticket.tickets
  for each row execute function apticket.criar_cobranca_ticket_avulso_trigger();

create trigger tickets_proteger_classificacao
  before update of tipo_atendimento, motivo_avulso on apticket.tickets
  for each row execute function apticket.proteger_classificacao_ticket();

create trigger ticket_equipments_validar_avulso
  after insert on apticket.ticket_equipments
  for each row execute function apticket.validar_equipamento_ticket_avulso();

create trigger time_entries_recalcular_avulso
  after insert or update of minutes or delete on apticket.time_entries
  for each row execute function apticket.recalcular_cobranca_por_apontamento();

create trigger tickets_recalcular_avulso_status
  after update of status on apticket.tickets
  for each row execute function apticket.recalcular_cobranca_por_status();

create trigger tabela_precos_avulso_updated_at
  before update on apticket.tabela_precos_avulso
  for each row execute function apticket.set_updated_at();

create trigger cobranca_avulsa_proteger_edicao
  before update on apticket.tickets_cobranca_avulsa
  for each row execute function apticket.proteger_edicao_cobranca_avulsa();

create trigger cobranca_avulsa_audit
  after update on apticket.tickets_cobranca_avulsa
  for each row execute function apticket.auditar_cobranca_avulsa();

alter table apticket.tabela_precos_avulso enable row level security;
alter table apticket.tickets_cobranca_avulsa enable row level security;
alter table apticket.tickets_cobranca_avulsa_audit enable row level security;

revoke all on apticket.tabela_precos_avulso from anon, authenticated;
revoke all on apticket.tickets_cobranca_avulsa from anon, authenticated;
revoke all on apticket.tickets_cobranca_avulsa_audit from anon, authenticated;
grant select, insert, update on apticket.tabela_precos_avulso to authenticated;
grant select, update on apticket.tickets_cobranca_avulsa to authenticated;
grant select on apticket.tickets_cobranca_avulsa_audit to authenticated;
grant all on apticket.tabela_precos_avulso to service_role;
grant all on apticket.tickets_cobranca_avulsa to service_role;
grant all on apticket.tickets_cobranca_avulsa_audit to service_role;

create policy "tabela_precos_avulso select" on apticket.tabela_precos_avulso
  for select to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'view')
  );
create policy "tabela_precos_avulso insert" on apticket.tabela_precos_avulso
  for insert to authenticated
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
  );
create policy "tabela_precos_avulso update" on apticket.tabela_precos_avulso
  for update to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
  );

create policy "cobranca_avulsa select" on apticket.tickets_cobranca_avulsa
  for select to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and (
      apticket.has_permission(auth.uid(), 'financeiro', 'view')
      or apticket.has_permission(auth.uid(), 'tickets', 'view')
    )
  );
create policy "cobranca_avulsa update" on apticket.tickets_cobranca_avulsa
  for update to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'edit')
  );

create policy "cobranca_avulsa_audit select" on apticket.tickets_cobranca_avulsa_audit
  for select to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'financeiro', 'view')
  );

revoke all on function apticket.resolver_atendimento_ticket(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function apticket.classificar_ticket_antes_insert() from public, anon, authenticated;
revoke all on function apticket.criar_cobranca_ticket_avulso(uuid) from public, anon, authenticated;
revoke all on function apticket.criar_cobranca_ticket_avulso_trigger() from public, anon, authenticated;
revoke all on function apticket.proteger_classificacao_ticket() from public, anon, authenticated;
revoke all on function apticket.validar_equipamento_ticket_avulso() from public, anon, authenticated;
revoke all on function apticket.recalcular_cobranca_avulsa(uuid) from public, anon, authenticated;
revoke all on function apticket.recalcular_cobranca_por_apontamento() from public, anon, authenticated;
revoke all on function apticket.recalcular_cobranca_por_status() from public, anon, authenticated;
revoke all on function apticket.proteger_edicao_cobranca_avulsa() from public, anon, authenticated;
revoke all on function apticket.auditar_cobranca_avulsa() from public, anon, authenticated;
revoke all on function apticket.prever_atendimento_avulso(uuid, uuid[]) from public, anon;
grant execute on function apticket.prever_atendimento_avulso(uuid, uuid[]) to authenticated;
revoke all on function apticket.atualizar_cobrancas_vencidas() from public, anon;
grant execute on function apticket.atualizar_cobrancas_vencidas() to authenticated;

commit;
