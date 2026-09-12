-- Fatia 27: fechamento mensal com snapshot imutavel e reabertura auditada.
create table apticket.financial_period_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  period_month date not null check (period_month=date_trunc('month',period_month)::date),
  revision integer not null check (revision>0),
  status text not null default 'closed' check (status in ('closed','reopened')),
  revenue_budgeted numeric(14,2) not null,
  expense_budgeted numeric(14,2) not null,
  result_budgeted numeric(14,2) not null,
  revenue_planned numeric(14,2) not null,
  expense_planned numeric(14,2) not null,
  result_planned numeric(14,2) not null,
  revenue_realized numeric(14,2) not null,
  expense_realized numeric(14,2) not null,
  result_realized numeric(14,2) not null,
  snapshot_line_count integer not null check (snapshot_line_count>=0),
  close_notes text check (close_notes is null or length(btrim(close_notes)) between 1 and 1000),
  closed_by uuid,
  closed_by_name text not null,
  closed_at timestamptz not null default clock_timestamp(),
  reopened_by uuid,
  reopened_by_name text,
  reopen_reason text,
  reopened_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  unique(tenant_id,operating_company_id,period_month,revision),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(closed_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key(reopened_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check (
    (status='closed' and reopened_by is null and reopened_by_name is null
      and reopen_reason is null and reopened_at is null)
    or
    (status='reopened' and reopened_by is not null and reopened_by_name is not null
      and length(btrim(reopen_reason)) between 10 and 1000 and reopened_at is not null)
  )
);

create unique index financial_period_active_closure_key
  on apticket.financial_period_closures(tenant_id,operating_company_id,period_month)
  where status='closed';
create index financial_period_closure_scope_idx
  on apticket.financial_period_closures(tenant_id,operating_company_id,period_month desc,revision desc);

create table apticket.financial_period_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  closure_id uuid not null,
  tenant_id uuid not null,
  operating_company_id uuid not null,
  period_month date not null,
  direction text not null check (direction in ('inflow','outflow')),
  financial_category_id uuid,
  financial_category_code text,
  financial_category_name text,
  cost_center_id uuid,
  cost_center_code text,
  cost_center_name text,
  budget_entry_id uuid,
  budgeted_amount numeric(14,2) not null,
  planned_amount numeric(14,2) not null,
  realized_amount numeric(14,2) not null,
  favorable_variance_amount numeric(14,2) not null,
  favorable_variance_percent numeric,
  budget_revision integer,
  budget_created_by_name text,
  budget_created_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(id,tenant_id,operating_company_id),
  foreign key(closure_id,tenant_id,operating_company_id)
    references apticket.financial_period_closures(id,tenant_id,operating_company_id) on delete restrict,
  check (period_month=date_trunc('month',period_month)::date)
);
create index financial_period_snapshot_scope_idx
  on apticket.financial_period_snapshot_lines(tenant_id,operating_company_id,period_month,closure_id);

alter table apticket.financial_period_closures enable row level security;
alter table apticket.financial_period_snapshot_lines enable row level security;
revoke all on apticket.financial_period_closures,
  apticket.financial_period_snapshot_lines from public,anon,authenticated,service_role;
grant select on apticket.financial_period_closures,
  apticket.financial_period_snapshot_lines to authenticated,service_role;
create policy financial_period_closure_read on apticket.financial_period_closures
  for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));
create policy financial_period_snapshot_read on apticket.financial_period_snapshot_lines
  for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));

create function apticket_finance_private.guard_period_closure()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op in ('DELETE','TRUNCATE') then
    raise exception using errcode='23514',message='Fechamentos financeiros não permitem exclusão física.';
  end if;
  if old.status<>'closed' or new.status<>'reopened'
    or (to_jsonb(new)-array['status','reopened_by','reopened_by_name','reopen_reason','reopened_at'])
      is distinct from
      (to_jsonb(old)-array['status','reopened_by','reopened_by_name','reopen_reason','reopened_at']) then
    raise exception using errcode='23514',message='O fechamento é imutável. Utilize a reabertura controlada.';
  end if;
  return new;
