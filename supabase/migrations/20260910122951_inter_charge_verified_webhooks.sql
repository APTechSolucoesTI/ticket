-- Fatia 12: callbacks do Inter sao apenas gatilhos. Nenhum estado financeiro
-- e alterado com base no payload recebido; a confirmacao sempre ocorre por
-- consulta ativa autenticada com mTLS na API de Cobranca V3.

alter table apticket.tenant_inter_configurations
  add column webhook_status text not null default 'not_configured'
    check (webhook_status in ('not_configured','configuring','active','failed')),
  add column webhook_callback_base_url text
    check (webhook_callback_base_url is null or length(webhook_callback_base_url) <= 500),
  add column webhook_secret_hash text
    check (webhook_secret_hash is null or webhook_secret_hash ~ '^[0-9a-f]{64}$'),
  add column webhook_secret_id uuid references vault.secrets(id) on delete restrict,
  add column webhook_registered_at timestamptz,
  add column webhook_updated_at timestamptz,
  add column webhook_last_error_code text
    check (webhook_last_error_code is null or length(webhook_last_error_code) <= 60),
  add column webhook_last_error_message text
    check (webhook_last_error_message is null or length(webhook_last_error_message) <= 300),
  add constraint tenant_inter_webhook_state_check check (
    (webhook_status = 'active' and webhook_callback_base_url is not null
      and webhook_secret_hash is not null and webhook_secret_id is not null
      and webhook_registered_at is not null)
    or webhook_status <> 'active'
  );

create function apticket_finance_private.invalidate_inter_webhook_on_credentials_change()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.version is distinct from old.version then
    new.webhook_status := 'not_configured';
    new.webhook_callback_base_url := null;
    new.webhook_secret_hash := null;
    new.webhook_registered_at := null;
    new.webhook_updated_at := clock_timestamp();
    new.webhook_last_error_code := null;
    new.webhook_last_error_message := null;
  end if;
  return new;
end $$;
revoke all on function apticket_finance_private.invalidate_inter_webhook_on_credentials_change()
  from public,anon,authenticated,service_role;
create trigger invalidate_inter_webhook_on_credentials_change
  before update on apticket.tenant_inter_configurations for each row
  execute function apticket_finance_private.invalidate_inter_webhook_on_credentials_change();

