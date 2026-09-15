-- Alinha os metadados dos contratos de fornecedores ao cadastro de contratos
-- de clientes, preservando o motor financeiro e os rateios existentes.
alter table apticket.supplier_contracts
  add column numero_contrato text,
  add column status text not null default 'active',
  add column tipo_medicao apticket.tipo_medicao_contrato not null default 'mensal',
  add column tipo_vencimento apticket.tipo_vencimento_contrato not null default 'fixo',
  add column emite_nf boolean not null default false,
  add column emite_boleto boolean not null default false,
  add column auto_renew boolean not null default false;

alter table apticket.supplier_contracts
  add constraint supplier_contract_status_check
    check (status in ('active','suspended','expired','cancelled')),
  add constraint supplier_contract_number_format_check
    check (numero_contrato is null or numero_contrato ~ '^[0-9]{6}/[0-9]{4}$');

create function apticket_finance_private.next_supplier_contract_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_year integer := extract(year from current_date)::integer;
  v_next integer;
begin
  if p_tenant_id is null then
    raise exception using errcode='22023', message='Tenant obrigatoria para numerar o contrato.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':supplier-contract:' || v_year, 0));
  select coalesce(max(split_part(numero_contrato,'/',1)::integer),0)+1
    into v_next
  from apticket.supplier_contracts
  where tenant_id=p_tenant_id and split_part(numero_contrato,'/',2)=v_year::text;
  return lpad(v_next::text,6,'0') || '/' || v_year::text;
end
$$;

revoke all on function apticket_finance_private.next_supplier_contract_number(uuid)
  from public,anon,authenticated,service_role;

create function apticket_finance_private.fill_supplier_contract_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.numero_contrato is null or btrim(new.numero_contrato)='' then
    new.numero_contrato:=apticket_finance_private.next_supplier_contract_number(new.tenant_id);
  end if;
  return new;
end
$$;

revoke all on function apticket_finance_private.fill_supplier_contract_number()
  from public,anon,authenticated,service_role;

create trigger aa_fill_supplier_contract_number
before insert on apticket.supplier_contracts
for each row execute function apticket_finance_private.fill_supplier_contract_number();

with ranked as (
  select id,
    row_number() over(partition by tenant_id,extract(year from created_at) order by created_at,id) as sequence,
    extract(year from created_at)::integer as year
  from apticket.supplier_contracts
  where numero_contrato is null
)
update apticket.supplier_contracts contract
set numero_contrato=lpad(ranked.sequence::text,6,'0') || '/' || ranked.year::text
from ranked where ranked.id=contract.id;

alter table apticket.supplier_contracts alter column numero_contrato set not null;
create unique index supplier_contracts_tenant_number_key
  on apticket.supplier_contracts(tenant_id,numero_contrato);

create function apticket_finance_private.protect_supplier_contract_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.numero_contrato is distinct from old.numero_contrato then
    raise exception using errcode='23514',message='O numero do contrato de fornecedor nao pode ser alterado.';
  end if;
  return new;
end
$$;

revoke all on function apticket_finance_private.protect_supplier_contract_number()
  from public,anon,authenticated,service_role;

create trigger protect_supplier_contract_number
before update of numero_contrato on apticket.supplier_contracts
for each row execute function apticket_finance_private.protect_supplier_contract_number();

comment on column apticket.supplier_contracts.numero_contrato is
  'Numero sequencial imutavel do contrato de fornecedor no tenant.';
comment on column apticket.supplier_contracts.tipo_medicao is
  'Periodicidade usada na geracao das medicoes do contrato de fornecedor.';

-- O rateio percentual passa a ser a fotografia da medicao, inclusive para
-- contratos cujo valor total foi calculado por usuario ou equipamento.
create or replace function apticket_finance_private.apply_fixed_supplier_allocation(p_payable_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare p apticket.supplier_payables; v_set apticket.supplier_allocation_rule_sets;
  v_count integer; v_total numeric;
begin
  select * into p from apticket.supplier_payables where id=p_payable_id and deleted_at is null for update;
  if not found then return false; end if;
  if p.allocation_status='complete' and exists(
    select 1 from apticket.supplier_payable_allocations
    where supplier_payable_id=p.id and deleted_at is null
  ) then return true; end if;
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
      'effective_from',v_set.effective_from,'percentage',percentage,'allocation_mode','measurement')
  from calculated;
  if (select coalesce(sum(amount),0) from apticket.supplier_payable_allocations
      where supplier_payable_id=p.id and deleted_at is null)<>p.total_amount then
    raise exception using errcode='23514',message='O rateio nao confere com o valor do lancamento.';
  end if;
  update apticket.supplier_payables set allocation_status='complete' where id=p.id;
  return true;
end $$;

create or replace function apticket.save_supplier_allocation_rules(
  p_supplier_contract_id uuid,p_effective_from date,p_rules jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare c apticket.supplier_contracts; v_actor uuid:=auth.uid(); v_set_id uuid;
  v_count integer; v_distinct integer; v_total numeric; v_invalid integer; pending_record record;
begin
  select * into c from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null for update;
  if not found or not c.is_active then
    raise exception using errcode='23514',message='Selecione um contrato de fornecedor ativo.';
  end if;
  if v_actor is null or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar o rateio.';
  end if;
  if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
    raise exception using errcode='23514',message='A competencia do rateio deve iniciar no primeiro dia do mes.';
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
      raise exception using errcode='23514',message='O rateio desta medicao ja foi utilizado e nao pode ser alterado.';
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

create function apticket.generate_supplier_measurement(
  p_supplier_contract_id uuid,p_competence date
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_id uuid; v_contract apticket.supplier_contracts;
begin
  select * into v_contract from apticket.supplier_contracts
    where id=p_supplier_contract_id and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Contrato de fornecedor nao encontrado.'; end if;
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role'
    and (auth.uid() is null or not apticket.has_financial_scope(
      v_contract.tenant_id,v_contract.operating_company_id,true
    )) then raise exception using errcode='42501',message='Sem permissao financeira para gerar a medicao.'; end if;
  v_id:=apticket.generate_supplier_payable(p_supplier_contract_id,p_competence);
  if v_contract.billing_unit<>'fixed' then
    update apticket.supplier_payable_allocations set deleted_at=clock_timestamp()
      where supplier_payable_id=v_id and deleted_at is null;
  end if;
  if not apticket_finance_private.apply_fixed_supplier_allocation(v_id) then
    raise exception using errcode='23514',message='Informe o rateio percentual da medicao antes de gera-la.';
  end if;
  return v_id;
end $$;

revoke all on function apticket.generate_supplier_measurement(uuid,date) from public,anon;
grant execute on function apticket.generate_supplier_measurement(uuid,date) to authenticated,service_role;

notify pgrst,'reload schema';
