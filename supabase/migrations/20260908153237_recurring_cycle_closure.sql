-- Fatia 2: fechamento opt-in. Nenhum contrato existente é ativado automaticamente.
alter table apticket.contract_financial_terms
  add column billing_enabled boolean not null default false,
  add column billing_anchor_month date,
  add column required_metrics text[] not null default '{}',
  add constraint financial_billing_anchor_check check (
    (not billing_enabled or billing_anchor_month is not null)
    and (billing_anchor_month is null or billing_anchor_month = date_trunc('month', billing_anchor_month)::date)),
  add constraint financial_metrics_check check (
    required_metrics <@ array['active_users','devices','excess_tickets','technical_hours']::text[]
    and array_position(required_metrics, null) is null);

alter table apticket.consumption_snapshots add constraint consumption_snapshot_scope_key
  unique(id, contract_id, tenant_id, operating_company_id);

create table apticket.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  contract_id uuid not null,
  cycle_start date not null,
  cycle_end date not null,
  service_start date not null,
  service_end date not null,
  total_amount numeric(14,2) not null check (total_amount >= 0 and total_amount < 1000000000000),
  due_date date not null,
  terms_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (cycle_start <= service_start and service_start < service_end and service_end <= cycle_end),
  unique (contract_id, cycle_start),
  unique (id, contract_id, tenant_id, operating_company_id),
  foreign key (contract_id, tenant_id, operating_company_id)
    references apticket.contract_financial_terms(contract_id, tenant_id, operating_company_id) on delete restrict
);
create table apticket.billing_cycle_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  contract_id uuid not null,
  billing_cycle_id uuid not null,
  value_version_id uuid not null,
  consumption_snapshot_id uuid unique,
  kind text not null check (kind in ('fixed','variable')),
  description text not null,
  period_start date not null,
  period_end date not null check (period_end > period_start),
  quantity numeric(18,6) not null check (quantity >= 0 and quantity < 1000000000000),
  unit_price numeric(18,6) not null check (unit_price >= 0 and unit_price < 1000000000000),
  divisor integer not null default 1 check (divisor > 0),
  amount numeric(14,2) generated always as (round(quantity * unit_price / divisor, 2)) stored,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((kind = 'variable') = (consumption_snapshot_id is not null)),
  check (kind <> 'variable' or divisor=1),
  foreign key (billing_cycle_id, contract_id, tenant_id, operating_company_id)
    references apticket.billing_cycles(id, contract_id, tenant_id, operating_company_id) on delete restrict,
  foreign key (value_version_id, contract_id, tenant_id, operating_company_id)
    references apticket.contract_value_versions(id, contract_id, tenant_id, operating_company_id) on delete restrict,
  foreign key (consumption_snapshot_id, contract_id, tenant_id, operating_company_id)
    references apticket.consumption_snapshots(id, contract_id, tenant_id, operating_company_id) on delete restrict
);
create index billing_cycles_scope on apticket.billing_cycles(tenant_id, operating_company_id);
create index billing_cycle_items_scope on apticket.billing_cycle_items(tenant_id, operating_company_id, billing_cycle_id);

-- Reutiliza o contas a receber existente, distinguindo as origens por XOR.
alter table apticket.contas_receber
  alter column medicao_id drop not null,
  add column billing_cycle_id uuid unique,
  add column operating_company_id uuid,
  add constraint receivable_origin_check check (
    (medicao_id is not null and billing_cycle_id is null and operating_company_id is null)
    or (medicao_id is null and billing_cycle_id is not null and operating_company_id is not null)),
  add constraint receivable_cycle_scope_fk foreign key(billing_cycle_id, contrato_id, tenant_id, operating_company_id)
    references apticket.billing_cycles(id, contract_id, tenant_id, operating_company_id) on delete restrict;
create policy recurring_receivable_read on apticket.contas_receber as restrictive for select to authenticated
  using (billing_cycle_id is null or apticket.has_financial_scope(tenant_id, operating_company_id));
