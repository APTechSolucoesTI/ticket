-- Atomic contract allocations. Legacy scalar columns remain compatibility mirrors.
-- Percentages are numeric; JSON transport is validated before numeric(5,2) storage.
alter table apticket.contracts add column if not exists category_allocations jsonb,
  add column if not exists cost_center_allocations jsonb;
alter table apticket.supplier_contracts add column if not exists category_allocations jsonb,
  add column if not exists cost_center_allocations jsonb;
alter table apticket.financial_entry_classifications add column if not exists category_allocations jsonb,
  add column if not exists cost_center_allocations jsonb;
create unique index if not exists contracts_allocation_tenant_key on apticket.contracts(id,tenant_id);
create unique index if not exists supplier_contracts_allocation_tenant_key on apticket.supplier_contracts(id,tenant_id);

create table if not exists apticket.contracts_category_allocations (
  contract_id uuid not null,
  tenant_id uuid not null references apticket.tenants(id),
  item_id uuid not null,
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  code text not null, name text not null,
  primary key (contract_id,item_id),
  foreign key (contract_id,tenant_id) references apticket.contracts(id,tenant_id) on delete cascade,
  foreign key (item_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict
);
alter table apticket.contracts_category_allocations enable row level security;
revoke all on apticket.contracts_category_allocations from public,anon,authenticated,service_role;
grant select on apticket.contracts_category_allocations to authenticated,service_role;
drop policy if exists contract_allocation_read on apticket.contracts_category_allocations;
create policy contract_allocation_read on apticket.contracts_category_allocations for select to authenticated using (
  tenant_id=(select apticket.current_tenant_id()) and exists (
    select 1 from apticket.contracts contract where contract.id=contract_id and contract.tenant_id=tenant_id
  )
);
-- Backfill only missing arrays, including inactive historical dimensions.
update apticket.contracts contract set category_allocations=
  jsonb_build_array(jsonb_build_object('item_id',item.id,'percentage',100,'code',item.code,'name',item.name))
from apticket.financial_categories item where item.id=contract.financial_category_id
  and item.tenant_id=contract.tenant_id and contract.category_allocations is null;
insert into apticket.contracts_category_allocations(contract_id,tenant_id,item_id,percentage,code,name)
select contract.id,contract.tenant_id,(item->>'item_id')::uuid,(item->>'percentage')::numeric,
  item->>'code',item->>'name' from apticket.contracts contract
cross join lateral jsonb_array_elements(contract.category_allocations) item
on conflict(contract_id,item_id) do nothing;

create table if not exists apticket.contracts_cost_center_allocations (
  contract_id uuid not null,
  tenant_id uuid not null references apticket.tenants(id),
  item_id uuid not null,
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  code text not null, name text not null,
  primary key (contract_id,item_id),
  foreign key (contract_id,tenant_id) references apticket.contracts(id,tenant_id) on delete cascade,
  foreign key (item_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict
);
alter table apticket.contracts_cost_center_allocations enable row level security;
revoke all on apticket.contracts_cost_center_allocations from public,anon,authenticated,service_role;
grant select on apticket.contracts_cost_center_allocations to authenticated,service_role;
drop policy if exists contract_allocation_read on apticket.contracts_cost_center_allocations;
create policy contract_allocation_read on apticket.contracts_cost_center_allocations for select to authenticated using (
  tenant_id=(select apticket.current_tenant_id()) and exists (
    select 1 from apticket.contracts contract where contract.id=contract_id and contract.tenant_id=tenant_id
  )
);
-- Backfill only missing arrays, including inactive historical dimensions.
update apticket.contracts contract set cost_center_allocations=
  jsonb_build_array(jsonb_build_object('item_id',item.id,'percentage',100,'code',item.code,'name',item.name))
from apticket.financial_cost_centers item where item.id=contract.cost_center_id
  and item.tenant_id=contract.tenant_id and contract.cost_center_allocations is null;
insert into apticket.contracts_cost_center_allocations(contract_id,tenant_id,item_id,percentage,code,name)
select contract.id,contract.tenant_id,(item->>'item_id')::uuid,(item->>'percentage')::numeric,
  item->>'code',item->>'name' from apticket.contracts contract
cross join lateral jsonb_array_elements(contract.cost_center_allocations) item
on conflict(contract_id,item_id) do nothing;

create table if not exists apticket.supplier_contracts_category_allocations (
  contract_id uuid not null,
  tenant_id uuid not null references apticket.tenants(id),
  item_id uuid not null,
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  code text not null, name text not null,
  primary key (contract_id,item_id),
  foreign key (contract_id,tenant_id) references apticket.supplier_contracts(id,tenant_id) on delete cascade,
  foreign key (item_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict
);
alter table apticket.supplier_contracts_category_allocations enable row level security;
revoke all on apticket.supplier_contracts_category_allocations from public,anon,authenticated,service_role;
grant select on apticket.supplier_contracts_category_allocations to authenticated,service_role;
drop policy if exists contract_allocation_read on apticket.supplier_contracts_category_allocations;
create policy contract_allocation_read on apticket.supplier_contracts_category_allocations for select to authenticated using (
  tenant_id=(select apticket.current_tenant_id()) and exists (
    select 1 from apticket.supplier_contracts contract where contract.id=contract_id and contract.tenant_id=tenant_id
  )
);
-- Backfill only missing arrays, including inactive historical dimensions.
update apticket.supplier_contracts contract set category_allocations=
  jsonb_build_array(jsonb_build_object('item_id',item.id,'percentage',100,'code',item.code,'name',item.name))
from apticket.financial_categories item where item.id=contract.financial_category_id
  and item.tenant_id=contract.tenant_id and contract.category_allocations is null;
insert into apticket.supplier_contracts_category_allocations(contract_id,tenant_id,item_id,percentage,code,name)
select contract.id,contract.tenant_id,(item->>'item_id')::uuid,(item->>'percentage')::numeric,
  item->>'code',item->>'name' from apticket.supplier_contracts contract
cross join lateral jsonb_array_elements(contract.category_allocations) item
on conflict(contract_id,item_id) do nothing;

create table if not exists apticket.supplier_contracts_cost_center_allocations (
  contract_id uuid not null,
  tenant_id uuid not null references apticket.tenants(id),
  item_id uuid not null,
  percentage numeric(5,2) not null check (percentage > 0 and percentage <= 100),
  code text not null, name text not null,
  primary key (contract_id,item_id),
  foreign key (contract_id,tenant_id) references apticket.supplier_contracts(id,tenant_id) on delete cascade,
  foreign key (item_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict
);
alter table apticket.supplier_contracts_cost_center_allocations enable row level security;
revoke all on apticket.supplier_contracts_cost_center_allocations from public,anon,authenticated,service_role;
grant select on apticket.supplier_contracts_cost_center_allocations to authenticated,service_role;
drop policy if exists contract_allocation_read on apticket.supplier_contracts_cost_center_allocations;
create policy contract_allocation_read on apticket.supplier_contracts_cost_center_allocations for select to authenticated using (
  tenant_id=(select apticket.current_tenant_id()) and exists (
    select 1 from apticket.supplier_contracts contract where contract.id=contract_id and contract.tenant_id=tenant_id
  )
);
-- Backfill only missing arrays, including inactive historical dimensions.
update apticket.supplier_contracts contract set cost_center_allocations=
  jsonb_build_array(jsonb_build_object('item_id',item.id,'percentage',100,'code',item.code,'name',item.name))
from apticket.financial_cost_centers item where item.id=contract.cost_center_id
  and item.tenant_id=contract.tenant_id and contract.cost_center_allocations is null;
insert into apticket.supplier_contracts_cost_center_allocations(contract_id,tenant_id,item_id,percentage,code,name)
select contract.id,contract.tenant_id,(item->>'item_id')::uuid,(item->>'percentage')::numeric,
  item->>'code',item->>'name' from apticket.supplier_contracts contract
cross join lateral jsonb_array_elements(contract.cost_center_allocations) item
on conflict(contract_id,item_id) do nothing;

do $$ declare t text; begin
  foreach t in array array['contracts_category_allocations','contracts_cost_center_allocations',
    'supplier_contracts_category_allocations','supplier_contracts_cost_center_allocations'] loop
    execute format('create index if not exists %I on apticket.%I(item_id,tenant_id)',t||'_item_idx',t);
    execute format('create index if not exists %I on apticket.%I(tenant_id,contract_id)',t||'_tenant_idx',t);
  end loop;
end $$;

create or replace function apticket_finance_private.normalize_contract_allocation(
  p_items jsonb,p_dimension text,p_tenant uuid,p_company uuid,p_direction text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare item jsonb; result jsonb:='[]'; total numeric:=0; pct numeric; item_id uuid;
  item_code text; item_name text; seen uuid[]:='{}'; label text;
begin
  label:=case p_dimension when 'category' then 'categorias financeiras' else 'centros de custo' end;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception using errcode='23514',message='Informe ao menos um item no rateio de '||label||'.';
  end if;
  if jsonb_array_length(p_items)=0 then
    raise exception using errcode='23514',message='Informe ao menos um item no rateio de '||label||'.';
  end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'item_id' loop
    if jsonb_typeof(item)<>'object' or coalesce(item->>'percentage','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
      or coalesce(item->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='23514',message='Selecione um item e informe um percentual com no máximo 2 casas decimais.';
    end if;
    pct:=(item->>'percentage')::numeric; item_id:=(item->>'item_id')::uuid;
    if pct<=0 or pct>100 then
      raise exception using errcode='23514',message='O percentual deve ser maior que 0 e menor ou igual a 100.';
    end if;
    if item_id=any(seen) then
      raise exception using errcode='23514',message='Não repita o mesmo item no rateio de '||label||'.';
    end if;
    seen:=array_append(seen,item_id);
    if p_dimension='category' then
      select code,name into item_code,item_name from apticket.financial_categories
      where id=item_id and tenant_id=p_tenant and (operating_company_id=p_company or is_global)
        and is_active and deleted_at is null and classification_type='analytic'
        and direction in (p_direction,'both') for share;
    else
      select code,name into item_code,item_name from apticket.financial_cost_centers
      where id=item_id and tenant_id=p_tenant and (operating_company_id=p_company or is_global)
        and is_active and deleted_at is null and classification_type='analytic' for share;
    end if;
    if not found then
      raise exception using errcode='23514',message='Selecione um item analítico ativo e compatível com a empresa no rateio de '||label||'.';
    end if;
    total:=total+pct;
    result:=result||jsonb_build_array(jsonb_build_object('item_id',item_id,'percentage',pct,'code',item_code,'name',item_name));
  end loop;
  if total<>100 then
    raise exception using errcode='23514',message='A soma dos percentuais de '||label||' deve ser 100% (atual: '||total||'%).';
  end if;
  return result;
end $$;
revoke all on function apticket_finance_private.normalize_contract_allocation(jsonb,text,uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function apticket_finance_private.prepare_contract_allocations()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    -- Suspension/cancellation and archiving must keep working on historical
    -- contracts, including ones whose dimensions were subsequently archived.
    if (new.status is distinct from old.status or new.deleted_at is distinct from old.deleted_at)
      and (to_jsonb(new)-array['status','is_active','deleted_at','updated_at','updated_by'])
        is not distinct from (to_jsonb(old)-array['status','is_active','deleted_at','updated_at','updated_by']) then
      return new;
    end if;
    if auth.uid() is null and old.category_allocations is null and old.cost_center_allocations is null
      and new.category_allocations is null and new.cost_center_allocations is null
      and new.financial_category_id is null and new.cost_center_id is null then
      return new;
    end if;
  end if;
  -- Old API: changed scalar fields replace just the corresponding allocation with 100%.
  if tg_op='INSERT' then
    if new.category_allocations is null and new.financial_category_id is not null then
      new.category_allocations:=jsonb_build_array(jsonb_build_object('item_id',new.financial_category_id,'percentage',100));
    end if;
    if new.cost_center_allocations is null and new.cost_center_id is not null then
      new.cost_center_allocations:=jsonb_build_array(jsonb_build_object('item_id',new.cost_center_id,'percentage',100));
    end if;
  else
    if new.category_allocations is not distinct from old.category_allocations
      and new.financial_category_id is distinct from old.financial_category_id then
      new.category_allocations:=case when new.financial_category_id is null then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object('item_id',new.financial_category_id,'percentage',100)) end;
    end if;
    if new.cost_center_allocations is not distinct from old.cost_center_allocations
      and new.cost_center_id is distinct from old.cost_center_id then
      new.cost_center_allocations:=case when new.cost_center_id is null then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object('item_id',new.cost_center_id,'percentage',100)) end;
    end if;
  end if;
  new.category_allocations:=apticket_finance_private.normalize_contract_allocation(new.category_allocations,'category',new.tenant_id,new.operating_company_id,tg_argv[0]);
  new.cost_center_allocations:=apticket_finance_private.normalize_contract_allocation(new.cost_center_allocations,'cost_center',new.tenant_id,new.operating_company_id,tg_argv[0]);
  select (value->>'item_id')::uuid into new.financial_category_id from jsonb_array_elements(new.category_allocations)
    order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  select (value->>'item_id')::uuid into new.cost_center_id from jsonb_array_elements(new.cost_center_allocations)
    order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  return new;
end $$;
revoke all on function apticket_finance_private.prepare_contract_allocations() from public,anon,authenticated,service_role;

create or replace function apticket_finance_private.sync_contract_allocations()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare dimension text; column_name text; table_name text;
begin
  if tg_op='UPDATE' then
    if row(new.category_allocations,new.cost_center_allocations,new.tenant_id)
      is not distinct from row(old.category_allocations,old.cost_center_allocations,old.tenant_id) then
      return new;
    end if;
  end if;
  foreach dimension in array array['category','cost_center'] loop
    column_name:=dimension||'_allocations'; table_name:=tg_table_name||'_'||column_name;
    execute format('delete from apticket.%I where contract_id=$1',table_name) using new.id;
    execute format('insert into apticket.%I(contract_id,tenant_id,item_id,percentage,code,name)
      select $1,$2,(value->>''item_id'')::uuid,(value->>''percentage'')::numeric,value->>''code'',value->>''name''
      from jsonb_array_elements($3)',table_name) using new.id,new.tenant_id,to_jsonb(new)->column_name;
  end loop;
  return new;
end $$;
revoke all on function apticket_finance_private.sync_contract_allocations() from public,anon,authenticated,service_role;

drop trigger if exists validate_customer_contract_dimensions on apticket.contracts;
drop trigger if exists prepare_contract_allocations on apticket.contracts;
create trigger prepare_contract_allocations before insert or update on apticket.contracts
  for each row execute function apticket_finance_private.prepare_contract_allocations('inflow');
drop trigger if exists sync_contract_allocations on apticket.contracts;
create trigger sync_contract_allocations after insert or update on apticket.contracts
  for each row execute function apticket_finance_private.sync_contract_allocations();

drop trigger if exists validate_supplier_contract_dimensions on apticket.supplier_contracts;
drop trigger if exists prepare_contract_allocations on apticket.supplier_contracts;
create trigger prepare_contract_allocations before insert or update on apticket.supplier_contracts
  for each row execute function apticket_finance_private.prepare_contract_allocations('outflow');
drop trigger if exists sync_contract_allocations on apticket.supplier_contracts;
create trigger sync_contract_allocations after insert or update on apticket.supplier_contracts
  for each row execute function apticket_finance_private.sync_contract_allocations();

-- Customer contracts previously had no audit trigger; retain old/new JSON snapshots.
drop trigger if exists contract_allocation_audit on apticket.contracts;
create trigger contract_allocation_audit after insert or update
  on apticket.contracts for each row execute function apticket_finance_private.audit_record();

create or replace function apticket_finance_private.apply_contract_default_classification()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare row_data jsonb:=to_jsonb(new); categories jsonb; centers jsonb; category jsonb; center jsonb; v_contract_id uuid;
  v_source_type text; v_direction text; v_actor uuid:=auth.uid(); v_actor_name text;
begin
  if tg_table_name='contas_receber' then
    v_contract_id:=nullif(row_data->>'contrato_id','')::uuid;
    select category_allocations,cost_center_allocations into categories,centers from apticket.contracts
      where id=v_contract_id and tenant_id=new.tenant_id;
    v_source_type:=case row_data->>'origin_type' when 'measurement' then 'measurement_receivable'
      when 'manual' then 'manual_receivable' else 'recurring_receivable' end;
    v_direction:='inflow';
  elsif tg_table_name='supplier_payables' then
    v_contract_id:=nullif(row_data->>'supplier_contract_id','')::uuid;
    select category_allocations,cost_center_allocations into categories,centers from apticket.supplier_contracts
      where id=v_contract_id and tenant_id=new.tenant_id;
    v_source_type:='supplier_payable'; v_direction:='outflow';
  else return new; end if;
  -- Grandfather unclassified historical contracts. New/edited contracts cannot be empty.
  if categories is null and centers is null then return new; end if;
  categories:=apticket_finance_private.normalize_contract_allocation(categories,'category',new.tenant_id,new.operating_company_id,v_direction);
  centers:=apticket_finance_private.normalize_contract_allocation(centers,'cost_center',new.tenant_id,new.operating_company_id,v_direction);
  select value into category from jsonb_array_elements(categories) order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  select value into center from jsonb_array_elements(centers) order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  select name into v_actor_name from apticket.profiles where id=v_actor and tenant_id=new.tenant_id and is_active;
  insert into apticket.financial_entry_classifications(tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,
    classified_by,classified_by_name,category_allocations,cost_center_allocations)
  values(new.tenant_id,new.operating_company_id,v_source_type,new.id,v_direction,
    (category->>'item_id')::uuid,category->>'code',category->>'name',
    (center->>'item_id')::uuid,center->>'code',center->>'name',
    case when v_actor_name is null then null else v_actor end,coalesce(v_actor_name,'Sistema'),categories,centers);
  return new;
end $$;

-- Allocate each dimension independently in integer cents. Floor first, assign all
-- residual cents to the highest percentage (tie: UUID). Intersect cumulative cent
-- intervals to produce a joint category/center matrix preserving BOTH marginals.
create or replace function apticket.allocate_financial_amount(p_amount numeric,p_categories jsonb,p_centers jsonb)
returns table(category_id uuid,category_code text,category_name text,center_id uuid,center_code text,center_name text,amount numeric)
language sql immutable security invoker set search_path=pg_catalog as $$
with dimensions as (
  select 'category' dimension,value item from jsonb_array_elements(p_categories)
  union all select 'center',value from jsonb_array_elements(p_centers)
), floors as (
  select *,floor(abs(round(p_amount*100))*((item->>'percentage')::numeric/100)) cents,
    row_number() over(partition by dimension order by (item->>'percentage')::numeric desc,item->>'item_id') priority
  from dimensions
), distributed as (
  select *,cents+case when priority=1 then abs(round(p_amount*100))-sum(cents) over(partition by dimension) else 0 end allocated from floors
), intervals as (
  select *,sum(allocated) over(partition by dimension order by item->>'item_id') finish,
    sum(allocated) over(partition by dimension order by item->>'item_id')-allocated start from distributed
)
select (c.item->>'item_id')::uuid,c.item->>'code',c.item->>'name',
  (s.item->>'item_id')::uuid,s.item->>'code',s.item->>'name',
  sign(p_amount)*greatest(0,least(c.finish,s.finish)-greatest(c.start,s.start))/100
from intervals c cross join intervals s where c.dimension='category' and s.dimension='center';
$$;
revoke all on function apticket.allocate_financial_amount(numeric,jsonb,jsonb) from public,anon;
grant execute on function apticket.allocate_financial_amount(numeric,jsonb,jsonb) to authenticated,service_role;

-- Preserve the existing one-row-per-document API for integrations. Accounting
-- views consume the expanded projection. The cash-flow screen uses it too.
create or replace view apticket.cash_flow_allocation_entries with (security_invoker=true) as
select raw.tenant_id,raw.operating_company_id,raw.direction,raw.source_type,raw.source_id,raw.document_number,
  raw.counterparty_name,raw.description,raw.competence,raw.planned_date,raw.realized_date,
  coalesce(planned.amount,raw.planned_amount)::numeric(14,2) planned_amount,
  coalesce(opened.amount,raw.open_amount)::numeric(14,2) open_amount,
  coalesce(realized.amount,raw.realized_amount)::numeric(14,2) realized_amount,
  raw.cash_status,raw.source_status,raw.reconciliation_status,
  case when raw.difference_amount is null then null else coalesce(difference.amount,raw.difference_amount) end::numeric(14,2) difference_amount,
  raw.created_at,raw.updated_at,raw.classification_id,
  coalesce(planned.category_id,raw.financial_category_id) financial_category_id,
  coalesce(planned.category_code,raw.financial_category_code) financial_category_code,
  coalesce(planned.category_name,raw.financial_category_name) financial_category_name,
  coalesce(planned.center_id,raw.cost_center_id) cost_center_id,
  coalesce(planned.center_code,raw.cost_center_code) cost_center_code,
  coalesce(planned.center_name,raw.cost_center_name) cost_center_name,
  snapshot.category_allocations,snapshot.cost_center_allocations
from apticket.cash_flow_entries raw
left join apticket.financial_entry_classifications snapshot on snapshot.id=raw.classification_id
left join lateral apticket.allocate_financial_amount(raw.planned_amount,snapshot.category_allocations,snapshot.cost_center_allocations) planned on true
left join lateral apticket.allocate_financial_amount(raw.open_amount,snapshot.category_allocations,snapshot.cost_center_allocations) opened
  on opened.category_id=planned.category_id and opened.center_id=planned.center_id
left join lateral apticket.allocate_financial_amount(raw.realized_amount,snapshot.category_allocations,snapshot.cost_center_allocations) realized
  on realized.category_id=planned.category_id and realized.center_id=planned.center_id
left join lateral apticket.allocate_financial_amount(raw.difference_amount,snapshot.category_allocations,snapshot.cost_center_allocations) difference
  on difference.category_id=planned.category_id and difference.center_id=planned.center_id;
revoke all on apticket.cash_flow_allocation_entries from public,anon;
grant select on apticket.cash_flow_allocation_entries to authenticated,service_role;
comment on view apticket.cash_flow_allocation_entries is 'Rateios contábeis por categoria e centro. source_id pode repetir; cash_flow_entries mantém um registro por documento.';
do $$ begin
  execute 'create or replace view apticket.financial_budget_variance with (security_invoker=true) as '||
    replace(pg_get_viewdef('apticket.financial_budget_variance'::regclass,true),'cash_flow_entries','cash_flow_allocation_entries');
end $$;
comment on column apticket.contracts.category_allocations is 'Entrada JSON atômica, validada e sincronizada às tabelas filhas; valores percentuais exatos. Coluna legada espelha maior percentual.';
notify pgrst,'reload schema';
