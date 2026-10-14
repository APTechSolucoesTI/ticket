-- Run only after reviewing and restoring the previous frontend commit.
-- The guard prevents silent loss of multi-item contract or accounting allocations.
begin;
do $$ begin
  if exists(select 1 from apticket.contracts where jsonb_array_length(category_allocations)>1 or jsonb_array_length(cost_center_allocations)>1)
    or exists(select 1 from apticket.supplier_contracts where jsonb_array_length(category_allocations)>1 or jsonb_array_length(cost_center_allocations)>1)
    or exists(select 1 from apticket.financial_entry_classifications where jsonb_array_length(category_allocations)>1 or jsonb_array_length(cost_center_allocations)>1) then
    raise exception 'Reversão bloqueada: existem rateios múltiplos. Preserve o banco e restaure somente o aplicativo, ou prepare uma migração de conversão aprovada.';
  end if;
end $$;
do $$ begin
  execute 'create or replace view apticket.financial_budget_variance with (security_invoker=true) as '||
    replace(pg_get_viewdef('apticket.financial_budget_variance'::regclass,true),'cash_flow_allocation_entries','cash_flow_entries');
end $$;
drop view if exists apticket.cash_flow_allocation_entries;
CREATE OR REPLACE FUNCTION apticket_finance_private.apply_contract_default_classification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  row_data jsonb:=to_jsonb(new);
  v_category apticket.financial_categories; v_center apticket.financial_cost_centers;
  v_category_id uuid; v_center_id uuid; v_source_type text; v_direction text;
  v_actor uuid:=auth.uid(); v_actor_name text; v_contract_id uuid;
begin
  if tg_table_name='contas_receber' then
    v_contract_id:=nullif(row_data->>'contrato_id','')::uuid;
    if v_contract_id is null then return new; end if;
    select contract.financial_category_id,contract.cost_center_id into v_category_id,v_center_id
      from apticket.contracts contract where contract.id=v_contract_id and contract.tenant_id=new.tenant_id;
    v_source_type:=case row_data->>'origin_type' when 'measurement' then 'measurement_receivable'
      when 'manual' then 'manual_receivable' else 'recurring_receivable' end;
    v_direction:='inflow';
  elsif tg_table_name='supplier_payables' then
    v_contract_id:=nullif(row_data->>'supplier_contract_id','')::uuid;
    if v_contract_id is null then return new; end if;
    select contract.financial_category_id,contract.cost_center_id into v_category_id,v_center_id
      from apticket.supplier_contracts contract where contract.id=v_contract_id and contract.tenant_id=new.tenant_id;
    v_source_type:='supplier_payable'; v_direction:='outflow';
  else return new;
  end if;
  if v_category_id is null or v_center_id is null then return new; end if;
  select * into v_category from apticket.financial_categories where id=v_category_id and tenant_id=new.tenant_id
    and (operating_company_id=new.operating_company_id or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  select * into v_center from apticket.financial_cost_centers where id=v_center_id and tenant_id=new.tenant_id
    and (operating_company_id=new.operating_company_id or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  if v_category.id is null or v_center.id is null or v_category.direction not in (v_direction,'both') then
    raise exception using errcode='23514',message='A classificacao financeira padrao do contrato nao esta mais valida.';
  end if;
  select name into v_actor_name from apticket.profiles where id=v_actor and tenant_id=new.tenant_id and is_active;
  insert into apticket.financial_entry_classifications(tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,
    classified_by,classified_by_name)
  values(new.tenant_id,new.operating_company_id,v_source_type,new.id,v_direction,v_category.id,v_category.code,
    v_category.name,v_center.id,v_center.code,v_center.name,case when v_actor_name is null then null else v_actor end,
    coalesce(v_actor_name,'Sistema'));
  return new;
end $function$;

drop trigger if exists prepare_contract_allocations on apticket.contracts;
drop trigger if exists sync_contract_allocations on apticket.contracts;
drop trigger if exists validate_customer_contract_dimensions on apticket.contracts;
create trigger validate_customer_contract_dimensions before insert or update of tenant_id,operating_company_id,financial_category_id,cost_center_id
  on apticket.contracts for each row execute function apticket_finance_private.validate_contract_dimensions('inflow');
drop table if exists apticket.contracts_category_allocations;
drop table if exists apticket.contracts_cost_center_allocations;

drop trigger if exists prepare_contract_allocations on apticket.supplier_contracts;
drop trigger if exists sync_contract_allocations on apticket.supplier_contracts;
drop trigger if exists validate_supplier_contract_dimensions on apticket.supplier_contracts;
create trigger validate_supplier_contract_dimensions before insert or update of tenant_id,operating_company_id,financial_category_id,cost_center_id
  on apticket.supplier_contracts for each row execute function apticket_finance_private.validate_contract_dimensions('outflow');
drop table if exists apticket.supplier_contracts_category_allocations;
drop table if exists apticket.supplier_contracts_cost_center_allocations;

drop trigger if exists contract_allocation_audit on apticket.contracts;
alter table apticket.contracts drop column if exists category_allocations,drop column if exists cost_center_allocations;
alter table apticket.supplier_contracts drop column if exists category_allocations,drop column if exists cost_center_allocations;
alter table apticket.financial_entry_classifications drop column if exists category_allocations,drop column if exists cost_center_allocations;
drop function if exists apticket.allocate_financial_amount(numeric,jsonb,jsonb);
drop function if exists apticket_finance_private.prepare_contract_allocations();
drop function if exists apticket_finance_private.sync_contract_allocations();
drop function if exists apticket_finance_private.normalize_contract_allocation(jsonb,text,uuid,uuid,text);
drop index if exists apticket.contracts_allocation_tenant_key;
drop index if exists apticket.supplier_contracts_allocation_tenant_key;
delete from supabase_migrations.schema_migrations where version='20261014134553';
notify pgrst,'reload schema';
commit;