create policy recurring_receivable_update on apticket.contas_receber as restrictive for update to authenticated
  using (billing_cycle_id is null or apticket.has_financial_scope(tenant_id, operating_company_id, true))
  with check (billing_cycle_id is null or apticket.has_financial_scope(tenant_id, operating_company_id, true));

create function apticket_finance_private.guard_closed_cycle()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (to_jsonb(new) - array['deleted_at','amount']) is distinct from (to_jsonb(old) - array['deleted_at','amount']) then
    raise exception using errcode='23514', message='O ciclo fechado e seus itens são imutáveis.';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['billing_cycles','billing_cycle_items'] loop
    execute format('alter table apticket.%I enable row level security', t);
    execute format('revoke all on apticket.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on apticket.%I to authenticated, service_role', t);
    execute format('grant insert on apticket.%I to service_role', t);
    execute format('grant update(deleted_at) on apticket.%I to service_role', t);
    execute format('create policy scoped_read on apticket.%I for select to authenticated
      using (apticket.has_financial_scope(tenant_id, operating_company_id))', t);
    execute format('create trigger guard_record before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()', t);
    execute format('create trigger guard_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()', t);
    execute format('create trigger immutable_cycle before update on apticket.%I for each row
      execute function apticket_finance_private.guard_closed_cycle()', t);
    execute format('create trigger audit_cycle after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()', t);
  end loop;
end $$;

create function apticket_finance_private.protect_billed_sources()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  -- Executa antes dos validadores da fatia 1: adquirir o lock ANTES de
  -- consultar ciclos evita corrida entre fechamento e reajuste/exclusão.
  if tg_table_name <> 'contract_financial_terms' then
    perform 1 from apticket.contract_financial_terms where contract_id=new.contract_id for update;
  end if;
  if tg_table_name='contract_financial_terms' then
    if row(new.billing_anchor_month,new.billing_interval_months,new.cutoff_day)
      is distinct from row(old.billing_anchor_month,old.billing_interval_months,old.cutoff_day)
      and exists(select 1 from apticket.billing_cycles where contract_id=new.contract_id) then
      raise exception using errcode='23514', message='O calendário de um contrato já faturado não pode ser reescrito.';
    end if;
  elsif tg_op='INSERT' and tg_table_name='consumption_snapshots' then
    if exists(select 1 from apticket.billing_cycles b where b.contract_id=new.contract_id
      and b.service_start<new.cycle_end and b.service_end>new.cycle_start) then
      raise exception using errcode='23514', message='Não é permitido adicionar consumo a um ciclo fechado.';
    end if;
  elsif tg_op='INSERT' then
    if exists(select 1 from apticket.billing_cycles b where b.contract_id=new.contract_id
      and b.service_end > new.effective_from) then
      raise exception using errcode='23514', message='O reajuste não pode alterar um ciclo já faturado.';
    end if;
  elsif new.deleted_at is distinct from old.deleted_at then
    if (tg_table_name='contract_value_versions' and exists(select 1 from apticket.billing_cycle_items where value_version_id=new.id))
      or (tg_table_name='consumption_snapshots' and exists(select 1 from apticket.billing_cycle_items where consumption_snapshot_id=new.id)) then
      raise exception using errcode='23514', message='Uma fonte já faturada não pode ser excluída.';
    end if;
  end if;
  return new;
end $$;
create trigger protect_billed_terms before update on apticket.contract_financial_terms
  for each row execute function apticket_finance_private.protect_billed_sources();
create trigger protect_billed_value before insert or update on apticket.contract_value_versions
  for each row execute function apticket_finance_private.protect_billed_sources();
create trigger protect_billed_snapshot before insert or update on apticket.consumption_snapshots
  for each row execute function apticket_finance_private.protect_billed_sources();

create function apticket_finance_private.guard_receivable_cycle()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare f apticket.contract_financial_terms;
begin
  if tg_op='UPDATE' then
    if row(new.billing_cycle_id,new.operating_company_id) is distinct from row(old.billing_cycle_id,old.operating_company_id) then
      raise exception using errcode='23514', message='A origem e a empresa da cobrança não podem ser alteradas.';
    end if;
  else
    select * into f from apticket.contract_financial_terms where contract_id=new.contrato_id for update;
    if new.medicao_id is not null and found and (
      (f.billing_enabled and new.competencia >= f.billing_anchor_month)
      or exists(select 1 from apticket.billing_cycles b where b.contract_id=new.contrato_id
        and b.cycle_start < (new.competencia + interval '1 month')::date and b.cycle_end > new.competencia)) then
      raise exception using errcode='23514', message='Este período utiliza faturamento recorrente. A medição não pode gerar cobrança duplicada.';
    end if;
  end if;
  return new;
end $$;
create trigger guard_receivable_cycle before insert or update on apticket.contas_receber
  for each row execute function apticket_finance_private.guard_receivable_cycle();
create trigger audit_recurring_receivable after insert or update on apticket.contas_receber
  for each row when (new.billing_cycle_id is not null) execute function apticket_finance_private.audit_record();
-- Exclusão física de recebíveis é vedada; a aplicação já usa deleted_at.
revoke delete, truncate on apticket.contas_receber from authenticated, service_role;
create trigger guard_receivable_delete before delete on apticket.contas_receber
  for each row execute function apticket_finance_private.guard_record();
create trigger guard_receivable_truncate before truncate on apticket.contas_receber
  for each statement execute function apticket_finance_private.guard_record();

create function apticket_finance_private.cutoff_date(p_month date, p_day integer)
returns date language sql immutable security invoker set search_path=pg_catalog as $$
  select date_trunc('month',p_month)::date + (least(p_day,
    extract(day from date_trunc('month',p_month) + interval '1 month - 1 day')::integer)-1);
$$;

-- Fecha apenas o próximo ciclo. O lock também é usado nas versões e snapshots.
create function apticket_finance_private.close_next_cycle(p_contract_id uuid, p_as_of date)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare
  f apticket.contract_financial_terms; c apticket.contracts;
  v_start date; v_end date; v_service_start date; v_service_end date; v_month date;
  v_last_end date; v_due date; v_id uuid; v_client text; v_metric text;
  v_items jsonb; v_item jsonb; v_total numeric; v_days integer; v_count integer;
begin
  select * into f from apticket.contract_financial_terms where contract_id=p_contract_id and deleted_at is null for update;
  if not found or not f.billing_enabled then return null; end if;
  select * into c from apticket.contracts where id=p_contract_id and tenant_id=f.tenant_id for update;
  if not found or c.status not in ('active','expired') then return null; end if;
  if not exists(select 1 from apticket.operating_companies where id=f.operating_company_id and deleted_at is null) then return null; end if;
  select max(cycle_end) into v_last_end from apticket.billing_cycles where contract_id=c.id;
  v_month := coalesce(date_trunc('month',v_last_end)::date,f.billing_anchor_month);
  v_start := apticket_finance_private.cutoff_date(v_month,f.cutoff_day);
  v_end := apticket_finance_private.cutoff_date((v_month+make_interval(months=>f.billing_interval_months))::date,f.cutoff_day);
  if v_end > p_as_of then return null; end if;
  if v_end <= c.starts_at then
    raise exception using errcode='23514', message='O primeiro ciclo antecede o início do contrato. Revise o mês âncora.';
  end if;
  v_service_start := greatest(v_start,c.starts_at);
  v_service_end := least(v_end,c.ends_at+1);
  if v_service_start >= v_service_end then return null; end if;
  if exists(select 1 from apticket.contas_receber r where r.contrato_id=c.id and r.medicao_id is not null
    and r.competencia < v_end and (r.competencia+interval '1 month')::date > v_start) then
    raise exception using errcode='23514', message='Já existe cobrança de medição neste ciclo. Revise a transição para recorrência.';
  end if;

  -- Uma linha fixa por versão, com dias reais sobre dias do ciclo completo.
  with periods as (
    select v.*, lead(effective_from,1,v_service_end) over(order by effective_from) until_date
    from apticket.contract_value_versions v where v.contract_id=c.id and v.deleted_at is null
  ), lines as (
    select id,base_amount,greatest(effective_from,v_service_start) a,least(until_date,v_service_end) b from periods
  ) select coalesce(jsonb_agg(jsonb_build_object('kind','fixed','version_id',id,'description','Parcela fixa proporcional',
    'start',a,'end',b,'quantity',b-a,'unit_price',base_amount*f.billing_interval_months,'divisor',v_end-v_start) order by a),'[]'),
    coalesce(sum(b-a),0) into v_items,v_days from lines where b>a;
  if v_days <> v_service_end-v_service_start then
    raise exception using errcode='23514', message='Falta valor contratual vigente para parte do ciclo.';
  end if;

  -- Uma métrica exigida deve cobrir o período inteiro, mesmo quando o consumo for zero.
  foreach v_metric in array f.required_metrics loop
    select coalesce(sum(cycle_end-cycle_start),0),count(*) into v_days,v_count
    from apticket.consumption_snapshots s where s.contract_id=c.id and s.metric=v_metric and s.deleted_at is null
      and s.cycle_start>=v_service_start and s.cycle_end<=v_service_end;
    if v_days <> v_service_end-v_service_start or v_count=0 then
      raise exception using errcode='23514', message='Apuração incompleta para a métrica: '||v_metric;
    end if;
  end loop;
  if exists(select 1 from apticket.consumption_snapshots s where s.contract_id=c.id and s.deleted_at is null
    and s.cycle_start<v_service_end and s.cycle_end>v_service_start
    and (s.cycle_start<v_service_start or s.cycle_end>v_service_end or not s.metric=any(f.required_metrics))) then
    raise exception using errcode='23514', message='Há snapshot fora dos limites ou das métricas configuradas para o ciclo.';
  end if;
  select v_items || coalesce(jsonb_agg(jsonb_build_object('kind','variable','version_id',s.value_version_id,'snapshot_id',s.id,
    'description','Consumo: '||s.metric,'start',s.cycle_start,'end',s.cycle_end,'quantity',s.billable_quantity,
    'unit_price',s.unit_price,'divisor',1) order by s.metric,s.cycle_start),'[]') into v_items
  from apticket.consumption_snapshots s where s.contract_id=c.id and s.deleted_at is null
    and s.cycle_start>=v_service_start and s.cycle_end<=v_service_end and s.metric=any(f.required_metrics);
  select sum(round((j->>'quantity')::numeric*(j->>'unit_price')::numeric/(j->>'divisor')::integer,2)) into v_total
    from jsonb_array_elements(v_items) j;
  v_due := apticket.calcular_vencimento_medicao(date_trunc('month',v_end)::date,c.tipo_vencimento,c.dia_vencimento,c.tenant_id);
  if v_due < v_end then
    v_due := apticket.calcular_vencimento_medicao((date_trunc('month',v_end)+interval '1 month')::date,c.tipo_vencimento,c.dia_vencimento,c.tenant_id);
  end if;
  select name into v_client from apticket.companies where id=c.company_id and tenant_id=c.tenant_id;
  if v_client is null then raise exception using errcode='23514',message='Cliente do contrato inválido.'; end if;
  insert into apticket.billing_cycles(tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,service_start,service_end,total_amount,due_date,terms_snapshot)
    values(c.tenant_id,f.operating_company_id,c.id,v_start,v_end,v_service_start,v_service_end,v_total,v_due,to_jsonb(f)) returning id into v_id;
  for v_item in select * from jsonb_array_elements(v_items) loop
    insert into apticket.billing_cycle_items(tenant_id,operating_company_id,contract_id,billing_cycle_id,value_version_id,
      consumption_snapshot_id,kind,description,period_start,period_end,quantity,unit_price,divisor)
    values(c.tenant_id,f.operating_company_id,c.id,v_id,(v_item->>'version_id')::uuid,(v_item->>'snapshot_id')::uuid,
      v_item->>'kind',v_item->>'description',(v_item->>'start')::date,(v_item->>'end')::date,
      (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,(v_item->>'divisor')::integer);
  end loop;
  insert into apticket.contas_receber(tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,cliente_nome,
    documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,aprovado_em)
  values(c.tenant_id,v_id,f.operating_company_id,c.id,c.company_id,v_client,'REC-'||v_id::text,
    'Ciclo do contrato '||c.numero_contrato||' de '||to_char(v_start,'DD/MM/YYYY')||' a '||to_char(v_end-1,'DD/MM/YYYY'),
    date_trunc('month',v_start)::date,v_total,v_total,v_due,now());
  return v_id;
end $$;

-- Endpoint exclusivo de serviço: chamada direta de usuário/anon é recusada por GRANT.
create function apticket.close_billing_cycles(p_contract_id uuid default null, p_as_of date default null, p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare r record; v_id uuid; v_count integer:=0; v_errors jsonb:='[]'; v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_limit is null or p_limit<1 or p_limit>100 or coalesce(p_as_of,v_today)>v_today then
    raise exception using errcode='22023',message='Limite deve estar entre 1 e 100 e a data não pode estar no futuro.';
  end if;
  for r in select contract_id from apticket.contract_financial_terms
    where billing_enabled and deleted_at is null and (p_contract_id is null or contract_id=p_contract_id) order by contract_id loop
    loop
      exit when v_count>=p_limit;
      begin
        v_id:=apticket_finance_private.close_next_cycle(r.contract_id,coalesce(p_as_of,v_today));
        exit when v_id is null;
        v_count:=v_count+1;
      exception when others then
        -- Subtransação por ciclo: não deixa cabeçalho/itens/recebível pela metade.
        v_errors:=v_errors||jsonb_build_array(jsonb_build_object('contract_id',r.contract_id,'code',sqlstate,'message',sqlerrm));
        exit;
      end;
    end loop;
    exit when v_count>=p_limit;
  end loop;
  return jsonb_build_object('generated',v_count,'errors',v_errors,'limit_reached',v_count>=p_limit);
end $$;
revoke all on function apticket.close_billing_cycles(uuid,date,integer) from public,anon,authenticated;
grant execute on function apticket.close_billing_cycles(uuid,date,integer) to service_role;
revoke all on all functions in schema apticket_finance_private from public,anon,authenticated,service_role;
grant usage on schema apticket_finance_private to service_role;
grant execute on function apticket_finance_private.cutoff_date(date,integer),
  apticket_finance_private.close_next_cycle(uuid,date) to service_role;

-- Invocar somente após publicar a Edge Function. Segredos nunca entram no Git.
create function apticket_finance_private.schedule_cycle_closure()
returns bigint language plpgsql security invoker set search_path=pg_catalog as $$
declare v_job bigint;
begin
  if not exists(select 1 from vault.decrypted_secrets where name='apticket_internal_functions_url')
    or not exists(select 1 from vault.decrypted_secrets where name='apticket_edge_service_role_key') then
    raise exception 'Configure os segredos do agendamento no Vault.';
  end if;
  select cron.schedule('apticket-fechar-ciclos-financeiros','10 * * * *', $cron$
    select net.http_post(
      url:=(select decrypted_secret from vault.decrypted_secrets where name='apticket_internal_functions_url')||'/functions/v1/fechar-ciclos-financeiros',
      headers:=jsonb_build_object('Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='apticket_edge_service_role_key'),
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='apticket_edge_service_role_key')),
      body:='{"limit":50}'::jsonb,timeout_milliseconds:=50000);
  $cron$) into v_job;
  return v_job;
end $$;
revoke all on function apticket_finance_private.schedule_cycle_closure() from public,anon,authenticated,service_role;

notify pgrst, 'reload schema';
