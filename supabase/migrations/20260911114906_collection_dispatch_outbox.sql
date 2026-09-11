alter table apticket.collection_actions
  add column external_id text,
  add column next_attempt_at timestamptz default clock_timestamp();

create index collection_actions_retry_idx
  on apticket.collection_actions(next_attempt_at,status)
  where status in ('pending','failed');

create function apticket_finance_private.guard_collection_outbox()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='collection_actions' and
    (to_jsonb(new)-array['status','attempt_count','last_error','processed_at','external_id','next_attempt_at'])
      is distinct from
    (to_jsonb(old)-array['status','attempt_count','last_error','processed_at','external_id','next_attempt_at']) then
    raise exception using errcode='23514',message='O conteúdo da ação de cobrança é imutável.';
  end if;
  if tg_table_name='financial_domain_events' and
    (to_jsonb(new)-array['status','attempt_count','last_error','processed_at'])
      is distinct from
    (to_jsonb(old)-array['status','attempt_count','last_error','processed_at']) then
    raise exception using errcode='23514',message='O conteúdo do evento financeiro é imutável.';
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.guard_collection_outbox()
  from public,anon,authenticated,service_role;
create trigger protect_collection_action before update on apticket.collection_actions
  for each row execute function apticket_finance_private.guard_collection_outbox();
create trigger protect_financial_domain_event before update on apticket.financial_domain_events
  for each row execute function apticket_finance_private.guard_collection_outbox();

create or replace function apticket_finance_private.evaluate_collection_policy(
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
    jsonb_build_object('contact_id',recipient.id,'name',coalesce(recipient.name,r.cliente_nome),
      'email',recipient.email,'phone',recipient.phone,'company_id',r.company_id,'customer_name',r.cliente_nome),
    jsonb_build_object('subject',s.subject,'message_template',s.message_template,
      'document',r.documento_referencia,'amount',r.valor_aberto,'due_date',r.vencimento_em)
  from apticket.contas_receber r join apticket.collection_policy_steps s on s.policy_id=v_policy.id
  left join lateral (
    select c.id,c.name,c.email,c.phone from apticket.contacts c
    where c.tenant_id=r.tenant_id and c.company_id=r.company_id and c.is_active
      and ((s.channel='email' and nullif(btrim(c.email),'') is not null)
        or (s.channel in ('whatsapp','sms') and nullif(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),'') is not null))
    order by c.can_open_tickets desc,c.created_at,c.id limit 1
  ) recipient on true
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

create function apticket_finance_private.claim_collection_actions(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_result jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='A fila de cobrança exige credencial de serviço.';
  end if;
  if p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='Limite inválido para a fila de cobrança.';
  end if;
  update apticket.collection_actions set status='failed',last_error='Processamento interrompido antes da confirmação.',
    next_attempt_at=clock_timestamp(),processed_at=clock_timestamp()
  where status='processing' and processed_at<clock_timestamp()-interval '30 minutes';
  with candidates as (
    select id from apticket.collection_actions
    where status in ('pending','failed') and attempt_count<5 and next_attempt_at is not null
      and next_attempt_at<=clock_timestamp() and scheduled_for<=current_date
    order by scheduled_for,created_at for update skip locked limit p_limit
  ), claimed as (
    update apticket.collection_actions a set status='processing',attempt_count=a.attempt_count+1,
      processed_at=clock_timestamp(),last_error=null
    from candidates c where a.id=c.id
    returning a.id,a.tenant_id,a.operating_company_id,a.channel,a.attempt_count,
      a.recipient_snapshot,a.content_snapshot
  ) select coalesce(jsonb_agg(to_jsonb(claimed) order by id),'[]'::jsonb) into v_result from claimed;
  return v_result;
end $$;

create function apticket_finance_private.finish_collection_action(
  p_action uuid,p_success boolean,p_external_id text default null,p_error text default null,p_retryable boolean default true
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_action apticket.collection_actions;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='A fila de cobrança exige credencial de serviço.';
  end if;
  select * into v_action from apticket.collection_actions where id=p_action for update;
  if not found or v_action.status<>'processing' then
    raise exception using errcode='40001',message='A ação não está disponível para conclusão.';
  end if;
  if p_success then
    update apticket.collection_actions set status='sent',external_id=nullif(left(p_external_id,500),''),
      last_error=null,next_attempt_at=null,processed_at=clock_timestamp() where id=p_action;
  else
    update apticket.collection_actions set status='failed',last_error=left(coalesce(nullif(p_error,''),'Falha não informada.'),2000),
      next_attempt_at=case when p_retryable and attempt_count<5 then
        clock_timestamp()+make_interval(mins=>least(1440,15*(2^greatest(attempt_count-1,0))::integer)) end,
      processed_at=clock_timestamp() where id=p_action;
  end if;
  return jsonb_build_object('id',p_action,'status',case when p_success then 'sent' else 'failed' end,
    'retryable',not p_success and p_retryable and v_action.attempt_count<5);
end $$;

revoke all on function apticket_finance_private.claim_collection_actions(integer),
  apticket_finance_private.finish_collection_action(uuid,boolean,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.claim_collection_actions(integer),
  apticket_finance_private.finish_collection_action(uuid,boolean,text,text,boolean) to service_role;

create function apticket.claim_collection_actions(p_limit integer default 100)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select apticket_finance_private.claim_collection_actions(p_limit)
$$;
create function apticket.finish_collection_action(
  p_action uuid,p_success boolean,p_external_id text default null,p_error text default null,p_retryable boolean default true
) returns jsonb language sql security definer set search_path=pg_catalog as $$
  select apticket_finance_private.finish_collection_action(p_action,p_success,p_external_id,p_error,p_retryable)
$$;
revoke all on function apticket.claim_collection_actions(integer),
  apticket.finish_collection_action(uuid,boolean,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function apticket.claim_collection_actions(integer),
  apticket.finish_collection_action(uuid,boolean,text,text,boolean) to service_role;

notify pgrst,'reload schema';
