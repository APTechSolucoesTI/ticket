-- Fatia 1: fundação financeira. Não altera o motor de medição ou faturas atuais.
-- A transação é controlada pelo executor da migration.
create schema if not exists apticket_finance_private;
revoke all on schema apticket_finance_private from public, anon, authenticated;

alter table apticket.contracts
  add constraint contracts_finance_id_tenant_key unique (id, tenant_id);

create table apticket.operating_companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  legal_name text not null check (length(btrim(legal_name)) between 1 and 250),
  tax_id text check (tax_id ~ '^[0-9]{14}$'),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, tenant_id)
);
create unique index operating_companies_tax_key
  on apticket.operating_companies(tenant_id, tax_id) where deleted_at is null;

-- NULL operating_company_id representa acesso explícito ao grupo, nunca implícito pelo perfil Admin.
-- Provisionamento/revogação somente no backend confiável nesta fatia.
create table apticket.financial_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  user_id uuid not null,
  operating_company_id uuid,
  can_write boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (user_id, tenant_id) references apticket.profiles(id, tenant_id) on delete restrict,
  foreign key (operating_company_id, tenant_id) references apticket.operating_companies(id, tenant_id) on delete restrict
);
create unique index financial_access_company_key
  on apticket.financial_access(tenant_id, user_id, operating_company_id)
  where operating_company_id is not null and deleted_at is null;
create unique index financial_access_group_key
  on apticket.financial_access(tenant_id, user_id)
  where operating_company_id is null and deleted_at is null;

-- Extensão 1:1 do contrato existente. Vigência, cliente e vencimento continuam em contracts.
create table apticket.contract_financial_terms (
  contract_id uuid primary key,
  tenant_id uuid not null,
  operating_company_id uuid not null,
  billing_interval_months smallint not null default 1 check (billing_interval_months between 1 and 12),
  cutoff_day smallint not null default 1 check (cutoff_day between 1 and 31),
  adjustment_index text not null default 'fixed' check (adjustment_index in ('IGP-M', 'IPCA', 'INPC', 'fixed')),
  adjustment_interval_months smallint not null default 12 check (adjustment_interval_months between 1 and 120),
  adjustment_base_date date not null,
  adjustment_notice_days smallint not null default 30 check (adjustment_notice_days between 0 and 365),
  adjustment_percentage numeric(12,6) check (adjustment_percentage > -100 and adjustment_percentage <= 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (contract_id, tenant_id, operating_company_id),
  foreign key (contract_id, tenant_id) references apticket.contracts(id, tenant_id) on delete restrict,
  foreign key (operating_company_id, tenant_id) references apticket.operating_companies(id, tenant_id) on delete restrict
);

create table apticket.contract_value_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  contract_id uuid not null,
  effective_from date not null,
  base_amount numeric(18,2) not null check (base_amount >= 0 and base_amount < 10000000000000000),
  adjustment_index text check (adjustment_index in ('IGP-M', 'IPCA', 'INPC', 'fixed')),
  applied_percentage numeric(12,6) check (applied_percentage > -100 and applied_percentage <= 1000),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (contract_id, effective_from),
  unique (id, contract_id, tenant_id, operating_company_id),
  check ((adjustment_index is null) = (applied_percentage is null)),
  foreign key (contract_id, tenant_id, operating_company_id)
    references apticket.contract_financial_terms(contract_id, tenant_id, operating_company_id) on delete restrict,
  foreign key (created_by, tenant_id) references apticket.profiles(id, tenant_id) on delete restrict
);

