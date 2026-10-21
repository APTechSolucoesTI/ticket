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
create trigger aa_fill_supplier_contract_number before insert on apticket.supplier_contracts
for each row execute function apticket_finance_private.fill_supplier_contract_number();
