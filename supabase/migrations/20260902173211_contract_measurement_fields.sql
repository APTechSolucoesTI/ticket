do $$
begin
  create type apticket.tipo_medicao_contrato as enum (
    'mensal',
    'trimestral',
    'semestral',
    'anual',
    'unica'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type apticket.tipo_vencimento_contrato as enum ('fixo', 'util');
exception
  when duplicate_object then null;
end
$$;

grant usage on type apticket.tipo_medicao_contrato, apticket.tipo_vencimento_contrato
  to authenticated, service_role;

create table if not exists apticket.contrato_sequencia (
  tenant_id uuid primary key references apticket.tenants(id) on delete cascade,
  ultimo_numero integer not null default 0 check (ultimo_numero between 0 and 999999)
);

alter table apticket.contrato_sequencia enable row level security;

revoke all on table apticket.contrato_sequencia from public, anon, authenticated;
grant all on table apticket.contrato_sequencia to service_role;

alter table apticket.contracts
  add column if not exists numero_contrato text,
  add column if not exists tipo_medicao apticket.tipo_medicao_contrato not null default 'mensal',
  add column if not exists emite_nf boolean not null default false,
  add column if not exists emite_boleto boolean not null default false,
  add column if not exists tipo_vencimento apticket.tipo_vencimento_contrato not null default 'fixo',
  add column if not exists dia_vencimento smallint not null default 1;

with ranked as (
  select
    id,
    row_number() over (partition by tenant_id order by created_at, id) as numero,
    extract(year from created_at)::integer as ano
  from apticket.contracts
  where numero_contrato is null
)
update apticket.contracts as contract
set numero_contrato = lpad(ranked.numero::text, 6, '0') || '/' || ranked.ano::text
from ranked
where ranked.id = contract.id;

insert into apticket.contrato_sequencia (tenant_id, ultimo_numero)
select tenant_id, count(*)::integer
from apticket.contracts
group by tenant_id
on conflict (tenant_id)
do update set ultimo_numero = greatest(
  apticket.contrato_sequencia.ultimo_numero,
  excluded.ultimo_numero
);

alter table apticket.contracts
  alter column numero_contrato set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'apticket.contracts'::regclass
      and conname = 'contracts_numero_contrato_format_check'
  ) then
    alter table apticket.contracts
      add constraint contracts_numero_contrato_format_check
      check (numero_contrato ~ '^[0-9]{6}/[0-9]{4}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'apticket.contracts'::regclass
      and conname = 'contracts_dia_vencimento_check'
  ) then
    alter table apticket.contracts
      add constraint contracts_dia_vencimento_check
      check (dia_vencimento between 1 and 30);
  end if;
end
$$;

create unique index if not exists contracts_tenant_numero_contrato_uidx
  on apticket.contracts (tenant_id, numero_contrato);

create or replace function apticket.gerar_numero_contrato(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
declare
  v_numero integer;
begin
  if p_tenant_id is null then
    raise exception using errcode = '22004', message = 'Tenant do contrato não informado.';
  end if;

  insert into apticket.contrato_sequencia (tenant_id, ultimo_numero)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set ultimo_numero = apticket.contrato_sequencia.ultimo_numero + 1
  returning ultimo_numero into v_numero;

  if v_numero > 999999 then
    raise exception using errcode = '22003', message = 'Limite de numeração de contratos atingido para o tenant.';
  end if;

  return lpad(v_numero::text, 6, '0') || '/' || to_char(current_date, 'YYYY');
end
$$;

revoke all on function apticket.gerar_numero_contrato(uuid) from public, anon, authenticated;
grant execute on function apticket.gerar_numero_contrato(uuid) to service_role;

create or replace function apticket.preencher_numero_contrato()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, apticket
as $$
begin
  if new.numero_contrato is null or btrim(new.numero_contrato) = '' then
    new.numero_contrato := apticket.gerar_numero_contrato(new.tenant_id);
  end if;
  return new;
end
$$;

revoke all on function apticket.preencher_numero_contrato() from public, anon, authenticated;

drop trigger if exists contracts_preencher_numero_contrato on apticket.contracts;
create trigger contracts_preencher_numero_contrato
before insert on apticket.contracts
for each row execute function apticket.preencher_numero_contrato();

create or replace function apticket.proteger_numero_contrato()
returns trigger
language plpgsql
set search_path = pg_catalog, apticket
as $$
begin
  if new.numero_contrato is distinct from old.numero_contrato then
    raise exception using errcode = '22023', message = 'O número do contrato não pode ser alterado.';
  end if;
  return new;
end
$$;

revoke all on function apticket.proteger_numero_contrato() from public, anon;
grant execute on function apticket.proteger_numero_contrato() to authenticated, service_role;

drop trigger if exists contracts_proteger_numero_contrato on apticket.contracts;
create trigger contracts_proteger_numero_contrato
before update of numero_contrato on apticket.contracts
for each row execute function apticket.proteger_numero_contrato();
