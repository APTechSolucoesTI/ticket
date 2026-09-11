-- Fatia 18: lancamentos recorrentes de fornecedores e rateio por consumo.
create table apticket.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_id uuid not null,
  supplier_contract_id uuid not null,
  document_number text not null check (length(btrim(document_number)) between 5 and 80),
  description text not null check (length(btrim(description)) between 2 and 500),
  cycle_start date not null,
  cycle_end date not null,
  due_date date not null,
  billing_unit text not null check (billing_unit in ('fixed','active_users','devices')),
  measured_quantity numeric(18,6) not null default 0 check (measured_quantity >= 0),
  unit_price numeric(18,6) not null default 0 check (unit_price >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  allocation_status text not null check (allocation_status in ('pending_rule','complete')),
  status text not null default 'scheduled'
    check (status in ('scheduled','awaiting_approval','approved','paid','overdue','cancelled')),
  terms_snapshot jsonb not null check (jsonb_typeof(terms_snapshot)='object'),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check (cycle_end > cycle_start),
  unique (supplier_contract_id,cycle_start),
  unique (document_number,tenant_id,operating_company_id),
  unique (id,tenant_id,operating_company_id),
  foreign key (supplier_id,tenant_id,operating_company_id)
    references apticket.suppliers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (supplier_contract_id,tenant_id,operating_company_id)
    references apticket.supplier_contracts(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);

create table apticket.supplier_payable_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_payable_id uuid not null,
  customer_contract_id uuid not null,
  consumption_snapshot_id uuid not null,
  customer_name text not null check (length(btrim(customer_name)) between 1 and 250),
  contract_number text not null check (length(btrim(contract_number)) between 1 and 80),
  metric text not null check (metric in ('active_users','devices')),
  quantity numeric(18,6) not null check (quantity >= 0),
  unit_price numeric(18,6) not null check (unit_price >= 0),
  amount numeric(14,2) generated always as (round(quantity*unit_price,2)) stored,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot)='object'),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (supplier_payable_id,consumption_snapshot_id),
  foreign key (supplier_payable_id,tenant_id,operating_company_id)
    references apticket.supplier_payables(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (customer_contract_id,tenant_id,operating_company_id)
    references apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id) on delete restrict,
  foreign key (consumption_snapshot_id,customer_contract_id,tenant_id,operating_company_id)
    references apticket.consumption_snapshots(id,contract_id,tenant_id,operating_company_id) on delete restrict
);

create index supplier_payables_scope_idx
  on apticket.supplier_payables(tenant_id,operating_company_id,due_date,status)
  where deleted_at is null;
create index supplier_payable_allocations_contract_idx
  on apticket.supplier_payable_allocations(customer_contract_id,supplier_payable_id)
  where deleted_at is null;

