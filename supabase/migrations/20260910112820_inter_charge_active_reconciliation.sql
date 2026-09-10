-- Fatia 11: reconcilia de forma ativa cobranças já aceitas pela API V3 do
-- Inter. Somente campos bancários conhecidos são persistidos; o payload bruto
-- nunca entra no banco.

alter table apticket.inter_charge_requests
  add column bank_status_at date,
  add column bank_our_number text check (bank_our_number is null or length(bank_our_number) <= 30),
  add column bank_barcode text check (bank_barcode is null or length(bank_barcode) <= 60),
  add column bank_digitable_line text check (bank_digitable_line is null or length(bank_digitable_line) <= 60),
  add column bank_txid text check (bank_txid is null or length(bank_txid) <= 100),
  add column bank_pix_copy_paste text check (bank_pix_copy_paste is null or length(bank_pix_copy_paste) <= 1000),
  add column bank_received_amount numeric(14,2) check (bank_received_amount is null or bank_received_amount >= 0),
  add column bank_receipt_origin text check (bank_receipt_origin is null or bank_receipt_origin in ('BOLETO','PIX')),
  add column bank_synced_at timestamptz,
  add column last_sync_error_code text check (last_sync_error_code is null or length(last_sync_error_code) <= 60),
  add column last_sync_error_message text check (last_sync_error_message is null or length(last_sync_error_message) <= 300);

alter table apticket.inter_charge_requests
  add constraint inter_charge_bank_status_check check (
    bank_status is null or bank_status in (
      'RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
      'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO'
    )
  );

create table apticket.inter_charge_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  request_id uuid not null,
  environment text not null check (environment = 'sandbox'),
  status text not null default 'claimed' check (status in ('claimed','synced','failed')),
  http_status integer check (http_status is null or http_status between 100 and 599),
  bank_status text check (bank_status is null or bank_status in (
    'RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
    'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO'
  )),
  error_code text check (error_code is null or length(error_code) <= 60),
  error_message text check (error_message is null or length(error_message) <= 300),
  created_by uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  foreign key(request_id,tenant_id,operating_company_id)
    references apticket.inter_charge_requests(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check ((status='claimed' and finished_at is null) or (status<>'claimed' and finished_at is not null))
);

create index inter_charge_sync_scope_idx
  on apticket.inter_charge_sync_attempts(tenant_id,operating_company_id,started_at desc);
create index inter_charge_sync_request_idx
  on apticket.inter_charge_sync_attempts(request_id,started_at desc);

alter table apticket.inter_charge_sync_attempts enable row level security;
revoke all on apticket.inter_charge_sync_attempts from public,anon,authenticated,service_role;
grant select on apticket.inter_charge_sync_attempts to authenticated,service_role;
create policy inter_charge_sync_read on apticket.inter_charge_sync_attempts
  for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger inter_charge_sync_no_delete before delete on apticket.inter_charge_sync_attempts
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_charge_sync_no_truncate before truncate on apticket.inter_charge_sync_attempts
  for each statement execute function apticket_finance_private.guard_record();
create trigger inter_charge_sync_audit after insert or update on apticket.inter_charge_sync_attempts
  for each row execute function apticket_finance_private.audit_record();

