-- Fatia 23: centros de custo, categorias e classificacao versionada do fluxo.
create table apticket.financial_cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  code text not null check (length(btrim(code)) between 1 and 30),
  name text not null check (length(btrim(name)) between 2 and 150),
  description text check (description is null or length(btrim(description)) between 1 and 1000),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key(updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index financial_cost_center_code_key
  on apticket.financial_cost_centers(tenant_id,operating_company_id,lower(code))
  where deleted_at is null;

create table apticket.financial_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  code text not null check (length(btrim(code)) between 1 and 30),
  name text not null check (length(btrim(name)) between 2 and 150),
  direction text not null check (direction in ('inflow','outflow','both')),
  description text check (description is null or length(btrim(description)) between 1 and 1000),
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key(updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index financial_category_code_key
  on apticket.financial_categories(tenant_id,operating_company_id,lower(code))
  where deleted_at is null;

create table apticket.financial_entry_classifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  source_type text not null check(source_type in
    ('measurement_receivable','recurring_receivable','supplier_payable')),
  source_id uuid not null,
  direction text not null check(direction in ('inflow','outflow')),
  financial_category_id uuid not null,
  financial_category_code text not null,
  financial_category_name text not null,
  cost_center_id uuid not null,
  cost_center_code text not null,
  cost_center_name text not null,
  notes text check(notes is null or length(btrim(notes)) between 1 and 1000),
  classified_by uuid,
  classified_by_name text not null,
  classified_at timestamptz not null default clock_timestamp(),
  replaced_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(financial_category_id,tenant_id,operating_company_id)
    references apticket.financial_categories(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(cost_center_id,tenant_id,operating_company_id)
    references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(classified_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index financial_entry_current_classification_key
  on apticket.financial_entry_classifications(source_type,source_id) where replaced_at is null;
create index financial_entry_classification_scope_idx
  on apticket.financial_entry_classifications(tenant_id,operating_company_id,classified_at desc);

do $$ declare t text; begin
  foreach t in array array['financial_cost_centers','financial_categories','financial_entry_classifications'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy financial_classification_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger financial_classification_no_delete before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger financial_classification_no_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger financial_classification_audit after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create function apticket_finance_private.guard_financial_dimension()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if row(new.tenant_id,new.operating_company_id,new.created_by,new.created_at)
    is distinct from row(old.tenant_id,old.operating_company_id,old.created_by,old.created_at) then
    raise exception using errcode='23514',message='O escopo desta classificacao nao pode ser alterado.';
  end if;
  return new;
end $$;
create trigger guard_financial_cost_center before update on apticket.financial_cost_centers
  for each row execute function apticket_finance_private.guard_financial_dimension();
create trigger guard_financial_category before update on apticket.financial_categories
  for each row execute function apticket_finance_private.guard_financial_dimension();

create function apticket_finance_private.guard_entry_classification()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-'replaced_at' is distinct from to_jsonb(old)-'replaced_at'
    or old.replaced_at is not null or new.replaced_at is null then
    raise exception using errcode='23514',message='O historico de classificacao e imutavel.';
  end if;
  return new;
end $$;
create trigger guard_entry_classification before update on apticket.financial_entry_classifications
  for each row execute function apticket_finance_private.guard_entry_classification();

create function apticket.save_financial_cost_center(
  p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_description text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar centros de custo.';
  end if;
  if length(btrim(coalesce(p_code,''))) not between 1 and 30
    or length(btrim(coalesce(p_name,''))) not between 2 and 150 then
    raise exception using errcode='23514',message='Informe codigo e nome validos para o centro de custo.';
  end if;
  if p_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name,description,
      created_by,updated_by) values(v_id,v_tenant,p_operating_company_id,upper(btrim(p_code)),btrim(p_name),
      nullif(btrim(p_description),''),auth.uid(),auth.uid());
  else
    select id into v_id from apticket.financial_cost_centers where id=p_id and tenant_id=v_tenant
      and operating_company_id=p_operating_company_id and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Centro de custo nao encontrado.'; end if;
    if exists(select 1 from apticket.financial_entry_classifications where cost_center_id=v_id) then
      raise exception using errcode='23514',message='Este centro de custo ja foi utilizado e nao pode ser alterado. Crie um novo cadastro.';
    end if;
    update apticket.financial_cost_centers set code=upper(btrim(p_code)),name=btrim(p_name),
      description=nullif(btrim(p_description),''),is_active=true,updated_by=auth.uid(),
      updated_at=clock_timestamp() where id=v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception using errcode='23505',message='Ja existe um centro de custo com este codigo.';
end $$;

create function apticket.save_financial_category(
  p_id uuid,p_operating_company_id uuid,p_code text,p_name text,p_direction text,
  p_description text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_id uuid; begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para configurar categorias.';
  end if;
  if length(btrim(coalesce(p_code,''))) not between 1 and 30
    or length(btrim(coalesce(p_name,''))) not between 2 and 150
    or p_direction not in ('inflow','outflow','both') then
    raise exception using errcode='23514',message='Informe codigo, nome e natureza validos para a categoria.';
  end if;
  if p_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction,
      description,created_by,updated_by) values(v_id,v_tenant,p_operating_company_id,
      upper(btrim(p_code)),btrim(p_name),p_direction,nullif(btrim(p_description),''),auth.uid(),auth.uid());
  else
    select id into v_id from apticket.financial_categories where id=p_id and tenant_id=v_tenant
      and operating_company_id=p_operating_company_id and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Categoria financeira nao encontrada.'; end if;
    if exists(select 1 from apticket.financial_entry_classifications where financial_category_id=v_id) then
      raise exception using errcode='23514',message='Esta categoria ja foi utilizada e nao pode ser alterada. Crie um novo cadastro.';
    end if;
    update apticket.financial_categories set code=upper(btrim(p_code)),name=btrim(p_name),
      direction=p_direction,description=nullif(btrim(p_description),''),is_active=true,
      updated_by=auth.uid(),updated_at=clock_timestamp() where id=v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception using errcode='23505',message='Ja existe uma categoria com este codigo.';
end $$;

create function apticket.archive_financial_dimension(p_dimension text,p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_company uuid; begin
  if p_dimension='cost_center' then
    select tenant_id,operating_company_id into v_tenant,v_company from apticket.financial_cost_centers
      where id=p_id and deleted_at is null for update;
  elsif p_dimension='category' then
    select tenant_id,operating_company_id into v_tenant,v_company from apticket.financial_categories
      where id=p_id and deleted_at is null for update;
  else raise exception using errcode='22023',message='Tipo de cadastro financeiro invalido.';
  end if;
  if not found then raise exception using errcode='P0002',message='Cadastro financeiro nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,v_company,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para arquivar este cadastro.';
  end if;
  if p_dimension='cost_center' then
    update apticket.financial_cost_centers set is_active=false,deleted_at=clock_timestamp(),
      updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
  else
    update apticket.financial_categories set is_active=false,deleted_at=clock_timestamp(),
      updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
  end if;
  return true;
end $$;

create function apticket.classify_financial_entry(
  p_source_type text,p_source_id uuid,p_category_id uuid,p_cost_center_id uuid,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid; v_company uuid; v_direction text; v_actual_type text;
  category apticket.financial_categories; center apticket.financial_cost_centers;
  v_actor_name text; v_id uuid:=gen_random_uuid();
begin
  if p_source_type in ('measurement_receivable','recurring_receivable') then
    select r.tenant_id,r.operating_company_id,
      case when r.medicao_id is not null then 'measurement_receivable' else 'recurring_receivable' end
      into v_tenant,v_company,v_actual_type from apticket.contas_receber r
      where r.id=p_source_id and r.deleted_at is null for update;
    v_direction:='inflow';
  elsif p_source_type='supplier_payable' then
    select p.tenant_id,p.operating_company_id,'supplier_payable' into v_tenant,v_company,v_actual_type
      from apticket.supplier_payables p where p.id=p_source_id and p.deleted_at is null for update;
    v_direction:='outflow';
  else raise exception using errcode='22023',message='Origem financeira invalida.';
  end if;
  if v_tenant is null or v_company is null or v_actual_type<>p_source_type then
    raise exception using errcode='P0002',message='Movimento financeiro nao encontrado nesta origem.';
  end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,v_company,true) then
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

create function apticket.clear_financial_entry_classification(p_source_type text,p_source_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare c apticket.financial_entry_classifications; begin
  select * into c from apticket.financial_entry_classifications where source_type=p_source_type
    and source_id=p_source_id and replaced_at is null for update;
  if not found then raise exception using errcode='P0002',message='Classificacao atual nao encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(c.tenant_id,c.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para remover esta classificacao.';
  end if;
  update apticket.financial_entry_classifications set replaced_at=clock_timestamp() where id=c.id;
  return true;
end $$;

create or replace view apticket.cash_flow_entries
with (security_invoker=true)
as
select
  receivable.tenant_id,receivable.operating_company_id,'inflow'::text as direction,
  case when receivable.medicao_id is not null then 'measurement_receivable'
       else 'recurring_receivable' end as source_type,
  receivable.id as source_id,receivable.documento_referencia as document_number,
  receivable.cliente_nome as counterparty_name,receivable.descricao as description,
  receivable.competencia as competence,receivable.vencimento_em as planned_date,
  case when receivable.valor_aberto<receivable.valor_original then receivable.updated_at::date end as realized_date,
  receivable.valor_original::numeric(14,2) as planned_amount,
  receivable.valor_aberto::numeric(14,2) as open_amount,
  (receivable.valor_original-receivable.valor_aberto)::numeric(14,2) as realized_amount,
  case when receivable.status_cobranca='cancelado' then 'cancelled'
    when receivable.valor_aberto=0 or receivable.status_cobranca='recebido' then 'realized'
    when receivable.vencimento_em<current_date then 'overdue' else 'pending' end as cash_status,
  receivable.status_cobranca::text as source_status,null::text as reconciliation_status,
  null::numeric(14,2) as difference_amount,receivable.created_at,receivable.updated_at,
  classification.id as classification_id,classification.financial_category_id,
  classification.financial_category_code,classification.financial_category_name,
  classification.cost_center_id,classification.cost_center_code,classification.cost_center_name
from apticket.contas_receber receivable
left join apticket.financial_entry_classifications classification on
  classification.source_id=receivable.id and classification.source_type=
    case when receivable.medicao_id is not null then 'measurement_receivable' else 'recurring_receivable' end
  and classification.replaced_at is null
where receivable.deleted_at is null and receivable.operating_company_id is not null
union all
select
  payable.tenant_id,payable.operating_company_id,'outflow'::text,'supplier_payable'::text,
  payable.id,payable.document_number,coalesce(payable.terms_snapshot->>'supplier_name','Fornecedor'),
  payable.description,payable.cycle_start,coalesce(payment.scheduled_date,payable.due_date),
  payment.paid_at::date,payable.total_amount::numeric(14,2),
  case when payable.status='paid' then 0 else payable.total_amount end::numeric(14,2),
  coalesce(payment.paid_amount,0)::numeric(14,2),
  case when payable.status='cancelled' then 'cancelled' when payable.status='paid' then 'realized'
    when coalesce(payment.scheduled_date,payable.due_date)<current_date then 'overdue' else 'pending' end,
  payable.status,payment.reconciliation_status,payment.difference_amount,payable.created_at,
  coalesce(payment.updated_at,payable.created_at),classification.id,classification.financial_category_id,
  classification.financial_category_code,classification.financial_category_name,
  classification.cost_center_id,classification.cost_center_code,classification.cost_center_name
from apticket.supplier_payables payable
left join lateral (select p.scheduled_date,p.paid_at,p.paid_amount,p.reconciliation_status,
  p.difference_amount,p.updated_at from apticket.supplier_payments p
  where p.supplier_payable_id=payable.id and p.status in ('scheduled','paid') limit 1) payment on true
left join apticket.financial_entry_classifications classification on
  classification.source_id=payable.id and classification.source_type='supplier_payable'
  and classification.replaced_at is null
where payable.deleted_at is null;

revoke all on apticket.cash_flow_entries from public,anon,authenticated,service_role;
grant select on apticket.cash_flow_entries to authenticated,service_role;

revoke all on function apticket.save_financial_cost_center(uuid,uuid,text,text,text),
  apticket.save_financial_category(uuid,uuid,text,text,text,text),
  apticket.archive_financial_dimension(text,uuid),
  apticket.classify_financial_entry(text,uuid,uuid,uuid,text),
  apticket.clear_financial_entry_classification(text,uuid) from public,anon;
grant execute on function apticket.save_financial_cost_center(uuid,uuid,text,text,text),
  apticket.save_financial_category(uuid,uuid,text,text,text,text),
  apticket.archive_financial_dimension(text,uuid),
  apticket.classify_financial_entry(text,uuid,uuid,uuid,text),
  apticket.clear_financial_entry_classification(text,uuid) to authenticated;
revoke all on function apticket_finance_private.guard_financial_dimension(),
  apticket_finance_private.guard_entry_classification() from public,anon,authenticated,service_role;

comment on table apticket.financial_cost_centers is 'Centros de custo da empresa operadora.';
comment on table apticket.financial_categories is 'Categorias de entrada e saida do fluxo financeiro.';
comment on table apticket.financial_entry_classifications is 'Historico versionado de classificacoes dos movimentos financeiros.';
notify pgrst,'reload schema';