do $$ declare t text; begin
  foreach t in array array['supplier_payables','supplier_payable_allocations'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy payable_cycle_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger payable_cycle_no_delete before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger payable_cycle_no_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger payable_cycle_audit after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create function apticket_finance_private.guard_supplier_payable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-'deleted_at' is distinct from to_jsonb(old)-'deleted_at' then
    raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
  end if;
  return new;
end $$;
create trigger guard_supplier_payable before update on apticket.supplier_payables
  for each row execute function apticket_finance_private.guard_supplier_payable();
create trigger guard_supplier_payable_allocation before update on apticket.supplier_payable_allocations
  for each row execute function apticket_finance_private.guard_supplier_payable();

create function apticket_finance_private.protect_supplier_payable_sources()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='supplier_contracts' then
    if row(new.billing_unit,new.billing_interval_months,new.base_amount,new.unit_price,new.due_day,new.starts_at)
      is distinct from
      row(old.billing_unit,old.billing_interval_months,old.base_amount,old.unit_price,old.due_day,old.starts_at)
      and exists(select 1 from apticket.supplier_payables p
        where p.supplier_contract_id=old.id and p.deleted_at is null) then
      raise exception using errcode='23514',message='As condicoes de um contrato com lancamentos gerados nao podem ser alteradas.';
    end if;
  elsif new.deleted_at is distinct from old.deleted_at
    and exists(select 1 from apticket.supplier_payable_allocations a
      where a.consumption_snapshot_id=old.id and a.deleted_at is null) then
    raise exception using errcode='23514',message='Um consumo utilizado no rateio nao pode ser arquivado.';
  end if;
  return new;
end $$;
create trigger protect_supplier_contract_payables before update on apticket.supplier_contracts
  for each row execute function apticket_finance_private.protect_supplier_payable_sources();
create trigger protect_supplier_payable_consumption before update on apticket.consumption_snapshots
  for each row execute function apticket_finance_private.protect_supplier_payable_sources();

create function apticket.generate_supplier_payable(
  p_supplier_contract_id uuid,
  p_competence date default current_date
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  c apticket.supplier_contracts;
  s apticket.suppliers;
  v_actor uuid:=auth.uid();
  v_role text:=coalesce(current_setting('request.jwt.claim.role',true),'');
  v_competence date:=date_trunc('month',coalesce(p_competence,current_date))::date;
  v_anchor date;
  v_start date;
  v_end date;
  v_due date;
  v_id uuid;
  v_total numeric(14,2);
  v_quantity numeric(18,6);
  v_count integer;
begin
  if p_supplier_contract_id is null then
    raise exception using errcode='22023',message='Informe o contrato do fornecedor.';
  end if;
  select * into c from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null for update;
  if not found or not c.is_active then
    raise exception using errcode='P0002',message='Contrato de fornecedor ativo nao encontrado.';
  end if;
  if v_role<>'service_role' and (v_actor is null
    or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true)) then
    raise exception using errcode='42501',message='Sem permissao financeira para gerar o lancamento.';
  end if;
  select * into s from apticket.suppliers where id=c.supplier_id and deleted_at is null and is_active;
  if not found then
    raise exception using errcode='23514',message='O fornecedor deste contrato nao esta ativo.';
  end if;
  v_anchor:=date_trunc('month',c.starts_at)::date;
  if v_competence<v_anchor or mod(
    (extract(year from age(v_competence,v_anchor))::integer*12)+extract(month from age(v_competence,v_anchor))::integer,
    c.billing_interval_months)<>0 then
    raise exception using errcode='23514',message='A competencia nao corresponde a periodicidade deste contrato.';
  end if;
  v_start:=greatest(v_competence,c.starts_at);
  v_end:=(v_competence+(c.billing_interval_months||' months')::interval)::date;
  if c.ends_at is not null then v_end:=least(v_end,c.ends_at+1); end if;
  if v_start>=v_end then
    raise exception using errcode='23514',message='A competencia esta fora da vigencia do contrato.';
  end if;
  select id into v_id from apticket.supplier_payables
    where supplier_contract_id=c.id and cycle_start=v_start and deleted_at is null;
  if found then return v_id; end if;
  v_due:=v_competence+(least(c.due_day,extract(day from
    (v_competence+interval '1 month - 1 day'))::integer)-1);
  v_id:=gen_random_uuid();
  if c.billing_unit='fixed' then
    v_quantity:=1; v_total:=c.base_amount;
  else
    select count(*),coalesce(sum(x.measured_quantity),0),
      coalesce(sum(round(x.measured_quantity*c.unit_price,2)),0)
      into v_count,v_quantity,v_total
    from apticket.consumption_snapshots x
    where x.tenant_id=c.tenant_id and x.operating_company_id=c.operating_company_id
      and x.metric=c.billing_unit and x.cycle_start>=v_start and x.cycle_end<=v_end
      and x.deleted_at is null;
    if v_count=0 then
      raise exception using errcode='23514',message='O consumo desta competencia ainda nao foi apurado.';
    end if;
  end if;
  insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,
    supplier_contract_id,document_number,description,cycle_start,cycle_end,due_date,billing_unit,
    measured_quantity,unit_price,total_amount,allocation_status,terms_snapshot,created_by)
  values(v_id,c.tenant_id,c.operating_company_id,c.supplier_id,c.id,
    'PAG-'||to_char(v_competence,'YYYYMM')||'-'||upper(substr(v_id::text,1,8)),
    c.description,v_start,v_end,v_due,c.billing_unit,v_quantity,
    case when c.billing_unit='fixed' then c.base_amount else c.unit_price end,v_total,
    case when c.billing_unit='fixed' then 'pending_rule' else 'complete' end,
    jsonb_build_object('supplier_name',coalesce(s.trade_name,s.legal_name),'supplier_tax_id',s.tax_id,
      'contract_description',c.description,'billing_interval_months',c.billing_interval_months,
      'base_amount',c.base_amount,'unit_price',c.unit_price,'due_day',c.due_day),v_actor);
  if c.billing_unit<>'fixed' then
    insert into apticket.supplier_payable_allocations(tenant_id,operating_company_id,
      supplier_payable_id,customer_contract_id,consumption_snapshot_id,customer_name,contract_number,
      metric,quantity,unit_price,source_snapshot)
    select c.tenant_id,c.operating_company_id,v_id,x.contract_id,x.id,company.name,client_contract.numero_contrato,x.metric,
      x.measured_quantity,c.unit_price,
      jsonb_build_object('snapshot_id',x.id,'cycle_start',x.cycle_start,'cycle_end',x.cycle_end,
        'measured_quantity',x.measured_quantity,'source_type',x.source_type,'source_items',x.source_items)
    from apticket.consumption_snapshots x
    join apticket.contracts client_contract on client_contract.id=x.contract_id and client_contract.tenant_id=x.tenant_id
    join apticket.companies company on company.id=client_contract.company_id and company.tenant_id=x.tenant_id
    where x.tenant_id=c.tenant_id and x.operating_company_id=c.operating_company_id
      and x.metric=c.billing_unit and x.cycle_start>=v_start and x.cycle_end<=v_end
      and x.deleted_at is null;
  end if;
  return v_id;
end $$;

revoke all on function apticket.generate_supplier_payable(uuid,date) from public,anon;
grant execute on function apticket.generate_supplier_payable(uuid,date) to authenticated,service_role;
revoke all on function apticket_finance_private.guard_supplier_payable(),
  apticket_finance_private.protect_supplier_payable_sources()
  from public,anon,authenticated,service_role;

comment on table apticket.supplier_payables is 'Lancamentos recorrentes de fornecedores com termos e totais congelados.';
comment on table apticket.supplier_payable_allocations is 'Rateio imutavel de custos variaveis usando os mesmos snapshots de consumo do contas a receber.';
notify pgrst,'reload schema';
