-- Classificacoes financeiras hierarquicas, globais e aptas a lancamento.
alter table apticket.financial_categories
  add column is_global boolean not null default false,
  add column classification_type text not null default 'analytic'
    check (classification_type in ('analytic','synthetic'));

alter table apticket.financial_cost_centers
  add column is_global boolean not null default false,
  add column classification_type text not null default 'analytic'
    check (classification_type in ('analytic','synthetic'));

comment on column apticket.financial_categories.is_global is
  'Quando verdadeiro, a categoria pode ser usada por todas as empresas operadoras da tenant.';
comment on column apticket.financial_categories.classification_type is
  'Analitica aceita lancamentos; sintetica existe apenas para agrupamento.';
comment on column apticket.financial_cost_centers.is_global is
  'Quando verdadeiro, o centro pode ser usado por todas as empresas operadoras da tenant.';
comment on column apticket.financial_cost_centers.classification_type is
  'Analitico aceita lancamentos; sintetico existe apenas para agrupamento.';

create index financial_categories_global_scope_idx
  on apticket.financial_categories(tenant_id,code) where is_global and deleted_at is null;
create index financial_cost_centers_global_scope_idx
  on apticket.financial_cost_centers(tenant_id,code) where is_global and deleted_at is null;

-- As referencias guardam a empresa do movimento. Uma dimensao global pode ter
-- sido criada por outra operadora, portanto o vinculo deve preservar a tenant,
-- sem exigir que a empresa proprietaria seja a mesma do movimento.
alter table apticket.financial_categories
  add constraint financial_categories_id_tenant_key unique(id,tenant_id);
alter table apticket.financial_cost_centers
  add constraint financial_cost_centers_id_tenant_key unique(id,tenant_id);

do $$
declare item record;
begin
  for item in
    select conrelid::regclass as table_name,conname
    from pg_constraint
    where contype='f'
      and confrelid in ('apticket.financial_categories'::regclass,'apticket.financial_cost_centers'::regclass)
  loop
    execute format('alter table %s drop constraint %I',item.table_name,item.conname);
  end loop;
end $$;