-- Uma linha imutável por contrato/ciclo/métrica, compartilhada por AR e AP.
-- source_items guarda a evidência apurada, não uma consulta viva às origens.
create table apticket.consumption_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  contract_id uuid not null,
  value_version_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  metric text not null check (metric in ('active_users', 'devices', 'excess_tickets', 'technical_hours')),
  measured_quantity numeric(18,6) not null check (measured_quantity >= 0 and measured_quantity < 1000000000000),
  included_quantity numeric(18,6) not null default 0 check (included_quantity >= 0 and included_quantity < 1000000000000),
  billable_quantity numeric(18,6) generated always as (greatest(measured_quantity - included_quantity, 0)) stored,
  unit_price numeric(18,6) not null check (unit_price >= 0 and unit_price < 1000000000000),
  source_type text not null check (length(btrim(source_type)) between 1 and 100),
  source_items jsonb not null check (jsonb_typeof(source_items) = 'array'),
  created_by uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (cycle_end > cycle_start), -- limite final exclusivo
  unique (contract_id, cycle_start, cycle_end, metric),
  foreign key (value_version_id, contract_id, tenant_id, operating_company_id)
    references apticket.contract_value_versions(id, contract_id, tenant_id, operating_company_id) on delete restrict,
  foreign key (created_by, tenant_id) references apticket.profiles(id, tenant_id) on delete restrict
);

create table apticket.financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  operating_company_id uuid,
  entity_table text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('INSERT', 'UPDATE')),
  actor_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  source text not null,
  database_role text not null,
  before_data jsonb,
  after_data jsonb not null,
  foreign key (operating_company_id, tenant_id) references apticket.operating_companies(id, tenant_id) on delete restrict
);

-- Consulta invoker: lê somente as concessões do próprio usuário via RLS, sem bypass.
create function apticket.has_financial_scope(_tenant_id uuid, _company_id uuid, _write boolean default false)
returns boolean language sql stable security invoker set search_path = pg_catalog
as $$
  select _tenant_id = (select apticket.current_tenant_id())
    and (select apticket.has_permission(auth.uid(), 'financeiro', 'view'))
    and (not _write or (select apticket.has_permission(auth.uid(), 'financeiro', 'edit')))
    and exists (
      select 1 from apticket.financial_access a
      where a.tenant_id = _tenant_id and a.user_id = (select auth.uid())
        and a.deleted_at is null and (not _write or a.can_write)
        and (a.operating_company_id is null or a.operating_company_id = _company_id)
    );
$$;
revoke all on function apticket.has_financial_scope(uuid, uuid, boolean) from public, anon;
grant execute on function apticket.has_financial_scope(uuid, uuid, boolean) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['operating_companies', 'financial_access', 'contract_financial_terms',
    'contract_value_versions', 'consumption_snapshots', 'financial_audit_log'] loop
    execute format('alter table apticket.%I enable row level security', t);
    execute format('revoke all on apticket.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on apticket.%I to authenticated, service_role', t);
  end loop;
end $$;

create policy own_financial_access on apticket.financial_access for select to authenticated
  using (tenant_id = (select apticket.current_tenant_id()) and user_id = (select auth.uid()));
create policy scoped_companies_read on apticket.operating_companies for select to authenticated
  using (apticket.has_financial_scope(tenant_id, id));
create policy scoped_companies_insert on apticket.operating_companies for insert to authenticated
  with check (apticket.has_financial_scope(tenant_id, null, true));
create policy scoped_companies_update on apticket.operating_companies for update to authenticated
  using (apticket.has_financial_scope(tenant_id, id, true))
  with check (apticket.has_financial_scope(tenant_id, id, true));

