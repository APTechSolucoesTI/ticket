-- Fatia 24: orcamento mensal versionado e comparativo orcado x realizado.
create table apticket.financial_budget_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  period_month date not null check (period_month=date_trunc('month',period_month)::date),
  direction text not null check (direction in ('inflow','outflow')),
  financial_category_id uuid not null,
  financial_category_code text not null,
  financial_category_name text not null,
  cost_center_id uuid not null,
  cost_center_code text not null,
  cost_center_name text not null,
  budgeted_amount numeric(14,2) not null check (budgeted_amount>0),
  notes text check (notes is null or length(btrim(notes)) between 1 and 1000),
  revision integer not null check (revision>0),
  created_by uuid,
  created_by_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  replaced_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(financial_category_id,tenant_id,operating_company_id)
    references apticket.financial_categories(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(cost_center_id,tenant_id,operating_company_id)
    references apticket.financial_cost_centers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index financial_budget_current_entry_key
  on apticket.financial_budget_entries(
    tenant_id,operating_company_id,period_month,direction,financial_category_id,cost_center_id
  ) where replaced_at is null;
create index financial_budget_scope_period_idx
  on apticket.financial_budget_entries(tenant_id,operating_company_id,period_month)
  where replaced_at is null;
create index financial_budget_history_idx
  on apticket.financial_budget_entries(
    tenant_id,operating_company_id,period_month,direction,financial_category_id,cost_center_id,revision desc
  );

alter table apticket.financial_budget_entries enable row level security;
revoke all on apticket.financial_budget_entries from public,anon,authenticated,service_role;
grant select on apticket.financial_budget_entries to authenticated,service_role;
create policy financial_budget_read on apticket.financial_budget_entries for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger financial_budget_no_delete before delete on apticket.financial_budget_entries
  for each row execute function apticket_finance_private.guard_record();
create trigger financial_budget_no_truncate before truncate on apticket.financial_budget_entries
  for each statement execute function apticket_finance_private.guard_record();
create trigger financial_budget_audit after insert or update on apticket.financial_budget_entries
  for each row execute function apticket_finance_private.audit_record();

create function apticket_finance_private.guard_budget_entry()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-'replaced_at' is distinct from to_jsonb(old)-'replaced_at'
    or old.replaced_at is not null or new.replaced_at is null then
    raise exception using errcode='23514',message='O historico do orcamento e imutavel.';
  end if;
  return new;
end $$;
create trigger guard_financial_budget_entry before update on apticket.financial_budget_entries
  for each row execute function apticket_finance_private.guard_budget_entry();

create function apticket.save_financial_budget_entry(
  p_operating_company_id uuid,
  p_period_month date,
  p_direction text,
  p_category_id uuid,
  p_cost_center_id uuid,
  p_budgeted_amount numeric,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid;
  category apticket.financial_categories;
  center apticket.financial_cost_centers;
  v_actor_name text;
  v_revision integer;
  v_id uuid:=gen_random_uuid();
begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then
    raise exception using errcode='P0002',message='Empresa operadora nao encontrada.';
  end if;
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
    and tenant_id=v_tenant and operating_company_id=p_operating_company_id
    and is_active and deleted_at is null;
  if not found or category.direction not in (p_direction,'both') then
    raise exception using errcode='23514',message='Selecione uma categoria ativa compativel com a natureza.';
  end if;
  select * into center from apticket.financial_cost_centers where id=p_cost_center_id
    and tenant_id=v_tenant and operating_company_id=p_operating_company_id
    and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um centro de custo ativo desta empresa.';
  end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid()
    and tenant_id=v_tenant and is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.';
  end if;
  select coalesce(max(revision),0)+1 into v_revision from apticket.financial_budget_entries
    where tenant_id=v_tenant and operating_company_id=p_operating_company_id
      and period_month=p_period_month and direction=p_direction
      and financial_category_id=p_category_id and cost_center_id=p_cost_center_id;
  update apticket.financial_budget_entries set replaced_at=clock_timestamp()
    where tenant_id=v_tenant and operating_company_id=p_operating_company_id
      and period_month=p_period_month and direction=p_direction
      and financial_category_id=p_category_id and cost_center_id=p_cost_center_id
      and replaced_at is null;
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

create function apticket.clear_financial_budget_entry(p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare entry apticket.financial_budget_entries; begin
  select * into entry from apticket.financial_budget_entries
    where id=p_id and replaced_at is null for update;
  if not found then
    raise exception using errcode='P0002',message='Item vigente do orcamento nao encontrado.';
  end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(entry.tenant_id,entry.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para remover este orcamento.';
  end if;
  update apticket.financial_budget_entries set replaced_at=clock_timestamp() where id=entry.id;
  return true;
end $$;

create view apticket.financial_budget_variance
with (security_invoker=true)
as
with budget as (
  select tenant_id,operating_company_id,period_month,direction,
    financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,id as budget_entry_id,
    budgeted_amount,revision,created_by_name,created_at
  from apticket.financial_budget_entries where replaced_at is null
), planned as (
  select tenant_id,operating_company_id,date_trunc('month',planned_date)::date as period_month,
    direction,financial_category_id,max(financial_category_code) as financial_category_code,
    max(financial_category_name) as financial_category_name,cost_center_id,
    max(cost_center_code) as cost_center_code,max(cost_center_name) as cost_center_name,
    sum(planned_amount)::numeric(14,2) as planned_amount
  from apticket.cash_flow_entries where cash_status<>'cancelled'
  group by tenant_id,operating_company_id,date_trunc('month',planned_date)::date,
    direction,financial_category_id,cost_center_id
), realized as (
  select tenant_id,operating_company_id,date_trunc('month',realized_date)::date as period_month,
    direction,financial_category_id,max(financial_category_code) as financial_category_code,
    max(financial_category_name) as financial_category_name,cost_center_id,
    max(cost_center_code) as cost_center_code,max(cost_center_name) as cost_center_name,
    sum(realized_amount)::numeric(14,2) as realized_amount
  from apticket.cash_flow_entries
  where realized_date is not null and realized_amount<>0 and cash_status<>'cancelled'
  group by tenant_id,operating_company_id,date_trunc('month',realized_date)::date,
    direction,financial_category_id,cost_center_id
), keys as (
  select tenant_id,operating_company_id,period_month,direction,financial_category_id,cost_center_id from budget
  union
  select tenant_id,operating_company_id,period_month,direction,financial_category_id,cost_center_id from planned
  union
  select tenant_id,operating_company_id,period_month,direction,financial_category_id,cost_center_id from realized
)
select keys.tenant_id,keys.operating_company_id,keys.period_month,keys.direction,
  keys.financial_category_id,
  coalesce(budget.financial_category_code,planned.financial_category_code,realized.financial_category_code)
    as financial_category_code,
  coalesce(budget.financial_category_name,planned.financial_category_name,realized.financial_category_name)
    as financial_category_name,
  keys.cost_center_id,
  coalesce(budget.cost_center_code,planned.cost_center_code,realized.cost_center_code) as cost_center_code,
  coalesce(budget.cost_center_name,planned.cost_center_name,realized.cost_center_name) as cost_center_name,
  budget.budget_entry_id,coalesce(budget.budgeted_amount,0)::numeric(14,2) as budgeted_amount,
  coalesce(planned.planned_amount,0)::numeric(14,2) as planned_amount,
  coalesce(realized.realized_amount,0)::numeric(14,2) as realized_amount,
  (coalesce(realized.realized_amount,0)-coalesce(budget.budgeted_amount,0))::numeric(14,2)
    as variance_amount,
  case when coalesce(budget.budgeted_amount,0)=0 then null
    else round((coalesce(realized.realized_amount,0)-budget.budgeted_amount)
      /budget.budgeted_amount*100,2) end as variance_percent,
  budget.revision,budget.created_by_name,budget.created_at
from keys
left join budget on budget.tenant_id=keys.tenant_id
  and budget.operating_company_id=keys.operating_company_id
  and budget.period_month=keys.period_month and budget.direction=keys.direction
  and budget.financial_category_id is not distinct from keys.financial_category_id
  and budget.cost_center_id is not distinct from keys.cost_center_id
left join planned on planned.tenant_id=keys.tenant_id
  and planned.operating_company_id=keys.operating_company_id
  and planned.period_month=keys.period_month and planned.direction=keys.direction
  and planned.financial_category_id is not distinct from keys.financial_category_id
  and planned.cost_center_id is not distinct from keys.cost_center_id
left join realized on realized.tenant_id=keys.tenant_id
  and realized.operating_company_id=keys.operating_company_id
  and realized.period_month=keys.period_month and realized.direction=keys.direction
  and realized.financial_category_id is not distinct from keys.financial_category_id
  and realized.cost_center_id is not distinct from keys.cost_center_id;

revoke all on apticket.financial_budget_variance from public,anon,authenticated,service_role;
grant select on apticket.financial_budget_variance to authenticated,service_role;
revoke all on function apticket.save_financial_budget_entry(uuid,date,text,uuid,uuid,numeric,text),
  apticket.clear_financial_budget_entry(uuid) from public,anon;
grant execute on function apticket.save_financial_budget_entry(uuid,date,text,uuid,uuid,numeric,text),
  apticket.clear_financial_budget_entry(uuid) to authenticated;
revoke all on function apticket_finance_private.guard_budget_entry()
  from public,anon,authenticated,service_role;

comment on table apticket.financial_budget_entries is
  'Historico versionado do orcamento mensal por categoria e centro de custo.';
comment on view apticket.financial_budget_variance is
  'Comparativo mensal entre orcado, previsto e realizado, respeitando o escopo financeiro.';
notify pgrst,'reload schema';