alter table apticket.financial_entry_classifications
  add constraint entry_classification_category_tenant_fk
    foreign key(financial_category_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict,
  add constraint entry_classification_center_tenant_fk
    foreign key(cost_center_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;
alter table apticket.financial_budget_entries
  add constraint budget_category_tenant_fk
    foreign key(financial_category_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict,
  add constraint budget_center_tenant_fk
    foreign key(cost_center_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;
alter table apticket.contracts
  add constraint contracts_financial_category_tenant_fk
    foreign key(financial_category_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict,
  add constraint contracts_cost_center_tenant_fk
    foreign key(cost_center_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;
alter table apticket.supplier_contracts
  add constraint supplier_contracts_financial_category_tenant_fk
    foreign key(financial_category_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict,
  add constraint supplier_contracts_cost_center_tenant_fk
    foreign key(cost_center_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;
alter table apticket.funcionarios
  add constraint funcionarios_cost_center_tenant_fk
    foreign key(centro_custo_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;
alter table apticket.funcionario_eventos_financeiros
  add constraint funcionario_eventos_category_tenant_fk
    foreign key(financial_category_id,tenant_id) references apticket.financial_categories(id,tenant_id) on delete restrict,
  add constraint funcionario_eventos_center_tenant_fk
    foreign key(cost_center_id,tenant_id) references apticket.financial_cost_centers(id,tenant_id) on delete restrict;

create function apticket.has_financial_tenant_scope(_tenant_id uuid,_write boolean default false)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select _tenant_id=(select apticket.current_tenant_id())
    and (select apticket.has_permission(auth.uid(),'financeiro','view'))
    and (not _write or (select apticket.has_permission(auth.uid(),'financeiro','edit')))
    and (
      exists (
        select 1 from apticket.user_roles user_role
        join apticket.roles role on role.id=user_role.role_id and role.tenant_id=user_role.tenant_id
        where user_role.user_id=auth.uid() and user_role.tenant_id=_tenant_id
          and role.name in ('Admin','Financeiro')
      )
      or exists (
        select 1 from apticket.financial_access access
        where access.tenant_id=_tenant_id and access.user_id=auth.uid()
          and access.deleted_at is null and (not _write or access.can_write)
      )
    );
$$;
revoke all on function apticket.has_financial_tenant_scope(uuid,boolean) from public,anon;
grant execute on function apticket.has_financial_tenant_scope(uuid,boolean) to authenticated,service_role;

drop policy if exists financial_classification_read on apticket.financial_categories;
drop policy if exists financial_classification_read on apticket.financial_cost_centers;
create policy financial_classification_read on apticket.financial_categories
  for select to authenticated using (
    apticket.has_financial_scope(tenant_id,operating_company_id)
    or (is_global and apticket.has_financial_tenant_scope(tenant_id))
  );
create policy financial_classification_read on apticket.financial_cost_centers
  for select to authenticated using (
    apticket.has_financial_scope(tenant_id,operating_company_id)
    or (is_global and apticket.has_financial_tenant_scope(tenant_id))
  );

drop function apticket.save_financial_cost_center(uuid,uuid,text,text,text);
create function apticket.save_financial_cost_center(
  p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_description text default null,
  p_is_global boolean default false,p_is_active boolean default true,
  p_classification_type text default 'analytic'
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; current_row apticket.financial_cost_centers; begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar centros de custo.';
  end if;
  if coalesce(btrim(p_code),'') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
    or length(btrim(coalesce(p_name,''))) not between 2 and 150
    or p_classification_type not in ('analytic','synthetic') then
    raise exception using errcode='23514',message='Informe codigo no formato 99.99.9999, nome e tipo validos para o centro de custo.';
  end if;
  if exists(
    select 1 from apticket.financial_cost_centers item
    where item.tenant_id=v_tenant and item.id is distinct from p_id and item.deleted_at is null
      and lower(item.code)=lower(btrim(p_code))
      and (item.is_global or p_is_global or item.operating_company_id=p_operating_company_id)
  ) then
    raise exception using errcode='23505',message='Ja existe um centro de custo com este codigo no escopo informado.';
  end if;
  if p_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.financial_cost_centers(
      id,tenant_id,operating_company_id,code,name,description,is_global,is_active,classification_type,created_by,updated_by
    ) values(
      v_id,v_tenant,p_operating_company_id,btrim(p_code),btrim(p_name),nullif(btrim(p_description),''),
      p_is_global,p_is_active,p_classification_type,auth.uid(),auth.uid()
    );
  else
    select * into current_row from apticket.financial_cost_centers
      where id=p_id and tenant_id=v_tenant and deleted_at is null for update;
    if not found or (current_row.operating_company_id<>p_operating_company_id and not current_row.is_global) then
      raise exception using errcode='P0002',message='Centro de custo nao encontrado.';
    end if;
    if exists(select 1 from apticket.financial_entry_classifications where cost_center_id=p_id)
      and row(current_row.code,current_row.name,current_row.description,current_row.is_global,current_row.classification_type)
        is distinct from row(btrim(p_code),btrim(p_name),nullif(btrim(p_description),''),p_is_global,p_classification_type) then
      raise exception using errcode='23514',message='Este centro de custo ja foi utilizado; somente o status Ativo pode ser alterado.';
    end if;
    update apticket.financial_cost_centers set code=btrim(p_code),name=btrim(p_name),
      description=nullif(btrim(p_description),''),is_global=p_is_global,is_active=p_is_active,
      classification_type=p_classification_type,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id;
    v_id:=p_id;
  end if;
  return v_id;
end $$;

drop function apticket.save_financial_category(uuid,uuid,text,text,text,text);
create function apticket.save_financial_category(
  p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_direction text,
  p_description text default null,p_is_global boolean default false,p_is_active boolean default true,
  p_classification_type text default 'analytic'
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; current_row apticket.financial_categories; begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar categorias.';
  end if;
  if coalesce(btrim(p_code),'') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
    or length(btrim(coalesce(p_name,''))) not between 2 and 150
    or p_direction not in ('inflow','outflow','both')
    or p_classification_type not in ('analytic','synthetic') then
    raise exception using errcode='23514',message='Informe codigo no formato 99.99.9999, nome, natureza e tipo validos para a categoria.';
  end if;
  if exists(
    select 1 from apticket.financial_categories item
    where item.tenant_id=v_tenant and item.id is distinct from p_id and item.deleted_at is null
      and lower(item.code)=lower(btrim(p_code))
      and (item.is_global or p_is_global or item.operating_company_id=p_operating_company_id)
  ) then
    raise exception using errcode='23505',message='Ja existe uma categoria com este codigo no escopo informado.';
  end if;
  if p_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.financial_categories(
      id,tenant_id,operating_company_id,code,name,direction,description,is_global,is_active,
      classification_type,created_by,updated_by
    ) values(
      v_id,v_tenant,p_operating_company_id,btrim(p_code),btrim(p_name),p_direction,
      nullif(btrim(p_description),''),p_is_global,p_is_active,p_classification_type,auth.uid(),auth.uid()
    );
  else
    select * into current_row from apticket.financial_categories
      where id=p_id and tenant_id=v_tenant and deleted_at is null for update;
    if not found or (current_row.operating_company_id<>p_operating_company_id and not current_row.is_global) then
      raise exception using errcode='P0002',message='Categoria financeira nao encontrada.';
    end if;
    if exists(select 1 from apticket.financial_entry_classifications where financial_category_id=p_id)
      and row(current_row.code,current_row.name,current_row.direction,current_row.description,current_row.is_global,current_row.classification_type)
        is distinct from row(btrim(p_code),btrim(p_name),p_direction,nullif(btrim(p_description),''),p_is_global,p_classification_type) then
      raise exception using errcode='23514',message='Esta categoria ja foi utilizada; somente o status Ativo pode ser alterado.';
    end if;
    update apticket.financial_categories set code=btrim(p_code),name=btrim(p_name),direction=p_direction,
      description=nullif(btrim(p_description),''),is_global=p_is_global,is_active=p_is_active,
      classification_type=p_classification_type,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id;
    v_id:=p_id;
  end if;
  return v_id;
end $$;

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
  else raise exception using errcode='22023',message='Origem financeira invalida.';
  end if;
  if v_tenant is null or v_company is null or v_actual_type<>p_source_type then
    raise exception using errcode='P0002',message='Movimento financeiro nao encontrado nesta origem.';
  end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,v_company,true) or not (
    apticket.has_permission(auth.uid(),v_module,'edit')
    or apticket.has_permission(auth.uid(),'financeiro_fluxo_caixa','edit')
  ) then raise exception using errcode='42501',message='Sem permissao financeira para classificar este movimento.';
  end if;
  select * into category from apticket.financial_categories where id=p_category_id
    and tenant_id=v_tenant and (operating_company_id=v_company or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  if not found or category.direction not in (v_direction,'both') then
    raise exception using errcode='23514',message='Selecione uma categoria analitica ativa compativel com o movimento.';
  end if;
  select * into center from apticket.financial_cost_centers where id=p_cost_center_id
    and tenant_id=v_tenant and (operating_company_id=v_company or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um centro de custo analitico ativo desta empresa.';
  end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.'; end if;
  update apticket.financial_entry_classifications set replaced_at=clock_timestamp()
    where source_type=p_source_type and source_id=p_source_id and replaced_at is null;
  insert into apticket.financial_entry_classifications(id,tenant_id,operating_company_id,source_type,
    source_id,direction,financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,notes,classified_by,classified_by_name)
  values(v_id,v_tenant,v_company,p_source_type,p_source_id,v_direction,category.id,category.code,
    category.name,center.id,center.code,center.name,nullif(btrim(p_notes),''),auth.uid(),v_actor_name);
  return v_id;
end $$;

create or replace function apticket_finance_private.validate_contract_dimensions()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_direction text:=tg_argv[0]; begin
  if new.financial_category_id is null and new.cost_center_id is null then return new; end if;
  if new.financial_category_id is null or new.cost_center_id is null then
    raise exception using errcode='23514',message='Informe a categoria financeira e o centro de custo em conjunto.';
  end if;
  perform 1 from apticket.financial_categories category
    where category.id=new.financial_category_id and category.tenant_id=new.tenant_id
      and (category.operating_company_id=new.operating_company_id or category.is_global)
      and category.classification_type='analytic' and category.is_active and category.deleted_at is null
      and category.direction in (v_direction,'both');
  if not found then raise exception using errcode='23514',message='Selecione uma categoria analitica ativa e compativel com o contrato.'; end if;
  perform 1 from apticket.financial_cost_centers center
    where center.id=new.cost_center_id and center.tenant_id=new.tenant_id
      and (center.operating_company_id=new.operating_company_id or center.is_global)
      and center.classification_type='analytic' and center.is_active and center.deleted_at is null;
  if not found then raise exception using errcode='23514',message='Selecione um centro de custo analitico ativo desta empresa.'; end if;
  return new;
end $$;

create or replace function apticket_finance_private.apply_contract_default_classification()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
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
end $$;

create or replace function apticket.save_financial_budget_entry(
  p_operating_company_id uuid,p_period_month date,p_direction text,p_category_id uuid,
  p_cost_center_id uuid,p_budgeted_amount numeric,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid; category apticket.financial_categories; center apticket.financial_cost_centers;
  v_actor_name text; v_revision integer; v_id uuid:=gen_random_uuid();
begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para alterar o orcamento.';
  end if;
  if p_period_month is null or p_period_month<>date_trunc('month',p_period_month)::date
    or extract(year from p_period_month) not between 2000 and 2100 then
    raise exception using errcode='23514',message='Informe uma competencia mensal valida.';
  end if;
  if p_direction not in ('inflow','outflow') then
    raise exception using errcode='23514',message='Informe uma natureza valida para o orcamento.';
  end if;
  if p_budgeted_amount is null or p_budgeted_amount<=0 or p_budgeted_amount>999999999999.99 then
    raise exception using errcode='23514',message='Informe um valor orcado maior que zero.';
  end if;
  if p_notes is not null and length(btrim(p_notes))>1000 then
    raise exception using errcode='22001',message='As observacoes devem ter no maximo 1000 caracteres.';
  end if;
  select * into category from apticket.financial_categories where id=p_category_id
    and tenant_id=v_tenant and (operating_company_id=p_operating_company_id or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  if not found or category.direction not in (p_direction,'both') then
    raise exception using errcode='23514',message='Selecione uma categoria analitica ativa compativel com a natureza.';
  end if;
  select * into center from apticket.financial_cost_centers where id=p_cost_center_id
    and tenant_id=v_tenant and (operating_company_id=p_operating_company_id or is_global)
    and classification_type='analytic' and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um centro de custo analitico ativo desta empresa.';
  end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.'; end if;
  select coalesce(max(revision),0)+1 into v_revision from apticket.financial_budget_entries
    where tenant_id=v_tenant and operating_company_id=p_operating_company_id
      and period_month=p_period_month and direction=p_direction
      and financial_category_id=p_category_id and cost_center_id=p_cost_center_id;
  update apticket.financial_budget_entries set replaced_at=clock_timestamp()
    where tenant_id=v_tenant and operating_company_id=p_operating_company_id
      and period_month=p_period_month and direction=p_direction
      and financial_category_id=p_category_id and cost_center_id=p_cost_center_id and replaced_at is null;
  insert into apticket.financial_budget_entries(
    id,tenant_id,operating_company_id,period_month,direction,
    financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,budgeted_amount,notes,
    revision,created_by,created_by_name
  ) values(
    v_id,v_tenant,p_operating_company_id,p_period_month,p_direction,
    category.id,category.code,category.name,center.id,center.code,center.name,
    round(p_budgeted_amount,2),nullif(btrim(p_notes),''),v_revision,auth.uid(),v_actor_name
  );
  return v_id;
end $$;

-- Mantem as assinaturas acessiveis somente pelos papeis esperados.
revoke all on function apticket.save_financial_cost_center(uuid,uuid,text,text,text,boolean,boolean,text),
  apticket.save_financial_category(uuid,uuid,text,text,text,text,boolean,boolean,text)
  from public,anon,service_role;
grant execute on function apticket.save_financial_cost_center(uuid,uuid,text,text,text,boolean,boolean,text),
  apticket.save_financial_category(uuid,uuid,text,text,text,text,boolean,boolean,text)
  to authenticated;
revoke all on function apticket_finance_private.validate_contract_dimensions()
  from public,anon,authenticated,service_role;
revoke all on function apticket_finance_private.apply_contract_default_classification()
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