do $$
declare t text;
begin
  foreach t in array array['contract_financial_terms', 'contract_value_versions', 'consumption_snapshots', 'financial_audit_log'] loop
    execute format('create policy financial_scoped_read on apticket.%I for select to authenticated
      using (apticket.has_financial_scope(tenant_id, operating_company_id))', t);
  end loop;
  foreach t in array array['contract_financial_terms', 'contract_value_versions'] loop
    execute format('create policy financial_scoped_insert on apticket.%I for insert to authenticated
      with check (apticket.has_financial_scope(tenant_id, operating_company_id, true)
      and exists (select 1 from apticket.operating_companies c
        where c.id = operating_company_id and c.deleted_at is null))', t);
  end loop;
end $$;
create policy financial_terms_update on apticket.contract_financial_terms for update to authenticated
  using (apticket.has_financial_scope(tenant_id, operating_company_id, true))
  with check (apticket.has_financial_scope(tenant_id, operating_company_id, true));

grant insert, update on apticket.operating_companies, apticket.contract_financial_terms to authenticated, service_role;
grant insert on apticket.contract_value_versions to authenticated, service_role;
grant insert, update on apticket.financial_access to service_role;
grant insert on apticket.consumption_snapshots to service_role;
-- Histórico não pode ser reescrito. Exclusão lógica preserva integralmente o conteúdo.
grant update (deleted_at) on apticket.contract_value_versions, apticket.consumption_snapshots to service_role;

create function apticket_finance_private.guard_record()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '23514', message = 'Dados financeiros não permitem exclusão física. Utilize exclusão lógica.';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'financial_audit_log' then
      raise exception using errcode = '23514', message = 'A auditoria financeira é imutável.';
    end if;
    -- Coluna generated ainda não foi calculada no BEFORE UPDATE.
    if (to_jsonb(new) - array['deleted_at', 'billable_quantity']) is distinct from (to_jsonb(old) - array['deleted_at', 'billable_quantity'])
       and tg_table_name in ('contract_value_versions', 'consumption_snapshots') then
      raise exception using errcode = '23514', message = 'Histórico financeiro e snapshots são imutáveis. Gere um novo registro.';
    end if;
    if new.tenant_id is distinct from old.tenant_id
       or (to_jsonb(new)->'id') is distinct from (to_jsonb(old)->'id')
       or (to_jsonb(new)->'contract_id') is distinct from (to_jsonb(old)->'contract_id')
       or (to_jsonb(new)->'operating_company_id') is distinct from (to_jsonb(old)->'operating_company_id')
       or (to_jsonb(new)->'user_id') is distinct from (to_jsonb(old)->'user_id')
       or (to_jsonb(new)->'created_at') is distinct from (to_jsonb(old)->'created_at') then
      raise exception using errcode = '23514', message = 'Identidade, empresa e tenant do registro financeiro não podem ser alterados.';
    end if;
  end if;
  return new;
end;
$$;

create function apticket_finance_private.validate_version()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
declare previous apticket.contract_value_versions; contract_start date;
begin
  -- Serializa versões concorrentes do mesmo contrato.
  perform 1 from apticket.contract_financial_terms f
    where f.contract_id = new.contract_id and f.deleted_at is null for update;
  if not found then
    raise exception using errcode = '23514', message = 'Contrato financeiro inexistente, excluído ou sem acesso.';
  end if;
  select c.starts_at into contract_start from apticket.contracts c where c.id = new.contract_id;
  if new.effective_from < contract_start then
    raise exception using errcode = '23514', message = 'A vigência do valor não pode anteceder o contrato.';
  end if;
  select * into previous from apticket.contract_value_versions v
    where v.contract_id = new.contract_id order by effective_from desc limit 1;
  if found then
    if new.effective_from <= previous.effective_from then
      raise exception using errcode = '23514', message = 'Uma nova versão deve ter vigência posterior à última versão.';
    end if;
    if new.applied_percentage is not null
       and new.base_amount <> round(previous.base_amount * (1 + new.applied_percentage / 100), 2) then
      raise exception using errcode = '23514', message = 'O valor reajustado não corresponde ao percentual aplicado.';
    end if;
  elsif new.applied_percentage is not null then
    raise exception using errcode = '23514', message = 'Cadastre o valor inicial antes de aplicar um reajuste.';
  end if;
  if exists (select 1 from apticket.consumption_snapshots s
    where s.contract_id = new.contract_id and s.cycle_end > new.effective_from) then
    raise exception using errcode = '23514', message = 'A nova vigência não pode alterar um ciclo já apurado.';
  end if;
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger validate_contract_value before insert on apticket.contract_value_versions
  for each row execute function apticket_finance_private.validate_version();

create function apticket_finance_private.validate_snapshot()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  perform 1 from apticket.contract_financial_terms f
    where f.contract_id = new.contract_id and f.deleted_at is null for update;
  if not found then
    raise exception using errcode = '23514', message = 'Contrato financeiro inexistente ou excluído.';
  end if;
  if not exists (select 1 from apticket.contract_value_versions v
    where v.id = new.value_version_id and v.contract_id = new.contract_id
      and v.deleted_at is null and v.effective_from <= new.cycle_start)
    or exists (select 1 from apticket.contract_value_versions v
      where v.contract_id = new.contract_id and v.deleted_at is null
        and v.effective_from > (select effective_from from apticket.contract_value_versions where id = new.value_version_id)
        and v.effective_from < new.cycle_end) then
    raise exception using errcode = '23514', message = 'Use o valor vigente e divida o ciclo quando houver reajuste no período.';
  end if;
  if exists (select 1 from apticket.consumption_snapshots s where s.contract_id = new.contract_id
    and s.metric = new.metric and s.cycle_start < new.cycle_end and s.cycle_end > new.cycle_start) then
    raise exception using errcode = '23514', message = 'Já existe apuração desta métrica em um período sobreposto.';
  end if;
  if exists (select 1 from jsonb_array_elements(new.source_items) item where jsonb_typeof(item) <> 'object') then
    raise exception using errcode = '23514', message = 'Cada evidência de consumo deve ser um objeto JSON.';
  end if;
  new.created_by := auth.uid();
  new.created_at := clock_timestamp();
  return new;
end;
$$;
create trigger validate_consumption_snapshot before insert on apticket.consumption_snapshots
  for each row execute function apticket_finance_private.validate_snapshot();

-- Único definer: grava auditoria inacessível para escrita direta pelo cliente.
-- Trigger privado, sem argumento SQL, sem endpoint RPC e com search_path fixo.
create function apticket_finance_private.audit_record()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $$
declare data jsonb := to_jsonb(new);
begin
  insert into apticket.financial_audit_log (
    tenant_id, operating_company_id, entity_table, entity_id, operation,
    actor_id, source, database_role, before_data, after_data
  ) values (
    new.tenant_id,
    case when tg_table_name = 'operating_companies' then (data->>'id')::uuid else (data->>'operating_company_id')::uuid end,
    tg_table_name, coalesce((data->>'id')::uuid, (data->>'contract_id')::uuid), tg_op,
    auth.uid(), case when auth.uid() is null then 'database_or_job' else 'authenticated_request' end,
    current_setting('role'), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, data
  );
  return new;
end;
$$;
revoke all on all functions in schema apticket_finance_private from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['operating_companies', 'financial_access', 'contract_financial_terms',
    'contract_value_versions', 'consumption_snapshots', 'financial_audit_log'] loop
    execute format('create trigger guard_financial_record before update or delete on apticket.%I
      for each row execute function apticket_finance_private.guard_record()', t);
    execute format('create trigger guard_financial_truncate before truncate on apticket.%I
      for each statement execute function apticket_finance_private.guard_record()', t);
    if t <> 'financial_audit_log' then
      execute format('create trigger audit_financial_record after insert or update on apticket.%I
        for each row execute function apticket_finance_private.audit_record()', t);
    end if;
  end loop;
end $$;

create index contract_financial_terms_scope on apticket.contract_financial_terms(tenant_id, operating_company_id);
create index contract_value_versions_scope on apticket.contract_value_versions(tenant_id, operating_company_id);
create index consumption_snapshots_scope on apticket.consumption_snapshots(tenant_id, operating_company_id, cycle_start);
create index financial_audit_log_scope on apticket.financial_audit_log(tenant_id, operating_company_id, occurred_at desc);

-- Intervalos derivados: inserir reajuste não faz UPDATE na versão anterior.
create view apticket.contract_value_periods with (security_invoker = true) as
  select v.*, lead(effective_from) over (partition by contract_id order by effective_from) as effective_until
  from apticket.contract_value_versions v where deleted_at is null;
revoke all on apticket.contract_value_periods from public, anon, authenticated, service_role;
grant select on apticket.contract_value_periods to authenticated, service_role;

comment on table apticket.operating_companies is 'Empresas operadoras do MSP dentro do tenant; não confundir com companies (clientes).';
comment on table apticket.consumption_snapshots is 'Fonte única imutável para faturamento variável AR e rateio AP. Ciclo [início, fim). Gravação exclusiva pelo backend.';
comment on table apticket.contract_financial_terms is 'Extensão financeira opt-in 1:1. Não ativa faturamento automático nem substitui o motor de contratos existente.';
notify pgrst, 'reload schema';
