-- O trigger é compartilhado por contas_receber e supplier_payables. Acesso a
-- campos específicos via JSON evita erro de atributo inexistente.
create or replace function apticket_finance_private.apply_contract_default_classification() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
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
    and operating_company_id=new.operating_company_id and is_active and deleted_at is null;
  select * into v_center from apticket.financial_cost_centers where id=v_center_id and tenant_id=new.tenant_id
    and operating_company_id=new.operating_company_id and is_active and deleted_at is null;
  if v_category.id is null or v_center.id is null or v_category.direction not in (v_direction,'both') then
    raise exception using errcode='23514',message='A classificação financeira padrão do contrato não está mais válida.';
  end if;
  select name into v_actor_name from apticket.profiles where id=v_actor and tenant_id=new.tenant_id and is_active;
  insert into apticket.financial_entry_classifications(tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,
    classified_by,classified_by_name)
  values(new.tenant_id,new.operating_company_id,v_source_type,new.id,v_direction,v_category.id,v_category.code,
    v_category.name,v_center.id,v_center.code,v_center.name,case when v_actor_name is null then null else v_actor end,
    coalesce(v_actor_name,'Sistema'));
  return new;
end $$;
