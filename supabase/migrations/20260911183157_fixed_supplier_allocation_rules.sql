-- Fatia 19: regras versionadas de rateio percentual para custos fixos.
create table apticket.supplier_allocation_rule_sets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  operating_company_id uuid not null, supplier_contract_id uuid not null,
  effective_from date not null check (effective_from=date_trunc('month',effective_from)::date),
  created_by uuid, created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique (supplier_contract_id,effective_from), unique (id,tenant_id,operating_company_id),
  foreign key (supplier_contract_id,tenant_id,operating_company_id)
    references apticket.supplier_contracts(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create table apticket.supplier_allocation_rules (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  operating_company_id uuid not null, rule_set_id uuid not null,
  customer_contract_id uuid not null,
  percentage numeric(9,6) not null check (percentage>0 and percentage<=100),
  created_by uuid, created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  foreign key (rule_set_id,tenant_id,operating_company_id)
    references apticket.supplier_allocation_rule_sets(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (customer_contract_id,tenant_id,operating_company_id)
    references apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create index supplier_allocation_sets_contract_idx
  on apticket.supplier_allocation_rule_sets(supplier_contract_id,effective_from desc) where deleted_at is null;
create index supplier_allocation_rules_set_idx
  on apticket.supplier_allocation_rules(rule_set_id) where deleted_at is null;
create unique index supplier_allocation_rules_contract_key
  on apticket.supplier_allocation_rules(rule_set_id,customer_contract_id) where deleted_at is null;

alter table apticket.supplier_payable_allocations
  alter column consumption_snapshot_id drop not null,
  alter column metric drop not null,
  add column allocation_rule_id uuid,
  add column percentage numeric(9,6),
  add constraint supplier_payable_allocation_rule_fk
    foreign key (allocation_rule_id,tenant_id,operating_company_id)
    references apticket.supplier_allocation_rules(id,tenant_id,operating_company_id) on delete restrict,
  add constraint supplier_payable_allocation_origin_check check (
    (consumption_snapshot_id is not null and allocation_rule_id is null
      and metric in ('active_users','devices') and percentage is null)
    or (consumption_snapshot_id is null and allocation_rule_id is not null
      and metric is null and percentage>0 and percentage<=100));
create unique index supplier_payable_allocation_rule_key
  on apticket.supplier_payable_allocations(supplier_payable_id,allocation_rule_id)
  where allocation_rule_id is not null;

do $$ declare t text; begin
  foreach t in array array['supplier_allocation_rule_sets','supplier_allocation_rules'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy allocation_rule_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger allocation_rule_no_delete before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger allocation_rule_no_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger allocation_rule_audit after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create or replace function apticket_finance_private.guard_supplier_payable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-array['deleted_at','allocation_status']
    is distinct from to_jsonb(old)-array['deleted_at','allocation_status'] then
    raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
  end if;
  if new.allocation_status is distinct from old.allocation_status and not
    (old.allocation_status='pending_rule' and new.allocation_status='complete') then
    raise exception using errcode='23514',message='A situacao do rateio nao pode retroceder.';
  end if;
  return new;
end $$;

create function apticket_finance_private.apply_fixed_supplier_allocation(p_payable_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare p apticket.supplier_payables; v_set apticket.supplier_allocation_rule_sets;
  v_count integer; v_total numeric;
begin
  select * into p from apticket.supplier_payables where id=p_payable_id and deleted_at is null for update;
  if not found or p.billing_unit<>'fixed' then return false; end if;
  if p.allocation_status='complete' then return true; end if;
  select * into v_set from apticket.supplier_allocation_rule_sets s
    where s.supplier_contract_id=p.supplier_contract_id and s.effective_from<=p.cycle_start
      and s.deleted_at is null order by s.effective_from desc limit 1;
  if not found then return false; end if;
  select count(*),coalesce(sum(percentage),0) into v_count,v_total
    from apticket.supplier_allocation_rules where rule_set_id=v_set.id and deleted_at is null;
  if v_count=0 or v_total<>100 then return false; end if;
  insert into apticket.supplier_payable_allocations(tenant_id,operating_company_id,
    supplier_payable_id,customer_contract_id,allocation_rule_id,customer_name,contract_number,
    metric,quantity,unit_price,percentage,source_snapshot)
  with base as (
    select r.id rule_id,r.customer_contract_id,r.percentage,
      client_contract.numero_contrato,company.name customer_name,
      round(p.total_amount*r.percentage/100,2) base_amount,
      row_number() over(order by r.percentage desc,r.id) row_number
    from apticket.supplier_allocation_rules r
    join apticket.contracts client_contract
      on client_contract.id=r.customer_contract_id and client_contract.tenant_id=r.tenant_id
    join apticket.companies company
      on company.id=client_contract.company_id and company.tenant_id=r.tenant_id
    where r.rule_set_id=v_set.id and r.deleted_at is null
  ), calculated as (select base.*,sum(base_amount) over() allocated_total from base)
  select p.tenant_id,p.operating_company_id,p.id,customer_contract_id,rule_id,
    customer_name,numero_contrato,null,1,
    base_amount+case when row_number=1 then p.total_amount-allocated_total else 0 end,
    percentage,jsonb_build_object('rule_set_id',v_set.id,'rule_id',rule_id,
      'effective_from',v_set.effective_from,'percentage',percentage)
  from calculated;
  if (select coalesce(sum(amount),0) from apticket.supplier_payable_allocations
      where supplier_payable_id=p.id and deleted_at is null)<>p.total_amount then
    raise exception using errcode='23514',message='O rateio nao confere com o valor do lancamento.';
  end if;
  update apticket.supplier_payables set allocation_status='complete' where id=p.id;
  return true;
end $$;

create function apticket_finance_private.auto_apply_fixed_supplier_allocation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.billing_unit='fixed' then
    perform apticket_finance_private.apply_fixed_supplier_allocation(new.id);
  end if;
  return new;
end $$;
create trigger zz_auto_apply_fixed_allocation after insert on apticket.supplier_payables
  for each row execute function apticket_finance_private.auto_apply_fixed_supplier_allocation();

create function apticket.save_supplier_allocation_rules(
  p_supplier_contract_id uuid,p_effective_from date,p_rules jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare c apticket.supplier_contracts; v_actor uuid:=auth.uid(); v_set_id uuid;
  v_count integer; v_distinct integer; v_total numeric; v_invalid integer; pending_record record;
begin
  select * into c from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null for update;
  if not found or not c.is_active or c.billing_unit<>'fixed' then
    raise exception using errcode='23514',message='Selecione um contrato fixo e ativo.';
  end if;
  if v_actor is null or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar o rateio.';
  end if;
  if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
    raise exception using errcode='23514',message='A vigencia do rateio deve iniciar no primeiro dia do mes.';
  end if;
  if p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)=0 then
    raise exception using errcode='23514',message='Informe ao menos um contrato para o rateio.';
  end if;
  select count(*),count(distinct customer_contract_id),coalesce(sum(percentage),0),
    count(*) filter(where customer_contract_id is null or percentage is null or percentage<=0 or percentage>100)
    into v_count,v_distinct,v_total,v_invalid
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric);
  if v_invalid>0 or v_count<>v_distinct then
    raise exception using errcode='23514',message='Os contratos do rateio devem ser unicos e possuir percentual valido.';
  end if;
  if v_total<>100 then
    raise exception using errcode='23514',message='A soma dos percentuais do rateio deve ser exatamente 100%.';
  end if;
  select count(*) into v_invalid
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric)
  where not exists(select 1 from apticket.contract_financial_terms f
    join apticket.contracts client_contract
      on client_contract.id=f.contract_id and client_contract.tenant_id=f.tenant_id
    where f.contract_id=item.customer_contract_id and f.tenant_id=c.tenant_id
      and f.operating_company_id=c.operating_company_id and f.deleted_at is null);
  if v_invalid>0 then
    raise exception using errcode='23514',message='Um contrato de cliente nao pertence a esta empresa operadora.';
  end if;
  select id into v_set_id from apticket.supplier_allocation_rule_sets
    where supplier_contract_id=c.id and effective_from=p_effective_from and deleted_at is null for update;
  if found then
    if exists(select 1 from apticket.supplier_payable_allocations a
      join apticket.supplier_allocation_rules r on r.id=a.allocation_rule_id
      where r.rule_set_id=v_set_id and a.deleted_at is null) then
      raise exception using errcode='23514',message='Este rateio ja foi utilizado. Crie uma nova vigencia para altera-lo.';
    end if;
    update apticket.supplier_allocation_rules set deleted_at=clock_timestamp()
      where rule_set_id=v_set_id and deleted_at is null;
  else
    v_set_id:=gen_random_uuid();
    insert into apticket.supplier_allocation_rule_sets(id,tenant_id,operating_company_id,
      supplier_contract_id,effective_from,created_by)
    values(v_set_id,c.tenant_id,c.operating_company_id,c.id,p_effective_from,v_actor);
  end if;
  insert into apticket.supplier_allocation_rules(tenant_id,operating_company_id,rule_set_id,
    customer_contract_id,percentage,created_by)
  select c.tenant_id,c.operating_company_id,v_set_id,item.customer_contract_id,item.percentage,v_actor
  from jsonb_to_recordset(p_rules) as item(customer_contract_id uuid,percentage numeric);
  for pending_record in select id from apticket.supplier_payables
    where supplier_contract_id=c.id and allocation_status='pending_rule'
      and cycle_start>=p_effective_from and deleted_at is null for update
  loop perform apticket_finance_private.apply_fixed_supplier_allocation(pending_record.id); end loop;
  return v_set_id;
end $$;

create function apticket.apply_supplier_payable_allocation(p_supplier_payable_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; begin
  select * into p from apticket.supplier_payables where id=p_supplier_payable_id and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Lancamento nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para aplicar o rateio.';
  end if;
  if not apticket_finance_private.apply_fixed_supplier_allocation(p.id) then
    raise exception using errcode='23514',message='Nenhuma regra de rateio valida foi encontrada para esta competencia.';
  end if;
  return true;
end $$;

revoke all on function apticket.save_supplier_allocation_rules(uuid,date,jsonb),
  apticket.apply_supplier_payable_allocation(uuid) from public,anon;
grant execute on function apticket.save_supplier_allocation_rules(uuid,date,jsonb),
  apticket.apply_supplier_payable_allocation(uuid) to authenticated;
revoke all on function apticket_finance_private.apply_fixed_supplier_allocation(uuid),
  apticket_finance_private.auto_apply_fixed_supplier_allocation() from public,anon,authenticated,service_role;
comment on table apticket.supplier_allocation_rule_sets is 'Versoes mensais das regras percentuais de rateio de contratos fixos de fornecedores.';
comment on table apticket.supplier_allocation_rules is 'Percentual de custo fixo destinado a cada contrato de cliente.';
notify pgrst,'reload schema';
