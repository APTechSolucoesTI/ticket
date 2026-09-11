-- Fatia 16: consome eventos financeiros sem misturar a decisao financeira
-- com a operacao de contratos. Somente o worker com service_role pode aplicar
-- ou liberar uma suspensao.

alter table apticket.financial_domain_events
  drop constraint financial_domain_events_event_type_check;
alter table apticket.financial_domain_events
  add constraint financial_domain_events_event_type_check check (
    event_type in (
      'contract.suspended_for_delinquency',
      'contract.financial_suspension_released'
    )
  );
alter table apticket.financial_domain_events
  add column next_attempt_at timestamptz default clock_timestamp();

create table apticket.contract_financial_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  contract_id uuid not null,
  event_id uuid not null unique,
  receivable_id uuid not null,
  status text not null default 'active'
    check (status in ('active','released','ignored')),
  changed_contract_status boolean not null default false,
  previous_contract_status apticket.contract_status,
  applied_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  restored_at timestamptz,
  release_reason text,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, tenant_id, operating_company_id),
  foreign key (operating_company_id, tenant_id)
    references apticket.operating_companies(id, tenant_id) on delete restrict,
  foreign key (contract_id, tenant_id)
    references apticket.contracts(id, tenant_id) on delete restrict,
  foreign key (receivable_id, tenant_id, operating_company_id)
    references apticket.contas_receber(id, tenant_id, operating_company_id) on delete restrict,
  foreign key (event_id) references apticket.financial_domain_events(id) on delete restrict
);

create index contract_financial_holds_active_idx
  on apticket.contract_financial_holds(contract_id, status)
  where status = 'active';
create index financial_domain_events_retry_idx
  on apticket.financial_domain_events(next_attempt_at, status, event_type)
  where status in ('pending','failed');

alter table apticket.contract_financial_holds enable row level security;
revoke all on apticket.contract_financial_holds
  from public, anon, authenticated, service_role;
grant select on apticket.contract_financial_holds to authenticated, service_role;
grant insert, update on apticket.contract_financial_holds to service_role;
create policy financial_scoped_read on apticket.contract_financial_holds
  for select to authenticated
  using (apticket.has_financial_scope(tenant_id, operating_company_id));
create trigger guard_delete before delete on apticket.contract_financial_holds
  for each row execute function apticket_finance_private.guard_record();
create trigger guard_truncate before truncate on apticket.contract_financial_holds
  for each statement execute function apticket_finance_private.guard_record();
create trigger guard_identity before update on apticket.contract_financial_holds
  for each row execute function apticket_finance_private.guard_record();
create trigger audit_change after insert or update on apticket.contract_financial_holds
  for each row execute function apticket_finance_private.audit_record();

create or replace function apticket_finance_private.guard_collection_outbox()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='collection_actions' and
    (to_jsonb(new)-array['status','attempt_count','last_error','processed_at','external_id','next_attempt_at'])
      is distinct from
    (to_jsonb(old)-array['status','attempt_count','last_error','processed_at','external_id','next_attempt_at']) then
    raise exception using errcode='23514',message='O conteudo da acao de cobranca e imutavel.';
  end if;
  if tg_table_name='financial_domain_events' and
    (to_jsonb(new)-array['status','attempt_count','last_error','processed_at','next_attempt_at'])
      is distinct from
    (to_jsonb(old)-array['status','attempt_count','last_error','processed_at','next_attempt_at']) then
    raise exception using errcode='23514',message='O conteudo do evento financeiro e imutavel.';
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.guard_collection_outbox()
  from public, anon, authenticated, service_role;

-- Se um usuario alterar o status enquanto o bloqueio financeiro esta ativo,
-- essa decisao manual passa a prevalecer e o worker nao reativa o contrato.
create function apticket_finance_private.release_hold_on_manual_contract_change()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if old.status is distinct from new.status
     and coalesce(current_setting('apticket.financial_event_processing', true),'') <> 'on' then
    update apticket.contract_financial_holds
       set status=case when status='active' then 'released' else status end,
           changed_contract_status=false,
           released_at=coalesce(released_at,clock_timestamp()),
           release_reason='manual_override'
     where contract_id=new.id and tenant_id=new.tenant_id
       and restored_at is null and (status='active' or changed_contract_status);
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.release_hold_on_manual_contract_change()
  from public, anon, authenticated, service_role;
create trigger release_financial_hold_on_manual_status
  after update of status on apticket.contracts
  for each row execute function apticket_finance_private.release_hold_on_manual_contract_change();

create function apticket_finance_private.process_contract_financial_events(
  p_limit integer default 100,
  p_as_of date default current_date
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end $$;
revoke all on function apticket_finance_private.process_contract_financial_events(integer,date)
  from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.process_contract_financial_events(integer,date)
  to service_role;

create function apticket.process_contract_financial_events(
  p_limit integer default 100,
  p_as_of date default current_date
) returns jsonb language sql security definer set search_path=pg_catalog as $$
  select apticket_finance_private.process_contract_financial_events(p_limit,p_as_of)
$$;
revoke all on function apticket.process_contract_financial_events(integer,date)
  from public,anon,authenticated,service_role;
grant execute on function apticket.process_contract_financial_events(integer,date)
  to service_role;

comment on table apticket.contract_financial_holds is
  'Vincula a inadimplencia ao status operacional aplicado pelo worker; somente suspensoes pertencentes a este fluxo podem ser revertidas automaticamente.';
notify pgrst,'reload schema';
