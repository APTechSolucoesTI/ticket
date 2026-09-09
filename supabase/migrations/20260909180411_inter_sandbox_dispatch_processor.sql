-- Fatia 10: emissão manual e idempotente somente no sandbox do Inter.
-- Produção continua bloqueada por validação no banco e na Edge Function.

alter table apticket.inter_charge_requests
  drop constraint inter_charge_requests_status_check,
  add constraint inter_charge_requests_status_check check (
    status in ('blocked_homologation','dispatching','submitted','uncertain','failed')
  ),
  add column dispatch_attempts integer not null default 0 check (dispatch_attempts between 0 and 5),
  add column dispatch_started_at timestamptz,
  add column bank_request_id uuid,
  add column bank_status text,
  add column bank_accepted_at timestamptz,
  add column last_error_code text check (last_error_code is null or length(last_error_code) <= 60),
  add column last_error_message text check (last_error_message is null or length(last_error_message) <= 300),
  add column updated_at timestamptz not null default now(),
  add constraint inter_charge_bank_result_check check (
    (status = 'submitted' and bank_request_id is not null and bank_status is not null and bank_accepted_at is not null)
    or (status <> 'submitted' and bank_request_id is null and bank_status is null and bank_accepted_at is null)
  );

alter table apticket.inter_charge_requests
  add constraint inter_charge_dispatch_scope_key unique(id,tenant_id,operating_company_id);

create unique index inter_charge_bank_request_key
  on apticket.inter_charge_requests(environment,bank_request_id)
  where bank_request_id is not null;

alter table apticket.inter_payer_snapshots
  add constraint inter_payer_dispatch_scope_key unique(id,tenant_id,operating_company_id,request_id);

create table apticket.inter_charge_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  request_id uuid not null,
  snapshot_id uuid not null,
  binding_id uuid not null,
  environment text not null check (environment = 'sandbox'),
  attempt_number integer not null check (attempt_number between 1 and 5),
  status text not null default 'claimed' check (status in ('claimed','submitted','uncertain','failed')),
  bank_request_id uuid,
  http_status integer check (http_status is null or http_status between 100 and 599),
  error_code text check (error_code is null or length(error_code) <= 60),
  error_message text check (error_message is null or length(error_message) <= 300),
  created_by uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique(request_id,attempt_number),
  foreign key(request_id,tenant_id,operating_company_id)
    references apticket.inter_charge_requests(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(snapshot_id,tenant_id,operating_company_id,request_id)
    references apticket.inter_payer_snapshots(id,tenant_id,operating_company_id,request_id) on delete restrict,
  foreign key(binding_id,tenant_id,operating_company_id,environment)
    references apticket.operating_company_inter_bindings(id,tenant_id,operating_company_id,environment) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check ((status = 'claimed' and finished_at is null) or (status <> 'claimed' and finished_at is not null)),
  check (
    (status = 'submitted' and bank_request_id is not null)
    or (status <> 'submitted' and bank_request_id is null)
  )
);

create index inter_dispatch_attempt_scope
  on apticket.inter_charge_dispatch_attempts(tenant_id,operating_company_id,started_at desc);
create unique index inter_dispatch_attempt_bank_request_key
  on apticket.inter_charge_dispatch_attempts(environment,bank_request_id)
  where bank_request_id is not null;

alter table apticket.inter_charge_dispatch_attempts enable row level security;
revoke all on apticket.inter_charge_dispatch_attempts from public,anon,authenticated,service_role;
grant select on apticket.inter_charge_dispatch_attempts to authenticated,service_role;
create policy inter_dispatch_attempt_read on apticket.inter_charge_dispatch_attempts
  for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger inter_dispatch_attempt_no_delete before delete on apticket.inter_charge_dispatch_attempts
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_dispatch_attempt_no_truncate before truncate on apticket.inter_charge_dispatch_attempts
  for each statement execute function apticket_finance_private.guard_record();
create trigger inter_dispatch_attempt_audit after insert or update on apticket.inter_charge_dispatch_attempts
  for each row execute function apticket_finance_private.audit_record();

