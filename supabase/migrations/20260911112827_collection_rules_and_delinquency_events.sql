-- Fatia 14: régua de cobrança e evento desacoplado de suspensão.
-- Nenhuma configuração é ativada automaticamente e esta fatia não envia mensagens.
create table apticket.collection_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  enabled boolean not null default false,
  suspend_after_days smallint check (suspend_after_days between 1 and 365),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (tenant_id, operating_company_id),
  unique (id, tenant_id, operating_company_id),
  foreign key (operating_company_id, tenant_id)
    references apticket.operating_companies(id, tenant_id) on delete restrict,
  foreign key (created_by, tenant_id) references apticket.profiles(id, tenant_id) on delete restrict,
  foreign key (updated_by, tenant_id) references apticket.profiles(id, tenant_id) on delete restrict
);

create table apticket.collection_policy_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  policy_id uuid not null,
  position smallint not null check (position between 1 and 10),
  days_after_due smallint not null check (days_after_due between -30 and 365),
  channel text not null check (channel in ('email','whatsapp','sms')),
  subject text check (subject is null or length(btrim(subject)) between 1 and 180),
  message_template text not null check (length(btrim(message_template)) between 1 and 4000),
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (policy_id, position),
  foreign key (policy_id, tenant_id, operating_company_id)
    references apticket.collection_policies(id, tenant_id, operating_company_id) on delete restrict
);

create table apticket.collection_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  policy_id uuid not null,
  policy_step_id uuid not null,
  receivable_id uuid not null,
  contract_id uuid not null,
  due_date date not null,
  scheduled_for date not null,
  channel text not null check (channel in ('email','whatsapp','sms')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  recipient_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(recipient_snapshot)='object'),
  content_snapshot jsonb not null check (jsonb_typeof(content_snapshot)='object'),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  last_error text,
  processed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (receivable_id, policy_step_id),
  foreign key (policy_id, tenant_id, operating_company_id)
    references apticket.collection_policies(id, tenant_id, operating_company_id) on delete restrict,
  foreign key (policy_step_id) references apticket.collection_policy_steps(id) on delete restrict,
  foreign key (receivable_id, tenant_id, operating_company_id)
    references apticket.contas_receber(id, tenant_id, operating_company_id) on delete restrict,
  foreign key (contract_id, tenant_id) references apticket.contracts(id, tenant_id) on delete restrict
);

create table apticket.financial_domain_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  aggregate_type text not null check (aggregate_type in ('contract')),
  aggregate_id uuid not null,
  event_type text not null check (event_type in ('contract.suspended_for_delinquency')),
  source_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  status text not null default 'pending' check (status in ('pending','processing','processed','failed','cancelled')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 20),
  last_error text,
  occurred_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  unique (event_type, source_id),
  foreign key (operating_company_id, tenant_id)
    references apticket.operating_companies(id, tenant_id) on delete restrict,
  foreign key (aggregate_id, tenant_id) references apticket.contracts(id, tenant_id) on delete restrict,
  foreign key (source_id, tenant_id, operating_company_id)
    references apticket.contas_receber(id, tenant_id, operating_company_id) on delete restrict
);

create index collection_actions_queue_idx
  on apticket.collection_actions(status, scheduled_for, tenant_id, operating_company_id);
create index financial_domain_events_queue_idx
  on apticket.financial_domain_events(status, event_type, occurred_at);

