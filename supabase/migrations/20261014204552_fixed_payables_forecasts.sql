-- Previsões ficam fora dos títulos: documento é obrigatório no título e todas
-- as integrações existentes (caixa, DRE, conciliação, aprovação) usam essa tabela.
-- Apenas a confirmação cria um supplier_payable normal, de forma atômica.
insert into apticket.permissions(module,action) values
  ('financeiro_contas_fixas','view'),('financeiro_contas_fixas','edit') on conflict do nothing;
insert into apticket.role_permissions(role_id,permission_id)
select rp.role_id,child.id from apticket.role_permissions rp
join apticket.permissions parent on parent.id=rp.permission_id and parent.module='financeiro_contas_pagar'
join apticket.permissions child on child.module='financeiro_contas_fixas' and child.action=parent.action
on conflict do nothing;

-- O cadastro pode ser consultado por um usuário restrito à gestão de fixas.
do $$ declare p record; begin
  for p in select tablename,policyname,qual from pg_policies where schemaname='apticket' and
    ((tablename in ('financial_categories','financial_cost_centers') and policyname='financial_area_read_guard')
    or (tablename='suppliers' and policyname='supplier_group_read')
    or (tablename='financial_document_types' and policyname='financial_document_types_read')) loop
    execute format('alter policy %I on apticket.%I using ((%s) or (tenant_id=apticket.current_tenant_id() and apticket.has_permission(auth.uid(),''financeiro_contas_fixas'',''view'')))',p.policyname,p.tablename,p.qual);
  end loop;
end $$;

create table apticket.fixed_payables (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  operating_company_id uuid not null, supplier_id uuid not null, supplier_name text not null,
  document_type_id uuid not null, description text not null check(length(btrim(description)) between 2 and 500),
  total_amount numeric(14,2) not null check(total_amount>0 and total_amount<=999999999.99),
  due_day integer not null check(due_day between 1 and 31),
  start_month date not null check(isfinite(start_month) and start_month=date_trunc('month',start_month)::date),
  end_month date check(isfinite(end_month) and end_month=date_trunc('month',end_month)::date and end_month>=start_month),
  category_allocations jsonb not null, cost_center_allocations jsonb not null,
  notes text check(length(notes)<=4000), is_active boolean not null default true,
  revision integer not null default 0, created_at timestamptz not null default clock_timestamp(),
  created_by uuid references apticket.profiles(id), updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references apticket.profiles(id), deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id) references apticket.operating_companies(id,tenant_id),
  foreign key(supplier_id,tenant_id) references apticket.suppliers(id,tenant_id),
  foreign key(document_type_id,tenant_id) references apticket.financial_document_types(id,tenant_id)
);
create table apticket.fixed_payable_occurrences (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  operating_company_id uuid not null, fixed_payable_id uuid not null,
  competence date not null check(isfinite(competence) and competence=date_trunc('month',competence)::date),
  supplier_id uuid not null, supplier_name text not null, document_type_id uuid not null,
  description text not null check(length(btrim(description)) between 2 and 500),
  total_amount numeric(14,2) not null check(total_amount>0 and total_amount<=999999999.99),
  due_date date not null check(isfinite(due_date) and due_date>=competence),
  category_allocations jsonb not null, cost_center_allocations jsonb not null, notes text check(length(notes)<=4000),
  status text not null default 'forecast' check(status in ('forecast','confirmed')),
  confirmed_payable_id uuid unique, confirmed_at timestamptz, confirmed_by uuid references apticket.profiles(id),
  deletion_reason text check(deletion_reason in ('skipped','range_changed','template_deleted')),
  revision integer not null default 0, created_at timestamptz not null default clock_timestamp(),
  created_by uuid references apticket.profiles(id), updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references apticket.profiles(id), deleted_at timestamptz,
  foreign key(fixed_payable_id,tenant_id,operating_company_id) references apticket.fixed_payables(id,tenant_id,operating_company_id),
  foreign key(supplier_id,tenant_id) references apticket.suppliers(id,tenant_id),
  foreign key(document_type_id,tenant_id) references apticket.financial_document_types(id,tenant_id),
  foreign key(confirmed_payable_id,tenant_id,operating_company_id) references apticket.supplier_payables(id,tenant_id,operating_company_id),
  check((status='forecast' and confirmed_payable_id is null and confirmed_at is null and confirmed_by is null)
    or (status='confirmed' and confirmed_payable_id is not null and confirmed_at is not null and confirmed_by is not null and deleted_at is null))
);
create unique index fixed_occurrence_active_month_key on apticket.fixed_payable_occurrences(tenant_id,fixed_payable_id,competence) where deleted_at is null;
create index fixed_occurrence_scope_due_status on apticket.fixed_payable_occurrences(tenant_id,operating_company_id,due_date,status) where deleted_at is null;
create index fixed_occurrence_history on apticket.fixed_payable_occurrences(fixed_payable_id,competence);
create index fixed_payable_scope on apticket.fixed_payables(tenant_id,operating_company_id,is_active) where deleted_at is null;