create table apticket.inter_webhook_registration_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  environment text not null check (environment in ('sandbox','production')),
  configuration_version integer not null check (configuration_version > 0),
  callback_base_url text not null check (
    length(callback_base_url) <= 500 and callback_base_url ~ '^https://[^?#]+$'
  ),
  candidate_secret_hash text not null check (candidate_secret_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'claimed' check (status in ('claimed','registered','failed')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_code text check (error_code is null or length(error_code) <= 60),
  error_message text check (error_message is null or length(error_message) <= 300),
  created_by uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  foreign key (tenant_id,environment)
    references apticket.tenant_inter_configurations(tenant_id,environment) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check ((status='claimed' and finished_at is null) or (status<>'claimed' and finished_at is not null))
);
create index inter_webhook_registration_scope_idx
  on apticket.inter_webhook_registration_attempts(tenant_id,environment,started_at desc);
alter table apticket.inter_webhook_registration_attempts enable row level security;
revoke all on apticket.inter_webhook_registration_attempts from public,anon,authenticated,service_role;
grant select on apticket.inter_webhook_registration_attempts to service_role;
create trigger inter_webhook_registration_no_delete before delete
  on apticket.inter_webhook_registration_attempts for each row
  execute function apticket_finance_private.guard_record();
create trigger inter_webhook_registration_no_truncate before truncate
  on apticket.inter_webhook_registration_attempts for each statement
  execute function apticket_finance_private.guard_record();
create trigger inter_webhook_registration_audit after insert or update
  on apticket.inter_webhook_registration_attempts for each row
  execute function apticket_finance_private.audit_record();

create table apticket.inter_charge_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  request_id uuid not null,
  environment text not null check (environment in ('sandbox','production')),
  bank_request_id uuid not null,
  event_fingerprint text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  notified_status text check (notified_status is null or notified_status in (
    'RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
    'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO'
  )),
  notified_at timestamptz,
  status text not null default 'received'
    check (status in ('received','queued','verifying','verified','failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  error_code text check (error_code is null or length(error_code) <= 60),
  error_message text check (error_message is null or length(error_message) <= 300),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  unique (tenant_id,environment,event_fingerprint),
  foreign key (request_id,tenant_id,operating_company_id)
    references apticket.inter_charge_requests(id,tenant_id,operating_company_id) on delete restrict
);
create index inter_charge_webhook_event_scope_idx
  on apticket.inter_charge_webhook_events(tenant_id,operating_company_id,received_at desc);
create index inter_charge_webhook_event_request_idx
  on apticket.inter_charge_webhook_events(request_id,received_at desc);
alter table apticket.inter_charge_webhook_events enable row level security;
revoke all on apticket.inter_charge_webhook_events from public,anon,authenticated,service_role;
grant select on apticket.inter_charge_webhook_events to service_role;
create trigger inter_charge_webhook_event_no_delete before delete
  on apticket.inter_charge_webhook_events for each row
  execute function apticket_finance_private.guard_record();
create trigger inter_charge_webhook_event_no_truncate before truncate
  on apticket.inter_charge_webhook_events for each statement
  execute function apticket_finance_private.guard_record();
create trigger inter_charge_webhook_event_audit after insert or update
  on apticket.inter_charge_webhook_events for each row
  execute function apticket_finance_private.audit_record();

alter table apticket.inter_charge_sync_attempts
  drop constraint inter_charge_sync_attempts_environment_check,
  add constraint inter_charge_sync_attempts_environment_check
    check (environment in ('sandbox','production')),
  add column initiation_source text not null default 'operator'
    check (initiation_source in ('operator','webhook')),
  add column source_event_id uuid references apticket.inter_charge_webhook_events(id) on delete restrict;
create index inter_charge_sync_event_idx
  on apticket.inter_charge_sync_attempts(source_event_id) where source_event_id is not null;

create function apticket_finance_private.prepare_inter_webhook_registration(
  p_actor uuid,p_tenant uuid,p_environment text,p_version integer,p_callback_base_url text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  cfg apticket.tenant_inter_configurations;
  attempt apticket.inter_webhook_registration_attempts;
  credentials jsonb;
  candidate_token text;
  candidate_hash text;
begin
  if p_actor is null or p_tenant is null
    or not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa','edit')
    or not apticket.has_permission(p_actor,'configuracoes','view')
    or not exists(
      select 1 from apticket.user_roles ur join apticket.roles r
        on r.id=ur.role_id and r.tenant_id=ur.tenant_id
      where ur.user_id=p_actor and ur.tenant_id=p_tenant and r.name in ('Admin','Financeiro')
    ) then
    raise exception using errcode='42501',message='Exige perfil Admin ou Financeiro com permissao de configuracao.';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production')
    or p_version is null or p_version<1
    or p_callback_base_url is null or length(p_callback_base_url)>500
    or p_callback_base_url !~ '^https://[^?#]+$' then
    raise exception using errcode='22023',message='Ambiente ou URL publica do webhook invalida.';
  end if;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=p_tenant and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Configuracao bancaria nao encontrada.'; end if;
  if cfg.version<>p_version then
    raise exception using errcode='40001',message='Configuracao alterada. Atualize a pagina.';
  end if;
  if cfg.certificate_expires_at<=now() then
    raise exception using errcode='22023',message='Certificado bancario vencido.';
  end if;
  select * into attempt from apticket.inter_webhook_registration_attempts
    where tenant_id=p_tenant and environment=p_environment and status='claimed'
    order by started_at desc limit 1;
  if found and attempt.started_at>clock_timestamp()-interval '2 minutes' then
    raise exception using errcode='54000',message='Ja existe uma configuracao de webhook em andamento.';
  end if;
  if found then
    update apticket.inter_webhook_registration_attempts set status='failed',finished_at=clock_timestamp(),
      error_code='LEASE_EXPIRED',error_message='A configuracao anterior nao foi concluida.' where id=attempt.id;
  end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=cfg.secret_id;
  if credentials is null or exists(
    select 1 from unnest(array['client_id','client_secret','certificate','private_key']) k
    where jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0
  ) then
    raise exception using errcode='22023',message='Credenciais bancarias incompletas.';
  end if;
  candidate_token:=encode(extensions.gen_random_bytes(32),'hex');
  candidate_hash:=encode(extensions.digest(candidate_token,'sha256'),'hex');
  insert into apticket.inter_webhook_registration_attempts(
    tenant_id,environment,configuration_version,callback_base_url,candidate_secret_hash,created_by
  ) values(p_tenant,p_environment,p_version,p_callback_base_url,candidate_hash,p_actor)
  returning * into attempt;
  update apticket.tenant_inter_configurations set webhook_status='configuring',webhook_updated_at=clock_timestamp(),
    webhook_last_error_code=null,webhook_last_error_message=null
    where tenant_id=p_tenant and environment=p_environment;
  return jsonb_build_object(
    'attempt_id',attempt.id,'environment',p_environment,'account',cfg.account,
    'callback_url',p_callback_base_url||'?token='||candidate_token,'candidate_token',candidate_token,
    'token_cache_key',p_tenant::text||':'||p_environment||':'||cfg.version::text||':'||cfg.certificate_fingerprint,
    'credentials',credentials
  );
end $$;
revoke all on function apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,text,integer,text)
  to service_role;

create function apticket.prepare_inter_webhook_registration(
  p_actor uuid,p_tenant uuid,p_environment text,p_version integer,p_callback_base_url text
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_webhook_registration(
    p_actor,p_tenant,p_environment,p_version,p_callback_base_url
  );
$$;
revoke all on function apticket.prepare_inter_webhook_registration(uuid,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function apticket.prepare_inter_webhook_registration(uuid,uuid,text,integer,text)
  to service_role;

create function apticket_finance_private.finish_inter_webhook_registration(
  p_attempt uuid,p_outcome text,p_http_status integer,p_error_code text,p_error_message text,p_candidate_token text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  attempt apticket.inter_webhook_registration_attempts;
  cfg apticket.tenant_inter_configurations;
  secret uuid;
begin
  if p_outcome not in ('registered','failed')
    or p_http_status is not null and p_http_status not between 100 and 599
    or (p_outcome='registered' and (
      p_candidate_token is null or length(p_candidate_token)<>64
      or encode(extensions.digest(p_candidate_token,'sha256'),'hex') is distinct from
        (select candidate_secret_hash from apticket.inter_webhook_registration_attempts where id=p_attempt)
    )) then
    raise exception using errcode='22023',message='Resultado de configuracao do webhook invalido.';
  end if;
  select * into attempt from apticket.inter_webhook_registration_attempts where id=p_attempt for update;
  if not found then raise exception using errcode='P0002',message='Tentativa nao encontrada.'; end if;
  if attempt.status<>'claimed' then
    return jsonb_build_object('state',attempt.status,'reused',true);
  end if;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=attempt.tenant_id and environment=attempt.environment for update;
  if cfg.version<>attempt.configuration_version then
    raise exception using errcode='40001',message='Configuracao bancaria mudou durante o registro.';
  end if;
  if p_outcome='registered' then
    if cfg.webhook_secret_id is null then
      select vault.create_secret(
        p_candidate_token,'apticket_inter_webhook_'||attempt.tenant_id||'_'||attempt.environment
      ) into secret;
    else
      secret:=cfg.webhook_secret_id;
      perform vault.update_secret(secret,p_candidate_token);
    end if;
    update apticket.tenant_inter_configurations set
      webhook_status='active',webhook_callback_base_url=attempt.callback_base_url,
      webhook_secret_hash=attempt.candidate_secret_hash,webhook_secret_id=secret,
      webhook_registered_at=clock_timestamp(),
      webhook_updated_at=clock_timestamp(),webhook_last_error_code=null,webhook_last_error_message=null
      where tenant_id=attempt.tenant_id and environment=attempt.environment;
  else
    update apticket.tenant_inter_configurations set
      webhook_status=case when webhook_secret_hash is not null then 'active' else 'failed' end,
      webhook_updated_at=clock_timestamp(),webhook_last_error_code=left(nullif(p_error_code,''),60),
      webhook_last_error_message=left(nullif(p_error_message,''),300)
      where tenant_id=attempt.tenant_id and environment=attempt.environment;
  end if;
  update apticket.inter_webhook_registration_attempts set status=p_outcome,http_status=p_http_status,
    error_code=case when p_outcome='failed' then left(nullif(p_error_code,''),60) end,
    error_message=case when p_outcome='failed' then left(nullif(p_error_message,''),300) end,
    finished_at=clock_timestamp() where id=attempt.id;
  return jsonb_build_object('state',p_outcome,'environment',attempt.environment,'reused',false);
end $$;
revoke all on function apticket_finance_private.finish_inter_webhook_registration(uuid,text,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.finish_inter_webhook_registration(uuid,text,integer,text,text,text)
  to service_role;

create function apticket.finish_inter_webhook_registration(
  p_attempt uuid,p_outcome text,p_http_status integer,p_error_code text,p_error_message text,p_candidate_token text
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.finish_inter_webhook_registration(
    p_attempt,p_outcome,p_http_status,p_error_code,p_error_message,p_candidate_token
  );
$$;
revoke all on function apticket.finish_inter_webhook_registration(uuid,text,integer,text,text,text)
  from public,anon,authenticated;
grant execute on function apticket.finish_inter_webhook_registration(uuid,text,integer,text,text,text)
  to service_role;

create function apticket_finance_private.accept_inter_charge_webhook(
  p_environment text,p_secret_hash text,p_events jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  cfg apticket.tenant_inter_configurations;
  item jsonb;
  req apticket.inter_charge_requests;
  event apticket.inter_charge_webhook_events;
  fingerprint text;
  accepted jsonb:='[]'::jsonb;
  ignored integer:=0;
  code text;
  notified text;
  notified_time timestamptz;
begin
  if p_environment is null or p_environment not in ('sandbox','production')
    or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$'
    or p_events is null or jsonb_typeof(p_events)<>'array'
    or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception using errcode='22023',message='Callback invalido.';
  end if;
  select * into cfg from apticket.tenant_inter_configurations
    where environment=p_environment and webhook_status='active'
      and webhook_secret_hash=p_secret_hash;
  if not found then raise exception using errcode='42501',message='Webhook nao autorizado.'; end if;
  for item in select value from jsonb_array_elements(p_events) loop
    code:=item->>'codigo_solicitacao';
    notified:=nullif(item->>'situacao','');
    if code is null or code !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or notified is not null and notified not in (
        'RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
        'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO'
      ) then
      raise exception using errcode='22023',message='Evento de callback invalido.';
    end if;
    notified_time:=nullif(item->>'data_hora_situacao','')::timestamptz;
    select * into req from apticket.inter_charge_requests
      where tenant_id=cfg.tenant_id and environment=p_environment
        and bank_request_id=code::uuid and status='submitted' and deleted_at is null;
    if not found then ignored:=ignored+1; continue; end if;
    fingerprint:=encode(extensions.digest(
      concat_ws('|',code,coalesce(notified,''),coalesce(notified_time::text,'')),'sha256'
    ),'hex');
    insert into apticket.inter_charge_webhook_events(
      tenant_id,operating_company_id,request_id,environment,bank_request_id,
      event_fingerprint,notified_status,notified_at
    ) values(
      req.tenant_id,req.operating_company_id,req.id,p_environment,req.bank_request_id,
      fingerprint,notified,notified_time
    ) on conflict(tenant_id,environment,event_fingerprint) do update
      set event_fingerprint=excluded.event_fingerprint
    returning * into event;
    accepted:=accepted||jsonb_build_array(jsonb_build_object(
      'event_id',event.id,'request_id',event.request_id,'status',event.status,
      'attempt_count',event.attempt_count
    ));
  end loop;
  return jsonb_build_object('events',accepted,'ignored',ignored);
end $$;
revoke all on function apticket_finance_private.accept_inter_charge_webhook(text,text,jsonb)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.accept_inter_charge_webhook(text,text,jsonb)
  to service_role;

create function apticket.accept_inter_charge_webhook(
  p_environment text,p_secret_hash text,p_events jsonb
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.accept_inter_charge_webhook(p_environment,p_secret_hash,p_events);
$$;
revoke all on function apticket.accept_inter_charge_webhook(text,text,jsonb)
  from public,anon,authenticated;
grant execute on function apticket.accept_inter_charge_webhook(text,text,jsonb) to service_role;

create function apticket_finance_private.mark_inter_webhook_events_queued(p_events uuid[])
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_events is null or cardinality(p_events) not between 1 and 50 then
    raise exception using errcode='22023',message='Eventos invalidos.';
  end if;
  update apticket.inter_charge_webhook_events set status='queued',error_code=null,error_message=null
    where id=any(p_events) and status in ('received','failed');
end $$;
revoke all on function apticket_finance_private.mark_inter_webhook_events_queued(uuid[])
  from public,anon,authenticated;
grant execute on function apticket_finance_private.mark_inter_webhook_events_queued(uuid[]) to service_role;
create function apticket.mark_inter_webhook_events_queued(p_events uuid[])
returns void language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.mark_inter_webhook_events_queued(p_events);
$$;
revoke all on function apticket.mark_inter_webhook_events_queued(uuid[]) from public,anon,authenticated;
grant execute on function apticket.mark_inter_webhook_events_queued(uuid[]) to service_role;

create function apticket_finance_private.prepare_inter_charge_sync_from_webhook(
  p_request uuid,p_event uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  req apticket.inter_charge_requests;
  event apticket.inter_charge_webhook_events;
  attempt apticket.inter_charge_sync_attempts;
  cfg apticket.tenant_inter_configurations;
  actor uuid;
begin
  select * into event from apticket.inter_charge_webhook_events
    where id=p_event and request_id=p_request for update;
  if not found then raise exception using errcode='42501',message='Evento de webhook indisponivel.'; end if;
  if event.status='verified' then
    return jsonb_build_object('state','synced','request_id',p_request,'reused',true);
  end if;
  if event.attempt_count>=20 then
    raise exception using errcode='54000',message='Limite de reconciliacoes do evento atingido.';
  end if;
  select * into req from apticket.inter_charge_requests
    where id=p_request and tenant_id=event.tenant_id and environment=event.environment
      and bank_request_id=event.bank_request_id and status='submitted' and deleted_at is null for update;
  if not found then raise exception using errcode='22023',message='Cobranca do webhook indisponivel.'; end if;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=req.tenant_id and environment=req.environment;
  if not found or cfg.webhook_status<>'active' then
    raise exception using errcode='22023',message='Webhook deixou de estar ativo.';
  end if;
  actor:=cfg.updated_by;
  select * into attempt from apticket.inter_charge_sync_attempts
    where request_id=req.id and status='claimed' order by started_at desc limit 1;
  if found and attempt.started_at>clock_timestamp()-interval '2 minutes' then
    return jsonb_build_object('state','syncing','attempt_id',attempt.id,'actor_id',attempt.created_by,'reused',true);
  end if;
  if found then
    update apticket.inter_charge_sync_attempts set status='failed',finished_at=clock_timestamp(),
      error_code='LEASE_EXPIRED',error_message='A consulta bancaria anterior nao foi concluida.' where id=attempt.id;
  end if;
  if req.bank_synced_at is not null and req.bank_synced_at>clock_timestamp()-interval '15 seconds' then
    update apticket.inter_charge_webhook_events set status='verified',processed_at=clock_timestamp(),
      error_code=null,error_message=null where id=event.id;
    return jsonb_build_object('state','synced','request_id',req.id,'bank_status',req.bank_status,'reused',true);
  end if;
  insert into apticket.inter_charge_sync_attempts(
    tenant_id,operating_company_id,request_id,environment,created_by,initiation_source,source_event_id
  ) values(req.tenant_id,req.operating_company_id,req.id,req.environment,actor,'webhook',event.id)
  returning * into attempt;
  update apticket.inter_charge_webhook_events set status='verifying',attempt_count=attempt_count+1,
    error_code=null,error_message=null,processed_at=null where id=event.id;
  return jsonb_build_object('state','syncing','attempt_id',attempt.id,'actor_id',actor,'reused',false);
end $$;
revoke all on function apticket_finance_private.prepare_inter_charge_sync_from_webhook(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.prepare_inter_charge_sync_from_webhook(uuid,uuid)
  to service_role;
create function apticket.prepare_inter_charge_sync_from_webhook(p_request uuid,p_event uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_charge_sync_from_webhook(p_request,p_event);
$$;
revoke all on function apticket.prepare_inter_charge_sync_from_webhook(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket.prepare_inter_charge_sync_from_webhook(uuid,uuid) to service_role;

-- Acrescenta o encerramento do evento a mesma transacao que persiste o estado
-- consultado no banco. O payload do callback nunca participa desta decisao.
create or replace function apticket_finance_private.finish_inter_charge_sync(
  p_attempt uuid,p_outcome text,p_http_status integer,p_error_code text,p_error_message text,p_bank_result jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  attempt apticket.inter_charge_sync_attempts;
  req apticket.inter_charge_requests;
  situation text;
  received numeric(14,2);
begin
  if p_outcome not in ('synced','failed')
    or p_http_status is not null and p_http_status not between 100 and 599
    or (p_outcome='synced') is distinct from (p_bank_result is not null) then
    raise exception using errcode='22023',message='Resultado da consulta invalido.';
  end if;
  select * into attempt from apticket.inter_charge_sync_attempts where id=p_attempt for update;
  if not found then raise exception using errcode='P0002',message='Tentativa nao encontrada.'; end if;
  if attempt.status<>'claimed' then
    return jsonb_build_object('state',attempt.status,'request_id',attempt.request_id,'bank_status',attempt.bank_status,'reused',true);
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  if p_outcome='synced' then
    situation:=p_bank_result->>'situacao';
    if situation is null or situation not in ('RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
      'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO')
      or coalesce(p_bank_result->>'codigo_solicitacao','')<>req.bank_request_id::text then
      raise exception using errcode='22023',message='Resposta bancaria incompativel com a cobranca.';
    end if;
    if nullif(p_bank_result->>'valor_total_recebido','') is not null then
      received:=(p_bank_result->>'valor_total_recebido')::numeric(14,2);
      if received<0 then raise exception using errcode='22023',message='Valor recebido invalido.'; end if;
    end if;
    update apticket.inter_charge_requests set
      bank_status=situation,bank_status_at=nullif(p_bank_result->>'data_situacao','')::date,
      bank_our_number=left(nullif(p_bank_result->>'nosso_numero',''),30),
      bank_barcode=left(nullif(p_bank_result->>'codigo_barras',''),60),
      bank_digitable_line=left(nullif(p_bank_result->>'linha_digitavel',''),60),
      bank_txid=left(nullif(p_bank_result->>'txid',''),100),
      bank_pix_copy_paste=left(nullif(p_bank_result->>'pix_copia_cola',''),1000),
      bank_received_amount=received,bank_receipt_origin=nullif(p_bank_result->>'origem_recebimento',''),
      bank_synced_at=clock_timestamp(),last_sync_error_code=null,last_sync_error_message=null,updated_at=now()
      where id=req.id;
    update apticket.contas_receber set
      status_cobranca=case
        when situation in ('RECEBIDO','MARCADO_RECEBIDO') then 'recebido'::apticket.status_cobranca_avulsa
        when situation in ('ATRASADO','PROTESTO') then 'vencido'::apticket.status_cobranca_avulsa
        when situation in ('A_RECEBER','EM_PROCESSAMENTO') then 'faturado'::apticket.status_cobranca_avulsa
        else status_cobranca end,
      valor_aberto=case when situation in ('RECEBIDO','MARCADO_RECEBIDO') then 0 else valor_aberto end,
      updated_at=now()
      where id=req.receivable_id and tenant_id=req.tenant_id and deleted_at is null;
  else
    update apticket.inter_charge_requests set last_sync_error_code=left(nullif(p_error_code,''),60),
      last_sync_error_message=left(nullif(p_error_message,''),300),updated_at=now() where id=req.id;
  end if;
  update apticket.inter_charge_sync_attempts set status=p_outcome,http_status=p_http_status,
    bank_status=case when p_outcome='synced' then situation end,
    error_code=case when p_outcome='failed' then left(nullif(p_error_code,''),60) end,
    error_message=case when p_outcome='failed' then left(nullif(p_error_message,''),300) end,
    finished_at=clock_timestamp() where id=attempt.id;
  if attempt.source_event_id is not null then
    update apticket.inter_charge_webhook_events set status=case when p_outcome='synced' then 'verified' else 'failed' end,
      error_code=case when p_outcome='failed' then left(nullif(p_error_code,''),60) end,
      error_message=case when p_outcome='failed' then left(nullif(p_error_message,''),300) end,
      processed_at=clock_timestamp() where id=attempt.source_event_id;
  end if;
  return jsonb_build_object('state',p_outcome,'request_id',req.id,'bank_status',situation,'reused',false);
end $$;

notify pgrst,'reload schema';
