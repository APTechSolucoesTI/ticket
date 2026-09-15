-- Classificacao padrao dos contratos, classificacao de movimentos bancarios,
-- exclusao logica segura de contratos e endurecimento das permissoes.

alter table apticket.contracts
  add column deleted_at timestamptz,
  add column financial_category_id uuid,
  add column cost_center_id uuid,
  add constraint contracts_financial_category_scope_fk
    foreign key(financial_category_id,tenant_id,operating_company_id)
    references apticket.financial_categories(id,tenant_id,operating_company_id) on delete restrict,
  add constraint contracts_cost_center_scope_fk
    foreign key(cost_center_id,tenant_id,operating_company_id)
    references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  add constraint contracts_financial_dimensions_pair_check
    check ((financial_category_id is null)=(cost_center_id is null));

alter table apticket.supplier_contracts
  add column financial_category_id uuid,
  add column cost_center_id uuid,
  add constraint supplier_contracts_financial_category_scope_fk
    foreign key(financial_category_id,tenant_id,operating_company_id)
    references apticket.financial_categories(id,tenant_id,operating_company_id) on delete restrict,
  add constraint supplier_contracts_cost_center_scope_fk
    foreign key(cost_center_id,tenant_id,operating_company_id)
    references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  add constraint supplier_contracts_financial_dimensions_pair_check
    check ((financial_category_id is null)=(cost_center_id is null));

create index contracts_active_scope_idx
  on apticket.contracts(tenant_id,operating_company_id,starts_at desc)
  where deleted_at is null;

create function apticket_finance_private.validate_contract_dimensions()
returns trigger
language plpgsql
security invoker
set search_path=pg_catalog
as $$
declare
  v_direction text:=tg_argv[0];
begin
  if new.financial_category_id is null and new.cost_center_id is null then
    return new;
  end if;
  if new.financial_category_id is null or new.cost_center_id is null then
    raise exception using errcode='23514',message='Informe a categoria financeira e o centro de custo em conjunto.';
  end if;
  perform 1 from apticket.financial_categories category
  where category.id=new.financial_category_id
    and category.tenant_id=new.tenant_id
    and category.operating_company_id=new.operating_company_id
    and category.is_active and category.deleted_at is null
    and category.direction in (v_direction,'both');
  if not found then
    raise exception using errcode='23514',message='A categoria financeira nao pertence a empresa ou nao e compativel com o contrato.';
  end if;
  perform 1 from apticket.financial_cost_centers center
  where center.id=new.cost_center_id
    and center.tenant_id=new.tenant_id
    and center.operating_company_id=new.operating_company_id
    and center.is_active and center.deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='O centro de custo nao pertence a empresa operadora ou esta inativo.';
  end if;
  return new;
end
$$;

create trigger validate_customer_contract_dimensions
before insert or update of tenant_id,operating_company_id,financial_category_id,cost_center_id
on apticket.contracts for each row
execute function apticket_finance_private.validate_contract_dimensions('inflow');

create trigger validate_supplier_contract_dimensions
before insert or update of tenant_id,operating_company_id,financial_category_id,cost_center_id
on apticket.supplier_contracts for each row
execute function apticket_finance_private.validate_contract_dimensions('outflow');

revoke all on function apticket_finance_private.validate_contract_dimensions()
  from public,anon,authenticated,service_role;

alter table apticket.financial_entry_classifications
  drop constraint financial_entry_classifications_source_type_check,
  add constraint financial_entry_classifications_source_type_check check(source_type in (
    'measurement_receivable','recurring_receivable','manual_receivable',
    'supplier_payable','bank_transaction'
  ));