-- A sessão do operador cria somente a tentativa. Nenhum segredo ou payload
-- bancário atravessa este contrato autenticado.
create function apticket_finance_private.prepare_inter_sandbox_dispatch(p_request uuid,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  req apticket.inter_charge_requests;
  snap apticket.inter_payer_snapshots;
  attempt apticket.inter_charge_dispatch_attempts;
  actor uuid:=auth.uid();
  payer_review jsonb;
begin
  if actor is null then
    raise exception using errcode='42501',message='Sessão obrigatória.';
  end if;
  if p_confirmed is distinct from true then
    raise exception using errcode='22023',message='Confirmação explícita obrigatória.';
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
  if req.environment<>'sandbox' then
    raise exception using errcode='0A000',message='Emissão em produção permanece bloqueada.';
  end if;
  if req.status='submitted' then
    return jsonb_build_object('state','submitted','request_id',req.id,'bank_request_id',req.bank_request_id,'reused',true);
  end if;
  if req.status='uncertain' then
    return jsonb_build_object('state','uncertain','request_id',req.id,'bank_request_id',req.bank_request_id,'reused',true);
  end if;
  if req.status='dispatching' then
    select * into attempt from apticket.inter_charge_dispatch_attempts
      where request_id=req.id and status='claimed' order by attempt_number desc limit 1;
    if found and attempt.started_at>clock_timestamp()-interval '2 minutes' then
      return jsonb_build_object('state','dispatching','request_id',req.id,'attempt_id',attempt.id,
        'actor_id',attempt.created_by,'reused',true);
    end if;
    if found then
      update apticket.inter_charge_dispatch_attempts set status='uncertain',finished_at=clock_timestamp(),
        error_code='LEASE_EXPIRED',error_message='A execução perdeu a confirmação do resultado bancário.' where id=attempt.id;
    end if;
    update apticket.inter_charge_requests set status='uncertain',updated_at=now(),
      last_error_code='LEASE_EXPIRED',last_error_message='Resultado bancário incerto; o POST não será repetido.' where id=req.id;
    return jsonb_build_object('state','uncertain','request_id',req.id,'reused',true);
  end if;
  if req.dispatch_attempts>=5 then
    raise exception using errcode='54000',message='Limite de tentativas atingido.';
  end if;
  if exists(select 1 from apticket.inter_charge_dispatch_attempts where request_id=req.id
    and started_at>clock_timestamp()-interval '1 minute') then
    raise exception using errcode='54000',message='Aguarde antes de tentar novamente.';
  end if;
  payer_review:=apticket_finance_private.review_inter_payer(req.id);
  if payer_review->>'state'<>'confirmed' then
    raise exception using errcode='23514',message='O pagador ou vínculo precisa ser confirmado novamente.';
  end if;
  select * into snap from apticket.inter_payer_snapshots
    where request_id=req.id and deleted_at is null for update;
  if not found then
    raise exception using errcode='23514',message='Snapshot do pagador indisponível.';
  end if;
  insert into apticket.inter_charge_dispatch_attempts(
    tenant_id,operating_company_id,request_id,snapshot_id,binding_id,environment,attempt_number,created_by
  ) values(req.tenant_id,req.operating_company_id,req.id,snap.id,snap.binding_id,'sandbox',req.dispatch_attempts+1,actor)
  returning * into attempt;
  update apticket.inter_charge_requests set status='dispatching',dispatch_attempts=dispatch_attempts+1,
    dispatch_started_at=attempt.started_at,updated_at=now(),last_error_code=null,last_error_message=null where id=req.id;
  return jsonb_build_object('state','dispatching','request_id',req.id,'attempt_id',attempt.id,
    'actor_id',actor,'reused',false);
end $$;

revoke all on function apticket_finance_private.prepare_inter_sandbox_dispatch(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.prepare_inter_sandbox_dispatch(uuid,boolean) to authenticated;

create function apticket.prepare_inter_sandbox_dispatch(p_request uuid,p_confirmed boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_sandbox_dispatch(p_request,p_confirmed);
$$;
revoke all on function apticket.prepare_inter_sandbox_dispatch(uuid,boolean) from public,anon,service_role;
grant execute on function apticket.prepare_inter_sandbox_dispatch(uuid,boolean) to authenticated;

-- Contrato exclusivamente interno da Edge Function. É o único ponto que lê o
-- Vault e ele exige uma tentativa recém-criada pelo operador autenticado.
create function apticket_finance_private.load_inter_sandbox_dispatch(p_attempt uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  attempt apticket.inter_charge_dispatch_attempts;
  req apticket.inter_charge_requests;
  snap apticket.inter_payer_snapshots;
  binding apticket.operating_company_inter_bindings;
  cfg apticket.tenant_inter_configurations;
  credentials jsonb;
begin
  select * into attempt from apticket.inter_charge_dispatch_attempts where id=p_attempt for update;
  if not found or attempt.created_by<>p_actor or attempt.environment<>'sandbox' or attempt.status<>'claimed'
    or attempt.started_at<clock_timestamp()-interval '2 minutes' then
    raise exception using errcode='40001',message='Tentativa indisponível ou expirada.';
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  select * into snap from apticket.inter_payer_snapshots where id=attempt.snapshot_id and deleted_at is null;
  select * into binding from apticket.operating_company_inter_bindings where id=attempt.binding_id and deleted_at is null;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=attempt.tenant_id and environment='sandbox';
  if req.status<>'dispatching' or snap.id is null or binding.id is null or cfg.tenant_id is null
    or cfg.version<>binding.configuration_version or cfg.certificate_expires_at<=now()
    or req.amount<>snap.amount or req.due_date<>snap.due_date then
    raise exception using errcode='23514',message='Origem, snapshot ou configuração bancária deixou de ser válida.';
  end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=cfg.secret_id;
  if credentials is null or exists(
    select 1 from unnest(array['client_id','client_secret','certificate','private_key']) k
    where jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0
  ) then
    raise exception using errcode='22023',message='Credenciais bancárias incompletas.';
  end if;
  return jsonb_build_object(
    'attempt_id',attempt.id,'actor_id',attempt.created_by,'environment','sandbox','account',cfg.account,
    'token_cache_key',cfg.tenant_id::text||':sandbox:'||cfg.version::text||':'||cfg.certificate_fingerprint,
    'credentials',credentials,
    'charge',jsonb_build_object(
      'seuNumero',snap.seu_numero,'valorNominal',snap.amount,'dataVencimento',snap.due_date,
      'pagador',jsonb_strip_nulls(jsonb_build_object(
        'email',snap.payer_email,'ddd',snap.payer_ddd,'telefone',snap.payer_phone,
        'numero',snap.payer_number,'complemento',snap.payer_complement,'cpfCnpj',snap.payer_tax_id,
        'tipoPessoa',snap.payer_type,'nome',snap.payer_name,'endereco',snap.payer_street,
        'bairro',snap.payer_district,'cidade',snap.payer_city,'uf',snap.payer_state,'cep',snap.payer_zip
      )),'formasRecebimento',jsonb_build_array('BOLETO','PIX')
    )
  );
end $$;
revoke all on function apticket_finance_private.load_inter_sandbox_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.load_inter_sandbox_dispatch(uuid,uuid) to service_role;

create function apticket.load_inter_sandbox_dispatch(p_attempt uuid,p_actor uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.load_inter_sandbox_dispatch(p_attempt,p_actor);
$$;
revoke all on function apticket.load_inter_sandbox_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function apticket.load_inter_sandbox_dispatch(uuid,uuid) to service_role;

create function apticket_finance_private.finish_inter_sandbox_dispatch(
  p_attempt uuid,p_outcome text,p_bank_request uuid,p_http_status integer,p_error_code text,p_error_message text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  attempt apticket.inter_charge_dispatch_attempts;
  req apticket.inter_charge_requests;
begin
  if p_outcome is null or p_outcome not in ('submitted','uncertain','failed')
    or (p_outcome='submitted' and p_bank_request is null)
    or (p_outcome<>'submitted' and p_bank_request is not null)
    or p_http_status is not null and p_http_status not between 100 and 599 then
    raise exception using errcode='22023',message='Resultado inválido.';
  end if;
  select * into attempt from apticket.inter_charge_dispatch_attempts where id=p_attempt for update;
  if not found then raise exception using errcode='P0002',message='Tentativa não encontrada.'; end if;
  if attempt.status<>'claimed' then
    return jsonb_build_object('state',attempt.status,'request_id',attempt.request_id,
      'bank_request_id',attempt.bank_request_id,'reused',true);
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  if req.status<>'dispatching' then raise exception using errcode='40001',message='Estado da solicitação alterado.'; end if;
  update apticket.inter_charge_dispatch_attempts set status=p_outcome,bank_request_id=p_bank_request,
    http_status=p_http_status,error_code=left(nullif(p_error_code,''),60),
    error_message=left(nullif(p_error_message,''),300),finished_at=clock_timestamp() where id=attempt.id;
  update apticket.inter_charge_requests set status=p_outcome,bank_request_id=p_bank_request,
    bank_status=case when p_outcome='submitted' then 'EM_PROCESSAMENTO' else null end,
    bank_accepted_at=case when p_outcome='submitted' then clock_timestamp() else null end,
    last_error_code=left(nullif(p_error_code,''),60),last_error_message=left(nullif(p_error_message,''),300),
    updated_at=now() where id=req.id;
  return jsonb_build_object('state',p_outcome,'request_id',req.id,'bank_request_id',p_bank_request,'reused',false);
end $$;
revoke all on function apticket_finance_private.finish_inter_sandbox_dispatch(uuid,text,uuid,integer,text,text)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.finish_inter_sandbox_dispatch(uuid,text,uuid,integer,text,text)
  to service_role;

create function apticket.finish_inter_sandbox_dispatch(
  p_attempt uuid,p_outcome text,p_bank_request uuid,p_http_status integer,p_error_code text,p_error_message text
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.finish_inter_sandbox_dispatch(
    p_attempt,p_outcome,p_bank_request,p_http_status,p_error_code,p_error_message
  );
$$;
revoke all on function apticket.finish_inter_sandbox_dispatch(uuid,text,uuid,integer,text,text)
  from public,anon,authenticated;
grant execute on function apticket.finish_inter_sandbox_dispatch(uuid,text,uuid,integer,text,text)
  to service_role;

notify pgrst,'reload schema';