create function apticket_finance_private.touch_fixed_payable() returns trigger
language plpgsql set search_path=pg_catalog as $$ begin
  new.revision:=old.revision+1; new.updated_at:=clock_timestamp(); new.updated_by:=coalesce(auth.uid(),old.updated_by); return new;
end $$;
revoke all on function apticket_finance_private.touch_fixed_payable() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['fixed_payables','fixed_payable_occurrences'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated',t);
    execute format('create policy fixed_payable_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id) and
      (apticket.has_permission(auth.uid(),''financeiro_contas_fixas'',''view'') or apticket.has_permission(auth.uid(),''financeiro_contas_pagar'',''view'')))',t);
    execute format('create trigger fixed_touch before update on apticket.%I for each row execute function apticket_finance_private.touch_fixed_payable()',t);
    execute format('create trigger fixed_audit after insert or update on apticket.%I for each row execute function apticket_finance_private.audit_record()',t);
    execute format('create trigger fixed_no_delete before delete on apticket.%I for each row execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger fixed_no_truncate before truncate on apticket.%I for each statement execute function apticket_finance_private.guard_record()',t);
  end loop;
end $$;

create function apticket_finance_private.require_fixed_access(p_tenant uuid,p_company uuid) returns void
language plpgsql security definer set search_path=pg_catalog as $$ begin
  if auth.uid() is null or p_tenant is distinct from apticket.current_tenant_id()
    or not apticket.has_permission(auth.uid(),'financeiro_contas_fixas','edit')
    or not apticket.has_financial_scope(p_tenant,p_company,true)
    or not exists(select 1 from apticket.profiles where id=auth.uid() and tenant_id=p_tenant and is_active)
  then raise exception using errcode='42501',message='Sem permissão para gerir contas fixas nesta empresa.'; end if;
end $$;

create function apticket_finance_private.normalize_fixed_payload(p_tenant uuid,p_company uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare v_supplier apticket.suppliers; v_type uuid:=(p_payload->>'document_type_id')::uuid;
  v_amount numeric:=(p_payload->>'total_amount')::numeric; v_categories jsonb; v_centers jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or length(btrim(coalesce(p_payload->>'description',''))) not between 2 and 500
    or v_amount is null or v_amount::text in ('NaN','Infinity','-Infinity') or v_amount<=0 or v_amount>999999999.99 or v_amount<>round(v_amount,2)
    or length(coalesce(p_payload->>'notes',''))>4000 then
    raise exception using errcode='22023',message='Revise fornecedor, descrição, valor e observações.';
  end if;
  perform 1 from apticket.operating_companies where id=p_company and tenant_id=p_tenant and is_active and deleted_at is null for share;
  if not found then raise exception using errcode='23514',message='Empresa operadora inativa ou indisponível.'; end if;
  select * into v_supplier from apticket.suppliers where id=(p_payload->>'supplier_id')::uuid and tenant_id=p_tenant and is_active and deleted_at is null for share;
  if not found then raise exception using errcode='23514',message='Selecione um fornecedor ativo desta organização.'; end if;
  perform 1 from apticket.financial_document_types where id=v_type and tenant_id=p_tenant and is_active and deleted_at is null and availability in ('payable','both') for share;
  if not found then raise exception using errcode='23514',message='Selecione um tipo de documento ativo para contas a pagar.'; end if;
  v_categories:=apticket_finance_private.normalize_contract_allocation(p_payload->'category_allocations','category',p_tenant,p_company,'outflow');
  v_centers:=apticket_finance_private.normalize_contract_allocation(p_payload->'cost_center_allocations','cost_center',p_tenant,p_company,'outflow');
  return p_payload||jsonb_build_object('supplier_name',coalesce(v_supplier.trade_name,v_supplier.legal_name),
    'category_allocations',v_categories,'cost_center_allocations',v_centers,'description',btrim(p_payload->>'description'),'notes',nullif(btrim(p_payload->>'notes'),''));
end $$;

-- Sem auth: somente o dono da função/agendamento pode chamar este gerador privado.
-- Não altera previsões existentes; meses pulados individualmente nunca reaparecem.
create function apticket_finance_private.generate_fixed_forecasts(p_id uuid) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare t apticket.fixed_payables; v_end date; v_count integer;
begin
  select * into t from apticket.fixed_payables where id=p_id for update;
  if not found or not t.is_active or t.deleted_at is not null then return 0; end if;
  v_end:=coalesce(t.end_month,(greatest(t.start_month,date_trunc('month',timezone('America/Sao_Paulo',clock_timestamp()))::date)+interval '11 months')::date);
  insert into apticket.fixed_payable_occurrences(tenant_id,operating_company_id,fixed_payable_id,competence,
    supplier_id,supplier_name,document_type_id,description,total_amount,due_date,category_allocations,cost_center_allocations,notes,created_by)
  select t.tenant_id,t.operating_company_id,t.id,m::date,t.supplier_id,t.supplier_name,t.document_type_id,t.description,t.total_amount,
    least((m+(t.due_day-1)*interval '1 day')::date,(m+interval '1 month - 1 day')::date),t.category_allocations,t.cost_center_allocations,t.notes,auth.uid()
  from generate_series(t.start_month::timestamp,v_end::timestamp,interval '1 month') m
  where not exists(select 1 from apticket.fixed_payable_occurrences o where o.fixed_payable_id=t.id and o.competence=m::date and (o.deleted_at is null or o.deletion_reason='skipped'))
  on conflict(tenant_id,fixed_payable_id,competence) where deleted_at is null do nothing;
  get diagnostics v_count=row_count; return v_count;
end $$;

create function apticket.gerar_previsoes_conta_fixa(p_id uuid) returns integer
language plpgsql security definer set search_path=pg_catalog as $$ declare t apticket.fixed_payables; begin
  select * into t from apticket.fixed_payables where id=p_id and tenant_id=apticket.current_tenant_id() and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Conta fixa não encontrada.'; end if;
  perform apticket_finance_private.require_fixed_access(t.tenant_id,t.operating_company_id);
  return apticket_finance_private.generate_fixed_forecasts(t.id);
end $$;

create function apticket.save_fixed_payable(p_id uuid,p_expected_revision integer,p_payload jsonb,p_apply_future boolean default true) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare t apticket.fixed_payables; v_tenant uuid:=apticket.current_tenant_id(); v_id uuid:=coalesce(p_id,gen_random_uuid());
  v_company uuid:=(p_payload->>'operating_company_id')::uuid; v jsonb;
  v_start date:=(p_payload->>'start_month')::date; v_end date:=nullif(p_payload->>'end_month','')::date; v_day integer:=(p_payload->>'due_day')::integer;
begin
  perform apticket_finance_private.require_fixed_access(v_tenant,v_company);
  if p_id is not null then
    select * into t from apticket.fixed_payables where id=p_id and tenant_id=v_tenant and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Conta fixa não encontrada.'; end if;
    if t.operating_company_id is distinct from v_company then raise exception using errcode='22023',message='A empresa de uma conta fixa não pode ser alterada.'; end if;
    if p_expected_revision is null or t.revision<>p_expected_revision then raise exception using errcode='40001',message='Esta conta fixa foi alterada. Reabra o cadastro.'; end if;
  end if;
  if v_start is null or not isfinite(v_start) or v_start<>date_trunc('month',v_start)::date
    or (v_end is not null and (not isfinite(v_end) or v_end<>date_trunc('month',v_end)::date or v_end<v_start))
    or v_day is null or v_day not between 1 and 31 then
    raise exception using errcode='22023',message='Informe início, dia de vencimento e lançar até igual ou posterior ao início.';
  end if;
  v:=apticket_finance_private.normalize_fixed_payload(v_tenant,v_company,p_payload);
  if p_id is null then
    insert into apticket.fixed_payables(id,tenant_id,operating_company_id,supplier_id,supplier_name,document_type_id,description,total_amount,due_day,start_month,end_month,category_allocations,cost_center_allocations,notes,created_by)
    values(v_id,v_tenant,v_company,(v->>'supplier_id')::uuid,v->>'supplier_name',(v->>'document_type_id')::uuid,v->>'description',(v->>'total_amount')::numeric,v_day,v_start,v_end,v->'category_allocations',v->'cost_center_allocations',v->>'notes',auth.uid());
  else
    update apticket.fixed_payables set supplier_id=(v->>'supplier_id')::uuid,supplier_name=v->>'supplier_name',document_type_id=(v->>'document_type_id')::uuid,
      description=v->>'description',total_amount=(v->>'total_amount')::numeric,due_day=v_day,start_month=v_start,end_month=v_end,
      category_allocations=v->'category_allocations',cost_center_allocations=v->'cost_center_allocations',notes=v->>'notes' where id=v_id;
    update apticket.fixed_payable_occurrences set deleted_at=clock_timestamp(),deletion_reason='range_changed'
      where fixed_payable_id=v_id and status='forecast' and deleted_at is null and (competence<v_start or (v_end is not null and competence>v_end));
    if coalesce(p_apply_future,true) then
      update apticket.fixed_payable_occurrences set supplier_id=(v->>'supplier_id')::uuid,supplier_name=v->>'supplier_name',document_type_id=(v->>'document_type_id')::uuid,
        description=v->>'description',total_amount=(v->>'total_amount')::numeric,
        due_date=least((competence+(v_day-1)*interval '1 day')::date,(competence+interval '1 month - 1 day')::date),
        category_allocations=v->'category_allocations',cost_center_allocations=v->'cost_center_allocations',notes=v->>'notes'
        where fixed_payable_id=v_id and status='forecast' and deleted_at is null and competence>=date_trunc('month',timezone('America/Sao_Paulo',clock_timestamp()))::date;
    end if;
  end if;
  perform apticket_finance_private.generate_fixed_forecasts(v_id); return v_id;
end $$;

create function apticket.set_fixed_payable_active(p_id uuid,p_expected_revision integer,p_active boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare t apticket.fixed_payables; begin
  select * into t from apticket.fixed_payables where id=p_id and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Conta fixa não encontrada.'; end if;
  perform apticket_finance_private.require_fixed_access(t.tenant_id,t.operating_company_id);
  if p_expected_revision is null or t.revision<>p_expected_revision then raise exception using errcode='40001',message='Esta conta fixa foi alterada. Reabra o cadastro.'; end if;
  if p_active is null then raise exception using errcode='22023',message='Informe a situação da conta fixa.'; end if;
  update apticket.fixed_payables set is_active=p_active where id=p_id;
  if p_active then perform apticket_finance_private.generate_fixed_forecasts(p_id); end if;
  return true;
end $$;

create function apticket.delete_fixed_payable(p_id uuid,p_expected_revision integer) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare t apticket.fixed_payables; begin
  select * into t from apticket.fixed_payables where id=p_id and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Conta fixa não encontrada.'; end if;
  perform apticket_finance_private.require_fixed_access(t.tenant_id,t.operating_company_id);
  if p_expected_revision is null or t.revision<>p_expected_revision then raise exception using errcode='40001',message='Esta conta fixa foi alterada. Atualize a lista.'; end if;
  update apticket.fixed_payables set deleted_at=clock_timestamp(),is_active=false where id=p_id;
  update apticket.fixed_payable_occurrences set deleted_at=clock_timestamp(),deletion_reason='template_deleted' where fixed_payable_id=p_id and status='forecast' and deleted_at is null;
  return true;
end $$;

-- Sempre bloqueia modelo -> ocorrência, a mesma ordem do gerador e da edição.
create function apticket_finance_private.lock_fixed_occurrence(p_id uuid,p_revision integer) returns apticket.fixed_payable_occurrences
language plpgsql security definer set search_path=pg_catalog as $$ declare o apticket.fixed_payable_occurrences; t apticket.fixed_payables; begin
  select * into o from apticket.fixed_payable_occurrences where id=p_id and tenant_id=apticket.current_tenant_id() and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Previsão não encontrada.'; end if;
  perform apticket_finance_private.require_fixed_access(o.tenant_id,o.operating_company_id);
  select * into t from apticket.fixed_payables where id=o.fixed_payable_id for update;
  if t.deleted_at is not null then raise exception using errcode='P0001',message='A conta fixa foi excluída.'; end if;
  select * into o from apticket.fixed_payable_occurrences where id=p_id for update;
  if o.status<>'forecast' or o.deleted_at is not null then raise exception using errcode='P0001',message='Esta previsão já foi confirmada ou excluída.'; end if;
  if p_revision is null or o.revision<>p_revision then raise exception using errcode='40001',message='Esta previsão foi alterada. Reabra a confirmação.'; end if;
  return o;
end $$;

create function apticket.save_fixed_payable_occurrence(p_id uuid,p_expected_revision integer,p_payload jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare o apticket.fixed_payable_occurrences; v jsonb; v_due date:=(p_payload->>'due_date')::date; begin
  o:=apticket_finance_private.lock_fixed_occurrence(p_id,p_expected_revision);
  v:=apticket_finance_private.normalize_fixed_payload(o.tenant_id,o.operating_company_id,p_payload);
  if v_due is null or not isfinite(v_due) or v_due<o.competence then raise exception using errcode='22023',message='Vencimento inválido para esta competência.'; end if;
  update apticket.fixed_payable_occurrences set supplier_id=(v->>'supplier_id')::uuid,supplier_name=v->>'supplier_name',document_type_id=(v->>'document_type_id')::uuid,
    description=v->>'description',total_amount=(v->>'total_amount')::numeric,due_date=v_due,
    category_allocations=v->'category_allocations',cost_center_allocations=v->'cost_center_allocations',notes=v->>'notes' where id=p_id;
  return true;
end $$;
create function apticket.skip_fixed_payable_occurrence(p_id uuid,p_expected_revision integer) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare o apticket.fixed_payable_occurrences; begin
  o:=apticket_finance_private.lock_fixed_occurrence(p_id,p_expected_revision);
  update apticket.fixed_payable_occurrences set deleted_at=clock_timestamp(),deletion_reason='skipped' where id=p_id; return true;
end $$;

create function apticket.confirmar_previsao_conta_fixa(p_id uuid,p_expected_revision integer,p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare o apticket.fixed_payable_occurrences; v jsonb; v_group uuid; v_payable uuid; v_due date:=(p_payload->>'due_date')::date;
begin
  o:=apticket_finance_private.lock_fixed_occurrence(p_id,p_expected_revision);
  v:=apticket_finance_private.normalize_fixed_payload(o.tenant_id,o.operating_company_id,p_payload);
  -- O RPC existente exige também edição do contas a pagar; todos os fluxos
  -- normais (alçada, anexos, pagamento, relatórios) passam a valer neste ponto.
  v_group:=apticket.create_manual_supplier_payable_allocated(o.operating_company_id,(v->>'supplier_id')::uuid,(v->>'document_type_id')::uuid,
    p_payload->>'document_number',v->>'description',o.competence,(v->>'total_amount')::numeric,
    jsonb_build_array(jsonb_build_object('number',1,'due_date',v_due,'amount',(v->>'total_amount')::numeric)),v->'category_allocations',v->'cost_center_allocations',0,v->>'notes');
  select id into strict v_payable from apticket.supplier_payables where manual_entry_group_id=v_group;
  update apticket.fixed_payable_occurrences set status='confirmed',confirmed_payable_id=v_payable,confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),
    supplier_id=(v->>'supplier_id')::uuid,supplier_name=v->>'supplier_name',document_type_id=(v->>'document_type_id')::uuid,
    description=v->>'description',total_amount=(v->>'total_amount')::numeric,due_date=v_due,
    category_allocations=v->'category_allocations',cost_center_allocations=v->'cost_center_allocations',notes=v->>'notes' where id=o.id;
  return v_payable;
end $$;

create function apticket_finance_private.maintain_fixed_payable_forecasts() returns integer
language plpgsql security definer set search_path=pg_catalog as $$ declare t record; v_count integer:=0; begin
  -- Não fornece um endpoint multi-tenant: EXECUTE é revogado a todos os clientes.
  for t in select id from apticket.fixed_payables where is_active and deleted_at is null order by id loop
    v_count:=v_count+apticket_finance_private.generate_fixed_forecasts(t.id);
  end loop; return v_count;
end $$;

revoke all on function apticket_finance_private.require_fixed_access(uuid,uuid),
  apticket_finance_private.normalize_fixed_payload(uuid,uuid,jsonb),apticket_finance_private.generate_fixed_forecasts(uuid),
  apticket_finance_private.lock_fixed_occurrence(uuid,integer),apticket_finance_private.maintain_fixed_payable_forecasts()
  from public,anon,authenticated,service_role;
revoke all on function apticket.gerar_previsoes_conta_fixa(uuid),apticket.save_fixed_payable(uuid,integer,jsonb,boolean),
  apticket.set_fixed_payable_active(uuid,integer,boolean),apticket.delete_fixed_payable(uuid,integer),
  apticket.save_fixed_payable_occurrence(uuid,integer,jsonb),apticket.skip_fixed_payable_occurrence(uuid,integer),apticket.confirmar_previsao_conta_fixa(uuid,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function apticket.gerar_previsoes_conta_fixa(uuid),apticket.save_fixed_payable(uuid,integer,jsonb,boolean),
  apticket.set_fixed_payable_active(uuid,integer,boolean),apticket.delete_fixed_payable(uuid,integer),
  apticket.save_fixed_payable_occurrence(uuid,integer,jsonb),apticket.skip_fixed_payable_occurrence(uuid,integer),apticket.confirmar_previsao_conta_fixa(uuid,integer,jsonb)
  to authenticated;

-- 06:20 UTC = 03:20 de São Paulo; diariamente recupera também execuções perdidas.
-- No primeiro dia de cada mês completa automaticamente a janela de 12 meses.
select cron.schedule('apticket-fixed-payable-forecasts','20 6 * * *','select apticket_finance_private.maintain_fixed_payable_forecasts();');
comment on table apticket.fixed_payable_occurrences is 'Previsão é um estado próprio, anterior ao título. Não participa de caixa, DRE, orçamento realizado, conciliação, alçada ou pagamento até confirmar.';
notify pgrst,'reload schema';
