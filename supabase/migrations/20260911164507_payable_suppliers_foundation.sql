-- Fatia 17: fundacao de contas a pagar, fornecedores e contratos de fornecimento.
create table apticket.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  legal_name text not null check (length(btrim(legal_name)) between 2 and 250),
  trade_name text check (trade_name is null or length(btrim(trade_name)) between 1 and 250),
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{11}([0-9]{3})?$'),
  category text not null check (category in ('software_licensing','datacenter','connectivity','professional_services','other')),
  contact_name text check (contact_name is null or length(btrim(contact_name)) between 1 and 150),
  email text check (email is null or length(btrim(email)) between 3 and 254),
  phone text check (phone is null or length(btrim(phone)) between 8 and 30),
  notes text check (notes is null or length(notes)<=4000),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  foreign key (operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index suppliers_tax_id_key on apticket.suppliers(tenant_id,operating_company_id,tax_id)
  where tax_id is not null and deleted_at is null;
create index suppliers_scope_idx on apticket.suppliers(tenant_id,operating_company_id,legal_name)
  where deleted_at is null;

create table apticket.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_id uuid not null,
  description text not null check (length(btrim(description)) between 2 and 250),
  billing_unit text not null check (billing_unit in ('fixed','active_users','devices')),
  billing_interval_months smallint not null default 1 check (billing_interval_months in (1,3,6,12)),
  base_amount numeric(14,2) not null default 0 check (base_amount>=0),
  unit_price numeric(14,4) not null default 0 check (unit_price>=0),
  due_day smallint not null check (due_day between 1 and 31),
  starts_at date not null,
  ends_at date,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes)<=4000),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  foreign key (supplier_id,tenant_id,operating_company_id)
    references apticket.suppliers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  constraint supplier_contract_dates_check check (ends_at is null or ends_at>=starts_at),
  constraint supplier_contract_price_check check (
    (billing_unit='fixed' and base_amount>0 and unit_price=0)
    or (billing_unit<>'fixed' and unit_price>0)
  )
);
create index supplier_contracts_supplier_idx on apticket.supplier_contracts(supplier_id,starts_at desc)
  where deleted_at is null;
create index supplier_contracts_scope_idx on apticket.supplier_contracts(tenant_id,operating_company_id,is_active)
  where deleted_at is null;

do $$ declare t text; begin
  foreach t in array array['suppliers','supplier_contracts'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select,insert,update on apticket.%I to authenticated',t);
    execute format('grant select,insert,update on apticket.%I to service_role',t);
    execute format('create policy payable_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create policy payable_insert on apticket.%I for insert to authenticated with check
      (deleted_at is null and apticket.has_financial_scope(tenant_id,operating_company_id,true))',t);
    execute format('create policy payable_update on apticket.%I for update to authenticated using
      (deleted_at is null and apticket.has_financial_scope(tenant_id,operating_company_id,true)) with check
      (apticket.has_financial_scope(tenant_id,operating_company_id,true))',t);
    execute format('create trigger payable_guard_delete before delete on apticket.%I
      for each row execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger payable_guard_truncate before truncate on apticket.%I
      for each statement execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger payable_audit after insert or update on apticket.%I
      for each row execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create function apticket_finance_private.prepare_supplier()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then
    if new.tenant_id is distinct from apticket.current_tenant_id() then
      raise exception using errcode='42501',message='O fornecedor deve pertencer a tenant ativa.';
    end if;
    new.created_by:=v_actor; new.created_at:=clock_timestamp();
  elsif new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.operating_company_id is distinct from old.operating_company_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='A identidade e a empresa do fornecedor nao podem ser alteradas.';
  elsif old.deleted_at is not null then
    raise exception using errcode='23514',message='Um fornecedor arquivado nao pode ser alterado.';
  end if;
  if tg_op='UPDATE' and old.deleted_at is null and new.deleted_at is not null
     and exists(select 1 from apticket.supplier_contracts c
       where c.supplier_id=old.id and c.deleted_at is null and c.is_active) then
    raise exception using errcode='23514',message='Arquive os contratos ativos antes de arquivar o fornecedor.';
  end if;
  new.legal_name:=btrim(new.legal_name);
  new.trade_name:=nullif(btrim(new.trade_name),'');
  new.tax_id:=nullif(regexp_replace(coalesce(new.tax_id,''),'[^0-9]','','g'),'');
  new.contact_name:=nullif(btrim(new.contact_name),'');
  new.email:=nullif(lower(btrim(new.email)),'');
  new.phone:=nullif(btrim(new.phone),'');
  new.notes:=nullif(btrim(new.notes),'');
  new.updated_by:=v_actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

create function apticket_finance_private.prepare_supplier_contract()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then
    if new.tenant_id is distinct from apticket.current_tenant_id() then
      raise exception using errcode='42501',message='O contrato deve pertencer a tenant ativa.';
    end if;
    new.created_by:=v_actor; new.created_at:=clock_timestamp();
  elsif new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.operating_company_id is distinct from old.operating_company_id
     or new.supplier_id is distinct from old.supplier_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='A identidade e os vinculos do contrato nao podem ser alterados.';
  elsif old.deleted_at is not null then
    raise exception using errcode='23514',message='Um contrato arquivado nao pode ser alterado.';
  end if;
  new.description:=btrim(new.description);
  new.notes:=nullif(btrim(new.notes),'');
  new.updated_by:=v_actor; new.updated_at:=clock_timestamp();
  return new;
end $$;

create trigger prepare_supplier before insert or update on apticket.suppliers
  for each row execute function apticket_finance_private.prepare_supplier();
create trigger prepare_supplier_contract before insert or update on apticket.supplier_contracts
  for each row execute function apticket_finance_private.prepare_supplier_contract();
revoke all on function apticket_finance_private.prepare_supplier(),
  apticket_finance_private.prepare_supplier_contract()
  from public,anon,authenticated,service_role;

comment on table apticket.suppliers is 'Fornecedores de contas a pagar, isolados por empresa operadora.';
comment on table apticket.supplier_contracts is 'Contratos recorrentes de fornecimento; a unidade sera reutilizada no rateio por consumo.';
notify pgrst,'reload schema';