end $$;
create trigger guard_financial_period_closure
  before update or delete on apticket.financial_period_closures
  for each row execute function apticket_finance_private.guard_period_closure();
create trigger guard_financial_period_closure_truncate
  before truncate on apticket.financial_period_closures
  for each statement execute function apticket_finance_private.guard_period_closure();
create trigger audit_financial_period_closure
  after insert or update on apticket.financial_period_closures
  for each row execute function apticket_finance_private.audit_record();

create function apticket_finance_private.guard_period_snapshot()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  raise exception using errcode='23514',message='As linhas do snapshot financeiro são imutáveis.';
end $$;
create trigger guard_financial_period_snapshot
  before update or delete on apticket.financial_period_snapshot_lines
  for each row execute function apticket_finance_private.guard_period_snapshot();
create trigger guard_financial_period_snapshot_truncate
  before truncate on apticket.financial_period_snapshot_lines
  for each statement execute function apticket_finance_private.guard_period_snapshot();

create function apticket_finance_private.period_is_closed(
  p_tenant_id uuid,p_operating_company_id uuid,p_period_month date
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(
    select 1 from apticket.financial_period_closures closure
    where closure.tenant_id=p_tenant_id
      and closure.operating_company_id=p_operating_company_id
      and closure.period_month=date_trunc('month',p_period_month)::date
      and closure.status='closed'
  )
$$;

create function apticket_finance_private.guard_closed_budget_period()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if apticket_finance_private.period_is_closed(
    new.tenant_id,new.operating_company_id,new.period_month
  ) then
    raise exception using errcode='23514',message='A competência está encerrada. Reabra o período antes de alterar o orçamento.';
  end if;
  return new;
end $$;
create trigger guard_closed_budget_period
  before insert or update on apticket.financial_budget_entries
  for each row execute function apticket_finance_private.guard_closed_budget_period();

create function apticket_finance_private.guard_closed_classification_period()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_planned date; v_realized date; begin
  if new.source_type in ('measurement_receivable','recurring_receivable') then
    select receivable.vencimento_em,
      case when receivable.valor_aberto<receivable.valor_original then receivable.updated_at::date end
      into v_planned,v_realized
    from apticket.contas_receber receivable where receivable.id=new.source_id;
  elsif new.source_type='supplier_payable' then
    select coalesce(payment.scheduled_date,payable.due_date),payment.paid_at::date
      into v_planned,v_realized
    from apticket.supplier_payables payable
    left join lateral (
      select candidate.scheduled_date,candidate.paid_at
      from apticket.supplier_payments candidate
      where candidate.supplier_payable_id=payable.id
        and candidate.status in ('scheduled','paid') limit 1
    ) payment on true
    where payable.id=new.source_id;
  end if;
  if (v_planned is not null and apticket_finance_private.period_is_closed(
      new.tenant_id,new.operating_company_id,v_planned))
    or (v_realized is not null and apticket_finance_private.period_is_closed(
      new.tenant_id,new.operating_company_id,v_realized)) then
    raise exception using errcode='23514',message='A competência está encerrada. Reabra o período antes de alterar a classificação.';
  end if;
  return new;
end $$;
create trigger guard_closed_classification_period
  before insert or update on apticket.financial_entry_classifications
  for each row execute function apticket_finance_private.guard_closed_classification_period();

create function apticket_finance_private.close_financial_period_internal(
  p_operating_company_id uuid,p_period_month date,p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  v_tenant uuid; v_actor_name text; v_id uuid:=gen_random_uuid(); v_revision integer;
  v_line_count integer; v_unclassified integer;
  v_revenue_budgeted numeric(14,2); v_expense_budgeted numeric(14,2);
  v_revenue_planned numeric(14,2); v_expense_planned numeric(14,2);
  v_revenue_realized numeric(14,2); v_expense_realized numeric(14,2);
begin
  select company.tenant_id into v_tenant from apticket.operating_companies company
    where company.id=p_operating_company_id and company.deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora não encontrada.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão financeira para encerrar esta competência.';
  end if;
  if p_period_month is null or p_period_month<>date_trunc('month',p_period_month)::date
    or p_period_month>date_trunc('month',current_date)::date then
    raise exception using errcode='23514',message='Selecione uma competência mensal atual ou anterior.';
  end if;
  if p_notes is not null and length(btrim(p_notes))>1000 then
    raise exception using errcode='22001',message='As observações devem ter no máximo 1000 caracteres.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operating_company_id::text||p_period_month::text,0));
  if apticket_finance_private.period_is_closed(v_tenant,p_operating_company_id,p_period_month) then
    raise exception using errcode='23505',message='Esta competência já está encerrada.';
  end if;
  select profile.name into v_actor_name from apticket.profiles profile
    where profile.id=auth.uid() and profile.tenant_id=v_tenant and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuário responsável não está ativo.';
  end if;
  select count(*) into v_unclassified from apticket.cash_flow_entries entry
    where entry.tenant_id=v_tenant and entry.operating_company_id=p_operating_company_id
      and entry.cash_status<>'cancelled'
      and (date_trunc('month',entry.planned_date)::date=p_period_month
        or date_trunc('month',entry.realized_date)::date=p_period_month)
      and (entry.financial_category_id is null or entry.cost_center_id is null)
      and (entry.planned_amount<>0 or entry.realized_amount<>0);
  if v_unclassified>0 then
    raise exception using errcode='23514',message=format(
      'Existem %s movimento(s) sem classificação completa nesta competência.',v_unclassified);
  end if;
  select count(*),
    coalesce(sum(variance.budgeted_amount) filter(where variance.direction='inflow'),0),
    coalesce(sum(variance.budgeted_amount) filter(where variance.direction='outflow'),0),
    coalesce(sum(variance.planned_amount) filter(where variance.direction='inflow'),0),
    coalesce(sum(variance.planned_amount) filter(where variance.direction='outflow'),0),
    coalesce(sum(variance.realized_amount) filter(where variance.direction='inflow'),0),
    coalesce(sum(variance.realized_amount) filter(where variance.direction='outflow'),0)
  into v_line_count,v_revenue_budgeted,v_expense_budgeted,v_revenue_planned,
    v_expense_planned,v_revenue_realized,v_expense_realized
  from apticket.financial_budget_variance variance
  where variance.tenant_id=v_tenant and variance.operating_company_id=p_operating_company_id
    and variance.period_month=p_period_month;
  if v_line_count=0 then
    raise exception using errcode='23514',message='Não existem valores financeiros para encerrar nesta competência.';
  end if;
  select coalesce(max(closure.revision),0)+1 into v_revision
  from apticket.financial_period_closures closure
  where closure.tenant_id=v_tenant and closure.operating_company_id=p_operating_company_id
    and closure.period_month=p_period_month;
  insert into apticket.financial_period_closures(
    id,tenant_id,operating_company_id,period_month,revision,
    revenue_budgeted,expense_budgeted,result_budgeted,
    revenue_planned,expense_planned,result_planned,
    revenue_realized,expense_realized,result_realized,snapshot_line_count,
    close_notes,closed_by,closed_by_name
  ) values(
    v_id,v_tenant,p_operating_company_id,p_period_month,v_revision,
    v_revenue_budgeted,v_expense_budgeted,v_revenue_budgeted-v_expense_budgeted,
    v_revenue_planned,v_expense_planned,v_revenue_planned-v_expense_planned,
    v_revenue_realized,v_expense_realized,v_revenue_realized-v_expense_realized,v_line_count,
    nullif(btrim(p_notes),''),auth.uid(),v_actor_name
  );
  insert into apticket.financial_period_snapshot_lines(
    closure_id,tenant_id,operating_company_id,period_month,direction,
    financial_category_id,financial_category_code,financial_category_name,
    cost_center_id,cost_center_code,cost_center_name,budget_entry_id,
    budgeted_amount,planned_amount,realized_amount,favorable_variance_amount,
    favorable_variance_percent,budget_revision,budget_created_by_name,budget_created_at
  )
  select v_id,v_tenant,p_operating_company_id,p_period_month,variance.direction,
    variance.financial_category_id,variance.financial_category_code,variance.financial_category_name,
    variance.cost_center_id,variance.cost_center_code,variance.cost_center_name,
    variance.budget_entry_id,variance.budgeted_amount,variance.planned_amount,
    variance.realized_amount,
    case when variance.direction='inflow' then variance.realized_amount-variance.budgeted_amount
      else variance.budgeted_amount-variance.realized_amount end,
    case when variance.budgeted_amount=0 then null
      when variance.direction='inflow' then round(
        (variance.realized_amount-variance.budgeted_amount)/variance.budgeted_amount*100,2)
      else round((variance.budgeted_amount-variance.realized_amount)/variance.budgeted_amount*100,2)
    end,variance.revision,variance.created_by_name,variance.created_at
  from apticket.financial_budget_variance variance
  where variance.tenant_id=v_tenant and variance.operating_company_id=p_operating_company_id
    and variance.period_month=p_period_month;
  return v_id;
end $$;

create function apticket_finance_private.reopen_financial_period_internal(
  p_closure_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare closure apticket.financial_period_closures; v_actor_name text; begin
  select * into closure from apticket.financial_period_closures current_closure
    where current_closure.id=p_closure_id and current_closure.status='closed' for update;
  if not found then
    raise exception using errcode='P0002',message='Fechamento ativo não encontrado.';
  end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(closure.tenant_id,closure.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão financeira para reabrir esta competência.';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 1000 then
    raise exception using errcode='23514',message='Informe uma justificativa com pelo menos 10 caracteres.';
  end if;
  select profile.name into v_actor_name from apticket.profiles profile
    where profile.id=auth.uid() and profile.tenant_id=closure.tenant_id and profile.is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuário responsável não está ativo.';
  end if;
  update apticket.financial_period_closures set status='reopened',reopened_by=auth.uid(),
    reopened_by_name=v_actor_name,reopen_reason=btrim(p_reason),reopened_at=clock_timestamp()
  where id=closure.id;
  return true;
end $$;

create function apticket.close_financial_period(
  p_operating_company_id uuid,p_period_month date,p_notes text default null
) returns uuid language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.close_financial_period_internal(
    p_operating_company_id,p_period_month,p_notes
  )
$$;
create function apticket.reopen_financial_period(p_closure_id uuid,p_reason text)
returns boolean language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.reopen_financial_period_internal(p_closure_id,p_reason)
$$;

create or replace view apticket.financial_management_statement
with (security_invoker=true)
as
with current_lines as (
  select variance.tenant_id,variance.operating_company_id,variance.period_month,
    variance.direction,variance.financial_category_id,variance.financial_category_code,
    variance.financial_category_name,variance.cost_center_id,variance.cost_center_code,
    variance.cost_center_name,variance.budget_entry_id,variance.budgeted_amount,
    variance.planned_amount,variance.realized_amount,
    case when variance.direction='inflow' then variance.realized_amount-variance.budgeted_amount
      else variance.budgeted_amount-variance.realized_amount end::numeric(14,2)
      as favorable_variance_amount,
    case when variance.budgeted_amount=0 then null
      when variance.direction='inflow' then round(
        (variance.realized_amount-variance.budgeted_amount)/variance.budgeted_amount*100,2)
      else round((variance.budgeted_amount-variance.realized_amount)/variance.budgeted_amount*100,2)
    end as favorable_variance_percent,
    variance.revision,variance.created_by_name,variance.created_at,
    null::uuid as period_closure_id,null::timestamptz as period_closed_at
  from apticket.financial_budget_variance variance
  where not exists(
    select 1 from apticket.financial_period_closures closure
    where closure.tenant_id=variance.tenant_id
      and closure.operating_company_id=variance.operating_company_id
      and closure.period_month=variance.period_month and closure.status='closed'
  )
), closed_lines as (
  select line.tenant_id,line.operating_company_id,line.period_month,line.direction,
    line.financial_category_id,line.financial_category_code,line.financial_category_name,
    line.cost_center_id,line.cost_center_code,line.cost_center_name,line.budget_entry_id,
    line.budgeted_amount,line.planned_amount,line.realized_amount,
    line.favorable_variance_amount,line.favorable_variance_percent,
    line.budget_revision as revision,line.budget_created_by_name as created_by_name,
    line.budget_created_at as created_at,closure.id as period_closure_id,
    closure.closed_at as period_closed_at
  from apticket.financial_period_snapshot_lines line
  join apticket.financial_period_closures closure on closure.id=line.closure_id
    and closure.tenant_id=line.tenant_id
    and closure.operating_company_id=line.operating_company_id
    and closure.status='closed'
), lines as (
  select * from current_lines union all select * from closed_lines
)
select tenant_id,operating_company_id,
  extract(year from period_month)::integer as fiscal_year,
  extract(month from period_month)::integer as fiscal_month,period_month,
  case when direction='inflow' then 'revenue' else 'expense' end as result_group,
  direction,financial_category_id,financial_category_code,financial_category_name,
  cost_center_id,cost_center_code,cost_center_name,budget_entry_id,budgeted_amount,
  planned_amount,realized_amount,
  case when direction='inflow' then budgeted_amount else -budgeted_amount end::numeric(14,2)
    as budgeted_result_amount,
  case when direction='inflow' then planned_amount else -planned_amount end::numeric(14,2)
    as planned_result_amount,
  case when direction='inflow' then realized_amount else -realized_amount end::numeric(14,2)
    as realized_result_amount,
  favorable_variance_amount,favorable_variance_percent,revision,created_by_name,created_at,
  period_closure_id,period_closed_at
from lines;

revoke all on apticket.financial_management_statement from public,anon,authenticated,service_role;
grant select on apticket.financial_management_statement to authenticated,service_role;
revoke all on function apticket.close_financial_period(uuid,date,text),
  apticket.reopen_financial_period(uuid,text) from public,anon;
grant execute on function apticket.close_financial_period(uuid,date,text),
  apticket.reopen_financial_period(uuid,text) to authenticated;
revoke all on function apticket_finance_private.guard_period_closure(),
  apticket_finance_private.guard_period_snapshot(),
  apticket_finance_private.period_is_closed(uuid,uuid,date),
  apticket_finance_private.guard_closed_budget_period(),
  apticket_finance_private.guard_closed_classification_period(),
  apticket_finance_private.close_financial_period_internal(uuid,date,text),
  apticket_finance_private.reopen_financial_period_internal(uuid,text)
  from public,anon,authenticated,service_role;
grant usage on schema apticket_finance_private to authenticated;
grant execute on function
  apticket_finance_private.close_financial_period_internal(uuid,date,text),
  apticket_finance_private.reopen_financial_period_internal(uuid,text) to authenticated;

comment on table apticket.financial_period_closures is
  'Fechamentos mensais versionados com totais consolidados e reabertura justificada.';
comment on table apticket.financial_period_snapshot_lines is
  'Linhas imutáveis do demonstrativo preservadas em cada fechamento mensal.';
comment on view apticket.financial_management_statement is
  'Demonstrativo gerencial com dados ao vivo em períodos abertos e snapshots em períodos encerrados.';
notify pgrst,'reload schema';
