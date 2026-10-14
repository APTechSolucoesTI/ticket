-- Rateios dos lançamentos usam a mesma validação e os mesmos snapshots dos contratos.
create function apticket.classify_financial_entry_allocated(
  p_source_type text,p_source_id uuid,p_category_allocations jsonb,p_cost_center_allocations jsonb,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid; v_company uuid; v_actual_type text; v_direction text; v_module text;
  v_categories jsonb; v_centers jsonb; v_category jsonb; v_center jsonb;
  v_actor_name text; v_id uuid:=gen_random_uuid();
begin
  if auth.uid() is null or apticket.current_tenant_id() is null then
    raise exception using errcode='42501',message='Sem permissão para classificar este movimento.';
  end if;
  if p_source_type in ('measurement_receivable','recurring_receivable','manual_receivable') then
    select r.tenant_id,r.operating_company_id,
      case r.origin_type when 'measurement' then 'measurement_receivable'
        when 'manual' then 'manual_receivable' else 'recurring_receivable' end
      into v_tenant,v_company,v_actual_type from apticket.contas_receber r
      where r.id=p_source_id and r.tenant_id=apticket.current_tenant_id() and r.deleted_at is null for update;
    v_direction:='inflow'; v_module:='financeiro_contas_receber';
  elsif p_source_type='supplier_payable' then
    select p.tenant_id,p.operating_company_id,'supplier_payable' into v_tenant,v_company,v_actual_type
      from apticket.supplier_payables p where p.id=p_source_id and p.tenant_id=apticket.current_tenant_id() and p.deleted_at is null for update;
    v_direction:='outflow'; v_module:='financeiro_contas_pagar';
  elsif p_source_type='bank_transaction' then
    select t.tenant_id,t.operating_company_id,'bank_transaction',case when t.amount>0 then 'inflow' else 'outflow' end
      into v_tenant,v_company,v_actual_type,v_direction from apticket.bank_statement_transactions t
      where t.id=p_source_id and t.tenant_id=apticket.current_tenant_id() and t.deleted_at is null for update;
    v_module:='financeiro_bancos';
  else
    raise exception using errcode='22023',message='Origem financeira inválida.';
  end if;
  if v_tenant is null or v_company is null or v_actual_type<>p_source_type then
    raise exception using errcode='P0002',message='Movimento financeiro não encontrado nesta origem.';
  end if;
  if not apticket.has_financial_scope(v_tenant,v_company,true) or not (
    apticket.has_permission(auth.uid(),v_module,'edit')
    or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit')
  ) then raise exception using errcode='42501',message='Sem permissão financeira para classificar este movimento.'; end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='Usuário responsável não está ativo.'; end if;
  v_categories:=apticket_finance_private.normalize_contract_allocation(p_category_allocations,'category',v_tenant,v_company,v_direction);
  v_centers:=apticket_finance_private.normalize_contract_allocation(p_cost_center_allocations,'cost_center',v_tenant,v_company,v_direction);
  select value into v_category from jsonb_array_elements(v_categories) order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  select value into v_center from jsonb_array_elements(v_centers) order by (value->>'percentage')::numeric desc,value->>'item_id' limit 1;
  update apticket.financial_entry_classifications set replaced_at=clock_timestamp()
    where source_type=p_source_type and source_id=p_source_id and replaced_at is null;
  insert into apticket.financial_entry_classifications(id,tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,
    notes,classified_by,classified_by_name,category_allocations,cost_center_allocations)
  values(v_id,v_tenant,v_company,p_source_type,p_source_id,v_direction,
    (v_category->>'item_id')::uuid,v_category->>'code',v_category->>'name',
    (v_center->>'item_id')::uuid,v_center->>'code',v_center->>'name',nullif(btrim(p_notes),''),auth.uid(),v_actor_name,v_categories,v_centers);
  return v_id;
end $$;

create function apticket.create_manual_receivable_allocated(
  p_operating_company_id uuid,p_company_id uuid,p_document_type_id uuid,
  p_document_reference text,p_description text,p_competence date,p_total_amount numeric,
  p_installments jsonb,p_category_allocations jsonb,p_cost_center_allocations jsonb,
  p_installment_interval_days integer default 0,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_group uuid; item record;
begin
  v_group:=apticket.create_manual_receivable(p_operating_company_id,p_company_id,p_document_type_id,
    p_document_reference,p_description,p_competence,p_total_amount,p_installments,p_installment_interval_days,p_notes);
  for item in select id from apticket.contas_receber where manual_entry_group_id=v_group loop
    perform apticket.classify_financial_entry_allocated('manual_receivable',item.id,p_category_allocations,p_cost_center_allocations,'Rateios informados no lançamento manual');
  end loop;
  return v_group;
end $$;

create function apticket.create_manual_supplier_payable_allocated(
  p_operating_company_id uuid,p_supplier_id uuid,p_document_type_id uuid,
  p_document_number text,p_description text,p_competence date,p_total_amount numeric,
  p_installments jsonb,p_category_allocations jsonb,p_cost_center_allocations jsonb,
  p_installment_interval_days integer default 0,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_group uuid; item record;
begin
  v_group:=apticket.create_manual_supplier_payable(p_operating_company_id,p_supplier_id,p_document_type_id,
    p_document_number,p_description,p_competence,p_total_amount,p_installments,p_installment_interval_days,p_notes);
  for item in select id from apticket.supplier_payables where manual_entry_group_id=v_group loop
    perform apticket.classify_financial_entry_allocated('supplier_payable',item.id,p_category_allocations,p_cost_center_allocations,'Rateios informados no lançamento manual');
  end loop;
  return v_group;
end $$;

revoke all on function apticket.classify_financial_entry_allocated(text,uuid,jsonb,jsonb,text),
  apticket.create_manual_receivable_allocated(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,integer,text),
  apticket.create_manual_supplier_payable_allocated(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function apticket.classify_financial_entry_allocated(text,uuid,jsonb,jsonb,text),
  apticket.create_manual_receivable_allocated(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,integer,text),
  apticket.create_manual_supplier_payable_allocated(uuid,uuid,uuid,text,text,date,numeric,jsonb,jsonb,jsonb,integer,text)
  to authenticated;
comment on function apticket.classify_financial_entry_allocated(text,uuid,jsonb,jsonb,text) is
  'Classificação versionada com rateios de categorias e centros independentes, cada grupo totalizando 100%; usa a mesma normalização dos contratos.';
notify pgrst,'reload schema';