create or replace function apticket.classify_financial_entry(
  p_source_type text,p_source_id uuid,p_category_id uuid,p_cost_center_id uuid,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid; v_company uuid; v_direction text; v_actual_type text; v_module text;
  category apticket.financial_categories; center apticket.financial_cost_centers;
  v_actor_name text; v_id uuid:=gen_random_uuid();
begin
  if p_source_type in ('measurement_receivable','recurring_receivable','manual_receivable') then
    select r.tenant_id,r.operating_company_id,
      case r.origin_type when 'measurement' then 'measurement_receivable'
        when 'manual' then 'manual_receivable' else 'recurring_receivable' end
      into v_tenant,v_company,v_actual_type from apticket.contas_receber r
      where r.id=p_source_id and r.deleted_at is null for update;
    v_direction:='inflow'; v_module:='financeiro_contas_receber';
  elsif p_source_type='supplier_payable' then
    select p.tenant_id,p.operating_company_id,'supplier_payable' into v_tenant,v_company,v_actual_type
      from apticket.supplier_payables p where p.id=p_source_id and p.deleted_at is null for update;
    v_direction:='outflow'; v_module:='financeiro_contas_pagar';
  elsif p_source_type='bank_transaction' then
    select transaction.tenant_id,transaction.operating_company_id,'bank_transaction',
      case when transaction.amount>0 then 'inflow' else 'outflow' end
      into v_tenant,v_company,v_actual_type,v_direction
      from apticket.bank_statement_transactions transaction
      where transaction.id=p_source_id and transaction.deleted_at is null for update;
    v_module:='financeiro_bancos';
  else
    raise exception using errcode='22023',message='Origem financeira invalida.';
  end if;
  if v_tenant is null or v_company is null or v_actual_type<>p_source_type then
    raise exception using errcode='P0002',message='Movimento financeiro nao encontrado nesta origem.';
  end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(v_tenant,v_company,true)
    or not (
      apticket.has_permission(auth.uid(),v_module,'edit')
      or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit')
    ) then
    raise exception using errcode='42501',message='Sem permissao financeira para classificar este movimento.';
  end if;
  select * into category from apticket.financial_categories where id=p_category_id
    and tenant_id=v_tenant and operating_company_id=v_company and is_active and deleted_at is null;
  if not found or category.direction not in (v_direction,'both') then
    raise exception using errcode='23514',message='Selecione uma categoria ativa compativel com o movimento.';
  end if;
  select * into center from apticket.financial_cost_centers where id=p_cost_center_id
    and tenant_id=v_tenant and operating_company_id=v_company and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um centro de custo ativo desta empresa.';
  end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid()
    and tenant_id=v_tenant and is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.';
  end if;
  update apticket.financial_entry_classifications set replaced_at=clock_timestamp()
    where source_type=p_source_type and source_id=p_source_id and replaced_at is null;
  insert into apticket.financial_entry_classifications(id,tenant_id,operating_company_id,source_type,
    source_id,direction,financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,notes,classified_by,classified_by_name)
  values(v_id,v_tenant,v_company,p_source_type,p_source_id,v_direction,category.id,category.code,
    category.name,center.id,center.code,center.name,nullif(btrim(p_notes),''),auth.uid(),v_actor_name);
  return v_id;
end
$$;

create or replace function apticket.clear_financial_entry_classification(
  p_source_type text,p_source_id uuid
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c apticket.financial_entry_classifications; v_module text; begin
  select * into c from apticket.financial_entry_classifications where source_type=p_source_type
    and source_id=p_source_id and replaced_at is null for update;
  if not found then
    raise exception using errcode='P0002',message='Classificacao atual nao encontrada.';
  end if;
  v_module:=case
    when p_source_type in ('measurement_receivable','recurring_receivable','manual_receivable')
      then 'financeiro_contas_receber'
    when p_source_type='supplier_payable' then 'financeiro_contas_pagar'
    when p_source_type='bank_transaction' then 'financeiro_bancos'
    else null end;
  if v_module is null or auth.uid() is null
    or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true)
    or not (
      apticket.has_permission(auth.uid(),v_module,'edit')
      or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit')
    ) then
    raise exception using errcode='42501',message='Sem permissao financeira para remover esta classificacao.';
  end if;
  update apticket.financial_entry_classifications set replaced_at=clock_timestamp() where id=c.id;
  return true;
end
$$;

revoke all on function apticket.classify_financial_entry(text,uuid,uuid,uuid,text),
  apticket.clear_financial_entry_classification(text,uuid) from public,anon,service_role;
grant execute on function apticket.classify_financial_entry(text,uuid,uuid,uuid,text),
  apticket.clear_financial_entry_classification(text,uuid) to authenticated;

create function apticket_finance_private.apply_contract_default_classification()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_category apticket.financial_categories;
  v_center apticket.financial_cost_centers;
  v_category_id uuid; v_center_id uuid; v_source_type text; v_direction text;
  v_actor uuid:=auth.uid(); v_actor_name text;
begin
  if tg_table_name='contas_receber' and new.contrato_id is not null then
    select contract.financial_category_id,contract.cost_center_id
      into v_category_id,v_center_id from apticket.contracts contract
      where contract.id=new.contrato_id and contract.tenant_id=new.tenant_id;
    v_source_type:=case new.origin_type when 'measurement' then 'measurement_receivable'
      when 'manual' then 'manual_receivable' else 'recurring_receivable' end;
    v_direction:='inflow';
  elsif tg_table_name='supplier_payables' and new.supplier_contract_id is not null then
    select contract.financial_category_id,contract.cost_center_id
      into v_category_id,v_center_id from apticket.supplier_contracts contract
      where contract.id=new.supplier_contract_id and contract.tenant_id=new.tenant_id;
    v_source_type:='supplier_payable'; v_direction:='outflow';
  else
    return new;
  end if;
  if v_category_id is null or v_center_id is null then return new; end if;
  select * into v_category from apticket.financial_categories
    where id=v_category_id and tenant_id=new.tenant_id
      and operating_company_id=new.operating_company_id and is_active and deleted_at is null;
  select * into v_center from apticket.financial_cost_centers
    where id=v_center_id and tenant_id=new.tenant_id
      and operating_company_id=new.operating_company_id and is_active and deleted_at is null;
  if v_category.id is null or v_center.id is null or v_category.direction not in (v_direction,'both') then
    raise exception using errcode='23514',message='A classificacao financeira padrao do contrato nao esta mais valida.';
  end if;
  select name into v_actor_name from apticket.profiles
    where id=v_actor and tenant_id=new.tenant_id and is_active;
  insert into apticket.financial_entry_classifications(
    tenant_id,operating_company_id,source_type,source_id,direction,
    financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,classified_by,classified_by_name
  ) values (
    new.tenant_id,new.operating_company_id,v_source_type,new.id,v_direction,
    v_category.id,v_category.code,v_category.name,v_center.id,v_center.code,v_center.name,
    case when v_actor_name is null then null else v_actor end,coalesce(v_actor_name,'Sistema')
  );
  return new;
end
$$;

create trigger classify_receivable_from_contract
after insert on apticket.contas_receber for each row
execute function apticket_finance_private.apply_contract_default_classification();
create trigger classify_payable_from_contract
after insert on apticket.supplier_payables for each row
execute function apticket_finance_private.apply_contract_default_classification();
revoke all on function apticket_finance_private.apply_contract_default_classification()
  from public,anon,authenticated,service_role;

create function apticket.create_manual_receivable_classified(
  p_operating_company_id uuid,p_company_id uuid,p_document_type_id uuid,
  p_document_reference text,p_description text,p_competence date,p_total_amount numeric,
  p_installments jsonb,p_installment_interval_days integer default 0,p_notes text default null,
  p_category_id uuid default null,p_cost_center_id uuid default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_group uuid; item record; begin
  if (p_category_id is null)<>(p_cost_center_id is null) then
    raise exception using errcode='23514',message='Informe a categoria financeira e o centro de custo em conjunto.';
  end if;
  v_group:=apticket.create_manual_receivable(
    p_operating_company_id,p_company_id,p_document_type_id,p_document_reference,p_description,
    p_competence,p_total_amount,p_installments,p_installment_interval_days,p_notes
  );
  if p_category_id is not null then
    for item in select id from apticket.contas_receber where manual_entry_group_id=v_group loop
      perform apticket.classify_financial_entry(
        'manual_receivable',item.id,p_category_id,p_cost_center_id,'Classificacao informada no lancamento manual'
      );
    end loop;
  end if;
  return v_group;
end
$$;

create function apticket.create_manual_supplier_payable_classified(
  p_operating_company_id uuid,p_supplier_id uuid,p_document_type_id uuid,
  p_document_number text,p_description text,p_competence date,p_total_amount numeric,
  p_installments jsonb,p_installment_interval_days integer default 0,p_notes text default null,
  p_category_id uuid default null,p_cost_center_id uuid default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_group uuid; item record; begin
  if (p_category_id is null)<>(p_cost_center_id is null) then
    raise exception using errcode='23514',message='Informe a categoria financeira e o centro de custo em conjunto.';
  end if;
  v_group:=apticket.create_manual_supplier_payable(
    p_operating_company_id,p_supplier_id,p_document_type_id,p_document_number,p_description,
    p_competence,p_total_amount,p_installments,p_installment_interval_days,p_notes
  );
  if p_category_id is not null then
    for item in select id from apticket.supplier_payables where manual_entry_group_id=v_group loop
      perform apticket.classify_financial_entry(
        'supplier_payable',item.id,p_category_id,p_cost_center_id,'Classificacao informada no lancamento manual'
      );
    end loop;
  end if;
  return v_group;
end
$$;

revoke all on function apticket.create_manual_receivable_classified(
  uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text,uuid,uuid
) from public,anon,service_role;
revoke all on function apticket.create_manual_supplier_payable_classified(
  uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text,uuid,uuid
) from public,anon,service_role;
grant execute on function apticket.create_manual_receivable_classified(
  uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text,uuid,uuid
) to authenticated;
grant execute on function apticket.create_manual_supplier_payable_classified(
  uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text,uuid,uuid
) to authenticated;

create function apticket.archive_customer_contract(p_contract_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare contract apticket.contracts; begin
  select * into contract from apticket.contracts
    where id=p_contract_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Contrato de cliente nao encontrado.'; end if;
  if auth.uid() is null or contract.tenant_id<>apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'contratos','delete') then
    raise exception using errcode='42501',message='Sem permissao para excluir este contrato.';
  end if;
  if exists(select 1 from apticket.medicoes_contrato where contrato_id=contract.id) then
    raise exception using errcode='23514',message='Este contrato possui medicoes e nao pode ser excluido.';
  end if;
  update apticket.contracts set status='cancelled',deleted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=contract.id;
  return true;
end
$$;

create function apticket.archive_supplier_contract(p_contract_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare contract apticket.supplier_contracts; begin
  select * into contract from apticket.supplier_contracts
    where id=p_contract_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Contrato de fornecedor nao encontrado.'; end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(contract.tenant_id,contract.operating_company_id,true)
    or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissao para excluir este contrato.';
  end if;
  if exists(select 1 from apticket.supplier_payables where supplier_contract_id=contract.id) then
    raise exception using errcode='23514',message='Este contrato possui medicoes e nao pode ser excluido.';
  end if;
  update apticket.supplier_contracts set status='cancelled',is_active=false,
    deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=contract.id;
  return true;
end
$$;

revoke delete on apticket.contracts from authenticated;
drop policy if exists "contracts delete" on apticket.contracts;
revoke all on function apticket.archive_customer_contract(uuid),
  apticket.archive_supplier_contract(uuid) from public,anon,service_role;
grant execute on function apticket.archive_customer_contract(uuid),
  apticket.archive_supplier_contract(uuid) to authenticated;

-- As dimensoes sao necessarias nas telas que originam ou revisam movimentos.
drop policy if exists financial_area_read_guard on apticket.financial_categories;
drop policy if exists financial_area_read_guard on apticket.financial_cost_centers;
drop policy if exists financial_area_read_guard on apticket.financial_entry_classifications;
create policy financial_area_read_guard on apticket.financial_categories
as restrictive for select to authenticated using (
  apticket.has_permission(auth.uid(),'contratos','view')
  or apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
  or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
  or apticket.has_permission(auth.uid(),'financeiro_bancos','view')
  or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','view')
  or apticket.has_permission(auth.uid(),'financeiro_planejamento','view')
  or apticket.has_permission(auth.uid(),'financeiro_resultados','view')
  or apticket.has_permission(auth.uid(),'financeiro_fechamento','view')
);
create policy financial_area_read_guard on apticket.financial_cost_centers
as restrictive for select to authenticated using (
  apticket.has_permission(auth.uid(),'contratos','view')
  or apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
  or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
  or apticket.has_permission(auth.uid(),'financeiro_bancos','view')
  or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','view')
  or apticket.has_permission(auth.uid(),'financeiro_planejamento','view')
  or apticket.has_permission(auth.uid(),'financeiro_resultados','view')
  or apticket.has_permission(auth.uid(),'financeiro_fechamento','view')
);
create policy financial_area_read_guard on apticket.financial_entry_classifications
as restrictive for select to authenticated using (
  apticket.has_permission(auth.uid(),'financeiro_contas_receber','view')
  or apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view')
  or apticket.has_permission(auth.uid(),'financeiro_bancos','view')
  or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','view')
  or apticket.has_permission(auth.uid(),'financeiro_planejamento','view')
  or apticket.has_permission(auth.uid(),'financeiro_resultados','view')
  or apticket.has_permission(auth.uid(),'financeiro_fechamento','view')
);

-- Corrige o unico alerta do advisor pertencente ao schema APTicket.
alter function apticket.enforce_service_remote_only() set search_path=pg_catalog;

comment on column apticket.contracts.financial_category_id is
  'Categoria financeira padrao herdada pelos recebiveis gerados pelo contrato.';
comment on column apticket.contracts.cost_center_id is
  'Centro de custo padrao herdado pelos recebiveis gerados pelo contrato.';
comment on column apticket.supplier_contracts.financial_category_id is
  'Categoria financeira padrao herdada pelos pagamentos gerados pelo contrato.';
comment on column apticket.supplier_contracts.cost_center_id is
  'Centro de custo padrao herdado pelos pagamentos gerados pelo contrato.';

notify pgrst,'reload schema';