create function apticket_finance_private.prepare_inter_charge_sync(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  req apticket.inter_charge_requests;
  attempt apticket.inter_charge_sync_attempts;
  actor uuid:=auth.uid();
begin
  if actor is null then
    raise exception using errcode='42501',message='Sessão obrigatória.';
  end if;
  select * into req from apticket.inter_charge_requests
    where id=p_request and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found or not apticket.has_financial_scope(req.tenant_id,req.operating_company_id,true)
    or not exists(
      select 1 from apticket.user_roles ur join apticket.roles r
        on r.id=ur.role_id and r.tenant_id=ur.tenant_id
      where ur.user_id=actor and ur.tenant_id=req.tenant_id and r.name in ('Admin','Financeiro')
    ) then
    raise exception using errcode='42501',message='Exige perfil Admin ou Financeiro e acesso financeiro de escrita.';
  end if;
  if req.environment<>'sandbox' or req.status<>'submitted' or req.bank_request_id is null then
    raise exception using errcode='22023',message='Somente uma cobrança aceita no sandbox pode ser consultada.';
  end if;
  select * into attempt from apticket.inter_charge_sync_attempts
    where request_id=req.id and status='claimed' order by started_at desc limit 1;
  if found and attempt.started_at>clock_timestamp()-interval '2 minutes' then
    return jsonb_build_object('state','syncing','attempt_id',attempt.id,'actor_id',attempt.created_by,'reused',true);
  end if;
  if found then
    update apticket.inter_charge_sync_attempts set status='failed',finished_at=clock_timestamp(),
      error_code='LEASE_EXPIRED',error_message='A consulta bancária anterior não foi concluída.' where id=attempt.id;
  end if;
  if req.bank_synced_at is not null and req.bank_synced_at>clock_timestamp()-interval '15 seconds' then
    return jsonb_build_object('state','synced','request_id',req.id,'bank_status',req.bank_status,'reused',true);
  end if;
  insert into apticket.inter_charge_sync_attempts(
    tenant_id,operating_company_id,request_id,environment,created_by
  ) values(req.tenant_id,req.operating_company_id,req.id,'sandbox',actor)
  returning * into attempt;
  return jsonb_build_object('state','syncing','attempt_id',attempt.id,'actor_id',actor,'reused',false);
end $$;
revoke all on function apticket_finance_private.prepare_inter_charge_sync(uuid)
  from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.prepare_inter_charge_sync(uuid) to authenticated;

create function apticket.prepare_inter_charge_sync(p_request uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_charge_sync(p_request);
$$;
revoke all on function apticket.prepare_inter_charge_sync(uuid) from public,anon,service_role;
grant execute on function apticket.prepare_inter_charge_sync(uuid) to authenticated;

create function apticket_finance_private.load_inter_charge_sync(p_attempt uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  attempt apticket.inter_charge_sync_attempts;
  req apticket.inter_charge_requests;
  binding apticket.operating_company_inter_bindings;
  cfg apticket.tenant_inter_configurations;
  credentials jsonb;
begin
  select * into attempt from apticket.inter_charge_sync_attempts where id=p_attempt for update;
  if not found or attempt.created_by<>p_actor or attempt.status<>'claimed'
    or attempt.started_at<clock_timestamp()-interval '2 minutes' then
    raise exception using errcode='40001',message='Tentativa de consulta indisponível ou expirada.';
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  select * into binding from apticket.operating_company_inter_bindings
    where tenant_id=attempt.tenant_id and operating_company_id=attempt.operating_company_id
      and environment=attempt.environment and deleted_at is null;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=attempt.tenant_id and environment=attempt.environment;
  if req.status<>'submitted' or req.bank_request_id is null or binding.id is null or cfg.tenant_id is null
    or cfg.version<>binding.configuration_version or cfg.certificate_expires_at<=now() then
    raise exception using errcode='23514',message='Cobrança ou configuração bancária deixou de ser válida.';
  end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=cfg.secret_id;
  if credentials is null or exists(
    select 1 from unnest(array['client_id','client_secret','certificate','private_key']) k
    where jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0
  ) then
    raise exception using errcode='22023',message='Credenciais bancárias incompletas.';
  end if;
  return jsonb_build_object(
    'attempt_id',attempt.id,'actor_id',attempt.created_by,'environment',attempt.environment,
    'account',cfg.account,'bank_request_id',req.bank_request_id,
    'token_cache_key',cfg.tenant_id::text||':'||attempt.environment||':'||cfg.version::text||':'||cfg.certificate_fingerprint,
    'credentials',credentials
  );
end $$;
revoke all on function apticket_finance_private.load_inter_charge_sync(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.load_inter_charge_sync(uuid,uuid) to service_role;

create function apticket.load_inter_charge_sync(p_attempt uuid,p_actor uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.load_inter_charge_sync(p_attempt,p_actor);
$$;
revoke all on function apticket.load_inter_charge_sync(uuid,uuid) from public,anon,authenticated;
grant execute on function apticket.load_inter_charge_sync(uuid,uuid) to service_role;

create function apticket_finance_private.finish_inter_charge_sync(
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
    raise exception using errcode='22023',message='Resultado da consulta inválido.';
  end if;
  select * into attempt from apticket.inter_charge_sync_attempts where id=p_attempt for update;
  if not found then raise exception using errcode='P0002',message='Tentativa não encontrada.'; end if;
  if attempt.status<>'claimed' then
    return jsonb_build_object('state',attempt.status,'request_id',attempt.request_id,'bank_status',attempt.bank_status,'reused',true);
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  if p_outcome='synced' then
    situation:=p_bank_result->>'situacao';
    if situation is null or situation not in ('RECEBIDO','A_RECEBER','MARCADO_RECEBIDO','ATRASADO','CANCELADO',
      'EXPIRADO','FALHA_EMISSAO','EM_PROCESSAMENTO','PROTESTO')
      or coalesce(p_bank_result->>'codigo_solicitacao','')<>req.bank_request_id::text then
      raise exception using errcode='22023',message='Resposta bancária incompatível com a cobrança.';
    end if;
    if nullif(p_bank_result->>'valor_total_recebido','') is not null then
      received:=(p_bank_result->>'valor_total_recebido')::numeric(14,2);
      if received<0 then raise exception using errcode='22023',message='Valor recebido inválido.'; end if;
    end if;
    update apticket.inter_charge_requests set
      bank_status=situation,bank_status_at=nullif(p_bank_result->>'data_situacao','')::date,
      bank_our_number=left(nullif(p_bank_result->>'nosso_numero',''),30),
      bank_barcode=left(nullif(p_bank_result->>'codigo_barras',''),60),
      bank_digitable_line=left(nullif(p_bank_result->>'linha_digitavel',''),60),
      bank_txid=left(nullif(p_bank_result->>'txid',''),100),
      bank_pix_copy_paste=left(nullif(p_bank_result->>'pix_copia_cola',''),1000),
      bank_received_amount=received,
      bank_receipt_origin=nullif(p_bank_result->>'origem_recebimento',''),
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
    update apticket.inter_charge_requests set
      last_sync_error_code=left(nullif(p_error_code,''),60),
      last_sync_error_message=left(nullif(p_error_message,''),300),updated_at=now()
      where id=req.id;
  end if;
  update apticket.inter_charge_sync_attempts set status=p_outcome,http_status=p_http_status,
    bank_status=case when p_outcome='synced' then situation else null end,
    error_code=case when p_outcome='failed' then left(nullif(p_error_code,''),60) else null end,
    error_message=case when p_outcome='failed' then left(nullif(p_error_message,''),300) else null end,
    finished_at=clock_timestamp() where id=attempt.id;
  return jsonb_build_object('state',p_outcome,'request_id',req.id,'bank_status',situation,'reused',false);
end $$;
revoke all on function apticket_finance_private.finish_inter_charge_sync(uuid,text,integer,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.finish_inter_charge_sync(uuid,text,integer,text,text,jsonb)
  to service_role;

create function apticket.finish_inter_charge_sync(
  p_attempt uuid,p_outcome text,p_http_status integer,p_error_code text,p_error_message text,p_bank_result jsonb
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.finish_inter_charge_sync(
    p_attempt,p_outcome,p_http_status,p_error_code,p_error_message,p_bank_result
  );
$$;
revoke all on function apticket.finish_inter_charge_sync(uuid,text,integer,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function apticket.finish_inter_charge_sync(uuid,text,integer,text,text,jsonb)
  to service_role;

notify pgrst,'reload schema';