do $$ declare t text; begin
  foreach t in array array['collection_policies','collection_policy_steps','collection_actions','financial_domain_events'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy financial_scoped_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger guard_delete before delete on apticket.%I for each row execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger guard_truncate before truncate on apticket.%I for each statement execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger audit_change after insert or update on apticket.%I for each row execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

grant insert,update on apticket.collection_policies to service_role;
grant insert,update on apticket.collection_policy_steps to service_role;
grant insert,update on apticket.collection_actions to service_role;
grant insert,update on apticket.financial_domain_events to service_role;

create function apticket_finance_private.save_collection_policy(
  p_company uuid,p_enabled boolean,p_suspend_after_days integer,p_steps jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id(); v_actor uuid:=auth.uid(); v_policy uuid; v_step jsonb; v_pos int:=0;
begin
  if v_actor is null or v_tenant is null or not apticket.has_financial_scope(v_tenant,p_company,true) then
    raise exception using errcode='42501',message='Você não possui permissão para configurar a régua de cobrança.';
  end if;
  if p_suspend_after_days is not null and p_suspend_after_days not between 1 and 365 then
    raise exception using errcode='22023',message='O prazo de suspensão deve ficar entre 1 e 365 dias.';
  end if;
  if jsonb_typeof(p_steps)<>'array' or jsonb_array_length(p_steps)>10 then
    raise exception using errcode='22023',message='Informe uma lista com até 10 etapas de cobrança.';
  end if;
  insert into apticket.collection_policies(tenant_id,operating_company_id,enabled,suspend_after_days,created_by,updated_by)
  values(v_tenant,p_company,p_enabled,p_suspend_after_days,v_actor,v_actor)
  on conflict(tenant_id,operating_company_id) do update set enabled=excluded.enabled,
    suspend_after_days=excluded.suspend_after_days,updated_by=v_actor,updated_at=clock_timestamp(),deleted_at=null
  returning id into v_policy;
  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_pos:=v_pos+1;
    if coalesce((v_step->>'channel'),'') not in ('email','whatsapp','sms')
       or (v_step->>'days_after_due')::int not between -30 and 365
       or length(btrim(coalesce(v_step->>'message_template',''))) not between 1 and 4000 then
      raise exception using errcode='22023',message='Uma etapa da régua possui canal, prazo ou mensagem inválida.';
    end if;
    insert into apticket.collection_policy_steps(tenant_id,operating_company_id,policy_id,position,
      days_after_due,channel,subject,message_template,enabled)
    values(v_tenant,p_company,v_policy,v_pos,(v_step->>'days_after_due')::int,v_step->>'channel',
      nullif(btrim(v_step->>'subject'),''),btrim(v_step->>'message_template'),coalesce((v_step->>'enabled')::boolean,true))
    on conflict(policy_id,position) do update set days_after_due=excluded.days_after_due,
      channel=excluded.channel,subject=excluded.subject,message_template=excluded.message_template,
      enabled=excluded.enabled,deleted_at=null;
  end loop;
  update apticket.collection_policy_steps set deleted_at=clock_timestamp()
    where policy_id=v_policy and position>v_pos and deleted_at is null;
  return v_policy;
end $$;

create function apticket.save_collection_policy(
  p_company uuid,p_enabled boolean,p_suspend_after_days integer,p_steps jsonb
) returns uuid language sql security definer set search_path=pg_catalog as $$
  select apticket_finance_private.save_collection_policy(p_company,p_enabled,p_suspend_after_days,p_steps)
$$;

create function apticket.get_collection_policy(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id(); v_policy apticket.collection_policies; v_configured boolean;
begin
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_company) then
    raise exception using errcode='42501',message='Você não possui permissão para consultar a régua de cobrança.';
  end if;
  select * into v_policy from apticket.collection_policies where tenant_id=v_tenant
    and operating_company_id=p_company and deleted_at is null;
  v_configured:=found;
  return jsonb_build_object(
    'company_id',p_company,'configured',v_configured,'enabled',coalesce(v_policy.enabled,false),
    'suspend_after_days',v_policy.suspend_after_days,
    'steps',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,
      'days_after_due',s.days_after_due,'channel',s.channel,'subject',s.subject,
      'message_template',s.message_template,'enabled',s.enabled) order by s.position)
      from apticket.collection_policy_steps s where s.policy_id=v_policy.id and s.deleted_at is null),'[]'::jsonb),
    'pending_actions',coalesce((select count(*) from apticket.collection_actions a
      where a.policy_id=v_policy.id and a.status='pending'),0),
    'failed_actions',coalesce((select count(*) from apticket.collection_actions a
      where a.policy_id=v_policy.id and a.status='failed'),0),
    'pending_events',coalesce((select count(*) from apticket.financial_domain_events e
      where e.tenant_id=v_tenant and e.operating_company_id=p_company and e.status='pending'),0),
    'updated_at',v_policy.updated_at
  );
