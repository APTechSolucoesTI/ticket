-- Configurações gerais por tenant; Sim preserva o comportamento anterior.
create table apticket.financial_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references apticket.tenants(id) on delete restrict,
  use_payable_approvals boolean not null default true,
  use_collection_rules boolean not null default true,
  updated_by uuid references apticket.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
alter table apticket.financial_settings enable row level security;
revoke all on apticket.financial_settings from public,anon,authenticated,service_role;
grant select on apticket.financial_settings to authenticated,service_role;
create policy financial_settings_read on apticket.financial_settings for select to authenticated
  using (tenant_id=apticket.current_tenant_id() and
    (apticket.has_permission(auth.uid(),'configuracoes','view')
     or apticket.has_permission(auth.uid(),'financeiro','view')));
create trigger audit_financial_settings after insert or update on apticket.financial_settings
  for each row execute function apticket_finance_private.audit_record();
create trigger guard_financial_settings_delete before delete on apticket.financial_settings
  for each row execute function apticket_finance_private.guard_record();
create trigger guard_financial_settings_truncate before truncate on apticket.financial_settings
  for each statement execute function apticket_finance_private.guard_record();

create function apticket_finance_private.financial_feature_enabled(p_tenant uuid,p_feature text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
  select case p_feature
    when 'payable_approvals' then coalesce((select use_payable_approvals from apticket.financial_settings where tenant_id=p_tenant),true)
    when 'collection_rules' then coalesce((select use_collection_rules from apticket.financial_settings where tenant_id=p_tenant),true)
    else false end
$$;
revoke all on function apticket_finance_private.financial_feature_enabled(uuid,text)
  from public,anon,authenticated,service_role;

create function apticket.get_financial_settings()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null
    or not exists(select 1 from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active)
    or not (apticket.has_permission(auth.uid(),'configuracoes','view')
      or apticket.has_permission(auth.uid(),'financeiro','view')) then
    raise exception using errcode='42501',message='Sem permissão para consultar as configurações financeiras.';
  end if;
  return jsonb_build_object(
    'use_payable_approvals',apticket_finance_private.financial_feature_enabled(v_tenant,'payable_approvals'),
    'use_collection_rules',apticket_finance_private.financial_feature_enabled(v_tenant,'collection_rules'));
end $$;

create function apticket.save_financial_settings(p_use_payable_approvals boolean,p_use_collection_rules boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null
    or not exists(select 1 from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active)
    or not apticket.has_permission(auth.uid(),'configuracoes','view')
    or not apticket.has_permission(auth.uid(),'configuracoes','edit') then
    raise exception using errcode='42501',message='Sem permissão para alterar as configurações financeiras.';
  end if;
  if p_use_payable_approvals is null or p_use_collection_rules is null then
    raise exception using errcode='22023',message='Informe Sim ou Não para as duas funcionalidades financeiras.';
  end if;
  insert into apticket.financial_settings(tenant_id,use_payable_approvals,use_collection_rules,updated_by)
    values(v_tenant,p_use_payable_approvals,p_use_collection_rules,auth.uid())
    on conflict(tenant_id) do update set use_payable_approvals=excluded.use_payable_approvals,
      use_collection_rules=excluded.use_collection_rules,updated_by=auth.uid(),updated_at=clock_timestamp();
  return true;
end $$;
revoke all on function apticket.get_financial_settings(),apticket.save_financial_settings(boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function apticket.get_financial_settings(),apticket.save_financial_settings(boolean,boolean)
  to authenticated;
comment on table apticket.financial_settings is 'Controles gerais de alçada e régua por tenant. Ausência de registro equivale a Sim; somente Configurações/edit altera via RPC auditada.';

-- apticket.schedule_supplier_payment
CREATE OR REPLACE FUNCTION apticket.schedule_supplier_payment(p_supplier_payable_id uuid, p_bank_account_id uuid, p_scheduled_date date, p_payment_method text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare p apticket.supplier_payables; a apticket.supplier_bank_accounts; v_id uuid; v_name text; begin
  if not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissao para esta operacao financeira.';
  end if;
  select * into p from apticket.supplier_payables where id=p_supplier_payable_id
    and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Lancamento nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para programar pagamentos.';
  end if;
  -- Sem alçada, a liberação ocorre na mesma transação do agendamento.
  -- Solicitações já em aprovação continuam pelo fluxo original.
  if p.status='scheduled' and p.allocation_status='complete'
    and not apticket_finance_private.financial_feature_enabled(p.tenant_id,'payable_approvals') then
    update apticket.supplier_payables set status='approved' where id=p.id;
    p.status:='approved';
  end if;
  if p.status<>'approved' then
    raise exception using errcode='23514',message='Somente lancamentos aprovados podem ser programados para pagamento.';
  end if;
  if p_scheduled_date is null then
    raise exception using errcode='23514',message='Informe a data programada para o pagamento.';
  end if;
  if p_payment_method not in ('pix','bank_transfer','boleto','other') then
    raise exception using errcode='23514',message='A forma de pagamento e invalida.';
  end if;
  select * into a from apticket.supplier_bank_accounts where id=p_bank_account_id
    and supplier_id=p.supplier_id and tenant_id=p.tenant_id and operating_company_id=p.operating_company_id
    and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um dado bancario ativo deste fornecedor.';
  end if;
  select id into v_id from apticket.supplier_payments where supplier_payable_id=p.id
    and status in ('scheduled','paid');
  if found then return v_id; end if;
  select name into v_name from apticket.profiles where id=auth.uid() and tenant_id=p.tenant_id and is_active;
  if v_name is null then raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.'; end if;
  v_id:=gen_random_uuid();
  insert into apticket.supplier_payments(id,tenant_id,operating_company_id,supplier_id,
    supplier_payable_id,bank_account_id,payment_method,scheduled_date,scheduled_amount,
    bank_snapshot,scheduling_notes,scheduled_by,scheduled_by_name)
  values(v_id,p.tenant_id,p.operating_company_id,p.supplier_id,p.id,a.id,p_payment_method,
    p_scheduled_date,p.total_amount,
    jsonb_build_object('label',a.label,'holder_name',a.holder_name,'holder_tax_id',a.holder_tax_id,
      'bank_code',a.bank_code,'bank_name',a.bank_name,'branch',a.branch,
      'account_number',a.account_number,'account_digit',a.account_digit,
      'account_type',a.account_type,'pix_key_type',a.pix_key_type,'pix_key',a.pix_key),
    nullif(btrim(p_notes),''),auth.uid(),v_name);
  return v_id;
end $function$;

-- apticket_finance_private.guard_supplier_payable
CREATE OR REPLACE FUNCTION apticket_finance_private.guard_supplier_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.allocation_status is distinct from old.allocation_status then
    if old.allocation_status='pending_rule' and new.allocation_status='complete' then
      return new;
    end if;
    raise exception using errcode='23514',message='A situacao do rateio nao pode retroceder.';
  end if;
  if new.status is distinct from old.status then
    if (old.status='scheduled' and new.status='awaiting_approval' and new.allocation_status='complete')
      or (old.status='awaiting_approval' and new.status in ('approved','scheduled'))
      or (old.status='scheduled' and new.status='approved' and new.allocation_status='complete'
        and not apticket_finance_private.financial_feature_enabled(new.tenant_id,'payable_approvals'))
      or (old.status='approved' and new.status='paid') then
      return new;
    end if;
    raise exception using errcode='23514',message='A transicao financeira deste lancamento nao e permitida.';
  end if;
  if new.deleted_at is distinct from old.deleted_at then return new; end if;
  raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
end $function$;

-- apticket.submit_supplier_payable_for_approval
CREATE OR REPLACE FUNCTION apticket.submit_supplier_payable_for_approval(p_supplier_payable_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  p apticket.supplier_payables;
  policy apticket.supplier_approval_policies;
  v_request_id uuid:=gen_random_uuid();
  v_actor_name text;
  v_steps integer;
begin
  if not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') then
    raise exception using errcode='42501',message='Sem permissao para esta operacao financeira.';
  end if;
  select * into p from apticket.supplier_payables
    where id=p_supplier_payable_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Lancamento nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para enviar o lancamento.';
  end if;
  if not apticket_finance_private.financial_feature_enabled(p.tenant_id,'payable_approvals') then
    raise exception using errcode='23514',message='A alçada de aprovação está desativada nas configurações financeiras.';
  end if;
  if p.status<>'scheduled' then
    raise exception using errcode='23514',message='Somente lancamentos agendados podem ser enviados para aprovacao.';
  end if;
  if p.allocation_status<>'complete' then
    raise exception using errcode='23514',message='Conclua o rateio antes de enviar o lancamento para aprovacao.';
  end if;
  select * into policy from apticket.supplier_approval_policies candidate
    where candidate.tenant_id=p.tenant_id and candidate.operating_company_id=p.operating_company_id
      and candidate.is_active and candidate.deleted_at is null
      and p.total_amount>=candidate.minimum_amount
      and (candidate.maximum_amount is null or p.total_amount<=candidate.maximum_amount)
    order by candidate.minimum_amount desc limit 1 for update;
  if not found then
    raise exception using errcode='23514',message='Nenhuma alcada ativa contempla o valor deste lancamento.';
  end if;
  select name into v_actor_name from apticket.profiles
    where id=auth.uid() and tenant_id=p.tenant_id and is_active;
  if v_actor_name is null then
    raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.';
  end if;
  select count(*) into v_steps from apticket.supplier_approval_policy_steps step
    join apticket.profiles profile on profile.id=step.approver_id
      and profile.tenant_id=step.tenant_id and profile.is_active
    where step.policy_id=policy.id and step.deleted_at is null;
  if v_steps=0 or v_steps<>(select count(*) from apticket.supplier_approval_policy_steps
    where policy_id=policy.id and deleted_at is null) then
    raise exception using errcode='23514',message='A alcada possui aprovador inativo ou nenhuma etapa configurada.';
  end if;
  insert into apticket.supplier_payable_approval_requests(id,tenant_id,operating_company_id,
    supplier_payable_id,policy_id,policy_name,payable_amount,submitted_by,submitted_by_name)
  values(v_request_id,p.tenant_id,p.operating_company_id,p.id,policy.id,policy.name,
    p.total_amount,auth.uid(),v_actor_name);
  insert into apticket.supplier_payable_approval_steps(tenant_id,operating_company_id,
    request_id,step_order,approver_id,approver_name)
  select step.tenant_id,step.operating_company_id,v_request_id,step.step_order,
    step.approver_id,profile.name
  from apticket.supplier_approval_policy_steps step
  join apticket.profiles profile on profile.id=step.approver_id and profile.tenant_id=step.tenant_id
  where step.policy_id=policy.id and step.deleted_at is null order by step.step_order;
  update apticket.supplier_payables set status='awaiting_approval' where id=p.id;
  return v_request_id;
end $function$;

-- apticket_finance_private.evaluate_collection_policy
CREATE OR REPLACE FUNCTION apticket_finance_private.evaluate_collection_policy(p_tenant uuid, p_company uuid, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_policy apticket.collection_policies; v_actions int:=0; v_events int:=0;
begin
  if not apticket_finance_private.financial_feature_enabled(p_tenant,'collection_rules') then
    return jsonb_build_object('actions',0,'events',0,'enabled',false);
  end if;
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
end $function$;

-- apticket.schedule_collection_policies
CREATE OR REPLACE FUNCTION apticket.schedule_collection_policies(p_as_of date DEFAULT CURRENT_DATE, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_policy record; v_result jsonb; v_policies int:=0; v_actions int:=0; v_events int:=0;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='A rotina automática exige credencial de serviço.';
  end if;
  if p_as_of>current_date or p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='Data ou limite inválido para processar a régua.';
  end if;
  for v_policy in select tenant_id,operating_company_id from apticket.collection_policies
    where enabled and deleted_at is null
      and apticket_finance_private.financial_feature_enabled(tenant_id,'collection_rules')
    order by updated_at limit p_limit
  loop
    v_result:=apticket_finance_private.evaluate_collection_policy(v_policy.tenant_id,v_policy.operating_company_id,p_as_of);
    v_policies:=v_policies+1;
    v_actions:=v_actions+coalesce((v_result->>'actions')::int,0);
    v_events:=v_events+coalesce((v_result->>'events')::int,0);
  end loop;
  return jsonb_build_object('policies',v_policies,'actions',v_actions,'events',v_events,
    'limit_reached',v_policies=p_limit);
end $function$;

-- apticket_finance_private.claim_collection_actions
CREATE OR REPLACE FUNCTION apticket_finance_private.claim_collection_actions(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      and apticket_finance_private.financial_feature_enabled(tenant_id,'collection_rules')
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
end $function$;

-- apticket_finance_private.process_contract_financial_events
CREATE OR REPLACE FUNCTION apticket_finance_private.process_contract_financial_events(p_limit integer DEFAULT 100, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_event apticket.financial_domain_events;
  v_receivable apticket.contas_receber;
  v_contract apticket.contracts;
  v_hold apticket.contract_financial_holds;
  v_has_financial_hold boolean;
  v_suspended integer:=0;
  v_released integer:=0;
  v_ignored integer:=0;
  v_failed integer:=0;
  v_resulting_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='O processamento de contratos exige credencial de servico.';
  end if;
  if p_limit not between 1 and 500 or p_as_of is null or p_as_of>current_date then
    raise exception using errcode='22023',message='Limite ou data de processamento invalida.';
  end if;

  update apticket.financial_domain_events
     set status='failed',last_error='Processamento interrompido antes da confirmacao.',
         next_attempt_at=clock_timestamp(),processed_at=clock_timestamp()
   where event_type='contract.suspended_for_delinquency'
     and status='processing'
     and processed_at<clock_timestamp()-interval '30 minutes';

  for v_event in
    select e.* from apticket.financial_domain_events e
     where e.event_type='contract.suspended_for_delinquency'
       and e.status in ('pending','failed') and e.attempt_count<5
       and apticket_finance_private.financial_feature_enabled(e.tenant_id,'collection_rules')
       and e.next_attempt_at is not null and e.next_attempt_at<=clock_timestamp()
     order by e.occurred_at,e.id
     for update skip locked limit p_limit
  loop
    begin
      update apticket.financial_domain_events
         set status='processing',attempt_count=attempt_count+1,
             last_error=null,processed_at=clock_timestamp()
       where id=v_event.id;

      select * into strict v_receivable from apticket.contas_receber
       where id=v_event.source_id and tenant_id=v_event.tenant_id
         and operating_company_id=v_event.operating_company_id for update;

      if v_receivable.deleted_at is not null
         or v_receivable.status_cobranca<>'vencido'
         or v_receivable.valor_aberto<=0 then
        update apticket.financial_domain_events
           set status='cancelled',last_error='Titulo sem inadimplencia ativa.',
               next_attempt_at=null,processed_at=clock_timestamp()
         where id=v_event.id;
        v_ignored:=v_ignored+1;
        continue;
      end if;

      select * into strict v_contract from apticket.contracts
       where id=v_event.aggregate_id and tenant_id=v_event.tenant_id for update;
      select exists(select 1 from apticket.contract_financial_holds h
        where h.contract_id=v_contract.id and h.status='active') into v_has_financial_hold;

      if v_contract.status='active' and v_contract.starts_at<=p_as_of
         and v_contract.ends_at>=p_as_of then
        insert into apticket.contract_financial_holds(
          tenant_id,operating_company_id,contract_id,event_id,receivable_id,
          status,changed_contract_status,previous_contract_status
        ) values (
          v_event.tenant_id,v_event.operating_company_id,v_contract.id,v_event.id,
          v_receivable.id,'active',true,v_contract.status
        );
        perform set_config('apticket.financial_event_processing','on',true);
        update apticket.contracts set status='suspended' where id=v_contract.id;
        v_suspended:=v_suspended+1;
      elsif v_contract.status='suspended' and v_has_financial_hold then
        insert into apticket.contract_financial_holds(
          tenant_id,operating_company_id,contract_id,event_id,receivable_id,
          status,changed_contract_status,previous_contract_status
        ) values (
          v_event.tenant_id,v_event.operating_company_id,v_contract.id,v_event.id,
          v_receivable.id,'active',false,v_contract.status
        );
      else
        insert into apticket.contract_financial_holds(
          tenant_id,operating_company_id,contract_id,event_id,receivable_id,
          status,changed_contract_status,previous_contract_status,release_reason,released_at
        ) values (
          v_event.tenant_id,v_event.operating_company_id,v_contract.id,v_event.id,
          v_receivable.id,'ignored',false,v_contract.status,
          case when v_contract.status='suspended' then 'preexisting_suspension'
               else 'contract_not_eligible' end,clock_timestamp()
        );
        v_ignored:=v_ignored+1;
      end if;

      update apticket.financial_domain_events
         set status='processed',last_error=null,next_attempt_at=null,
             processed_at=clock_timestamp()
       where id=v_event.id;
    exception when others then
      update apticket.financial_domain_events
         set status='failed',attempt_count=least(attempt_count+1,20),
             last_error=left(sqlerrm,2000),
             next_attempt_at=case when attempt_count+1<5 then
               clock_timestamp()+make_interval(mins=>least(1440,15*(2^greatest(attempt_count,0))::integer)) end,
             processed_at=clock_timestamp()
       where id=v_event.id;
      v_failed:=v_failed+1;
    end;
  end loop;

  for v_hold in
    select h.* from apticket.contract_financial_holds h
    join apticket.contas_receber r on r.id=h.receivable_id
     where h.status='active'
       and (r.deleted_at is not null or r.status_cobranca<>'vencido' or r.valor_aberto<=0)
     order by h.applied_at,h.id for update of h skip locked limit p_limit
  loop
    update apticket.contract_financial_holds
       set status='released',released_at=clock_timestamp(),release_reason='payment_settled'
     where id=v_hold.id;
  end loop;

  for v_hold in
    select h.* from apticket.contract_financial_holds h
     where h.status='released' and h.changed_contract_status and h.restored_at is null
       and not exists(select 1 from apticket.contract_financial_holds active_hold
         where active_hold.contract_id=h.contract_id and active_hold.status='active')
     order by h.released_at,h.id for update of h skip locked limit p_limit
  loop
    select * into strict v_contract from apticket.contracts
     where id=v_hold.contract_id and tenant_id=v_hold.tenant_id for update;
    v_resulting_status:=v_contract.status::text;
    if v_contract.status='suspended' then
      v_resulting_status:=case when v_contract.ends_at<p_as_of then 'expired' else 'active' end;
      perform set_config('apticket.financial_event_processing','on',true);
      update apticket.contracts
         set status=v_resulting_status::apticket.contract_status
       where id=v_contract.id;
      v_released:=v_released+1;
    end if;
    update apticket.contract_financial_holds
       set restored_at=clock_timestamp() where id=v_hold.id;
    insert into apticket.financial_domain_events(
      tenant_id,operating_company_id,aggregate_type,aggregate_id,event_type,
      source_id,payload,status,attempt_count,next_attempt_at,processed_at
    ) values (
      v_hold.tenant_id,v_hold.operating_company_id,'contract',v_hold.contract_id,
      'contract.financial_suspension_released',v_hold.receivable_id,
      jsonb_build_object('hold_id',v_hold.id,'resulting_status',v_resulting_status,
        'release_reason',v_hold.release_reason),
      'processed',1,null,clock_timestamp()
    ) on conflict(event_type,source_id) do nothing;
  end loop;

  return jsonb_build_object(
    'suspended_contracts',v_suspended,
    'released_contracts',v_released,
    'ignored_events',v_ignored,
    'failed_events',v_failed
  );
end $function$;

-- Revalida trabalhos já enfileirados antes de qualquer envio externo.
-- Pausar não consome tentativas; reativar permite retomar a mesma ação.
create function apticket.prepare_collection_action_dispatch(p_action uuid,p_attempt_count integer)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare v_action apticket.collection_actions;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='O despacho de cobrança exige credencial de serviço.';
  end if;
  select * into v_action from apticket.collection_actions where id=p_action for update;
  if not found or v_action.status<>'processing' or p_attempt_count is null
    or v_action.attempt_count<>p_attempt_count then return false; end if;
  if not apticket_finance_private.financial_feature_enabled(v_action.tenant_id,'collection_rules') then
    update apticket.collection_actions set status='pending',attempt_count=greatest(0,attempt_count-1),
      next_attempt_at=clock_timestamp(),processed_at=null,last_error='Régua de cobrança pausada nas configurações financeiras.'
      where id=v_action.id;
    return false;
  end if;
  return true;
end $$;
revoke all on function apticket.prepare_collection_action_dispatch(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function apticket.prepare_collection_action_dispatch(uuid,integer) to service_role;

notify pgrst,'reload schema';