end $$;

create function apticket_finance_private.evaluate_collection_policy(
  p_tenant uuid,p_company uuid,p_as_of date
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_policy apticket.collection_policies; v_actions int:=0; v_events int:=0;
begin
  select * into v_policy from apticket.collection_policies where tenant_id=p_tenant
    and operating_company_id=p_company and enabled and deleted_at is null for update;
  if not found then return jsonb_build_object('actions',0,'events',0,'enabled',false); end if;
  insert into apticket.collection_actions(tenant_id,operating_company_id,policy_id,policy_step_id,
    receivable_id,contract_id,due_date,scheduled_for,channel,recipient_snapshot,content_snapshot)
  select r.tenant_id,r.operating_company_id,v_policy.id,s.id,r.id,r.contrato_id,r.vencimento_em,
    r.vencimento_em+s.days_after_due,s.channel,
    jsonb_build_object('company_id',r.company_id,'customer_name',r.cliente_nome),
    jsonb_build_object('subject',s.subject,'message_template',s.message_template,
      'document',r.documento_referencia,'amount',r.valor_aberto,'due_date',r.vencimento_em)
  from apticket.contas_receber r join apticket.collection_policy_steps s on s.policy_id=v_policy.id
  where r.tenant_id=p_tenant and r.operating_company_id=p_company and r.deleted_at is null
    and r.status_cobranca='vencido' and r.valor_aberto>0 and s.enabled and s.deleted_at is null
    and r.vencimento_em+s.days_after_due<=p_as_of
  on conflict(receivable_id,policy_step_id) do nothing;
  get diagnostics v_actions=row_count;
  if v_policy.suspend_after_days is not null then
    insert into apticket.financial_domain_events(tenant_id,operating_company_id,aggregate_type,aggregate_id,
      event_type,source_id,payload)
    select r.tenant_id,r.operating_company_id,'contract',r.contrato_id,'contract.suspended_for_delinquency',r.id,
      jsonb_build_object('receivable_id',r.id,'document',r.documento_referencia,'due_date',r.vencimento_em,
        'open_amount',r.valor_aberto,'days_overdue',p_as_of-r.vencimento_em)
    from apticket.contas_receber r where r.tenant_id=p_tenant and r.operating_company_id=p_company
      and r.deleted_at is null and r.status_cobranca='vencido' and r.valor_aberto>0
      and r.vencimento_em+v_policy.suspend_after_days<=p_as_of
    on conflict(event_type,source_id) do nothing;
    get diagnostics v_events=row_count;
  end if;
  return jsonb_build_object('actions',v_actions,'events',v_events,'enabled',true);
end $$;

create function apticket.evaluate_collection_policy(p_company uuid,p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id();
begin
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_company,true) then
    raise exception using errcode='42501',message='Você não possui permissão para processar a régua de cobrança.';
  end if;
  return apticket_finance_private.evaluate_collection_policy(v_tenant,p_company,p_as_of);
end $$;

revoke all on function apticket_finance_private.save_collection_policy(uuid,boolean,integer,jsonb),
  apticket_finance_private.evaluate_collection_policy(uuid,uuid,date) from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.evaluate_collection_policy(uuid,uuid,date) to service_role;
revoke all on function apticket.save_collection_policy(uuid,boolean,integer,jsonb),
  apticket.get_collection_policy(uuid),apticket.evaluate_collection_policy(uuid,date) from public,anon;
grant execute on function apticket.save_collection_policy(uuid,boolean,integer,jsonb),
  apticket.get_collection_policy(uuid),apticket.evaluate_collection_policy(uuid,date) to authenticated;

notify pgrst,'reload schema';
