-- Fatia 13: libera o ambiente oficial somente com confirmação explícita,
-- configuração oficial ativa e webhook previamente registrado no Inter.
alter table apticket.inter_charge_dispatch_attempts
  drop constraint inter_charge_dispatch_attempts_environment_check,
  add constraint inter_charge_dispatch_attempts_environment_check
    check (environment in ('sandbox','production')),
  add column production_confirmed_at timestamptz,
  add constraint inter_dispatch_production_confirmation_check check (
    (environment='production')=(production_confirmed_at is not null)
  );

create function apticket_finance_private.prepare_inter_charge_dispatch(
  p_request uuid,p_confirmed boolean,p_production_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
  if req.environment='production' and p_production_confirmed is distinct from true then
    raise exception using errcode='22023',message='Confirmação específica do ambiente oficial obrigatória.';
  end if;
  if req.environment='production' and not exists(
    select 1 from apticket.tenant_inter_configurations cfg
    where cfg.tenant_id=req.tenant_id and cfg.environment='production'
      and cfg.is_active and cfg.webhook_status='active'
      and cfg.webhook_secret_id is not null and cfg.certificate_expires_at>now()
  ) then
    raise exception using errcode='P0001',
      message='Ative a configuração oficial e registre o webhook antes da primeira emissão.';
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
    tenant_id,operating_company_id,request_id,snapshot_id,binding_id,environment,
    attempt_number,created_by,production_confirmed_at
  ) values(
    req.tenant_id,req.operating_company_id,req.id,snap.id,snap.binding_id,req.environment,
    req.dispatch_attempts+1,actor,
    case when req.environment='production' then clock_timestamp() end
  ) returning * into attempt;
  update apticket.inter_charge_requests set status='dispatching',dispatch_attempts=dispatch_attempts+1,
    dispatch_started_at=attempt.started_at,updated_at=now(),last_error_code=null,last_error_message=null where id=req.id;
  return jsonb_build_object('state','dispatching','request_id',req.id,'attempt_id',attempt.id,
    'actor_id',actor,'environment',req.environment,'reused',false);
end $$;
revoke all on function apticket_finance_private.prepare_inter_charge_dispatch(uuid,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.prepare_inter_charge_dispatch(uuid,boolean,boolean)
  to authenticated;

create function apticket.prepare_inter_charge_dispatch(
  p_request uuid,p_confirmed boolean,p_production_confirmed boolean default false
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_charge_dispatch(
    p_request,p_confirmed,p_production_confirmed
  );
$$;
revoke all on function apticket.prepare_inter_charge_dispatch(uuid,boolean,boolean)
  from public,anon,service_role;
grant execute on function apticket.prepare_inter_charge_dispatch(uuid,boolean,boolean)
  to authenticated;

create function apticket_finance_private.load_inter_charge_dispatch(p_attempt uuid,p_actor uuid)
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
  if not found or attempt.created_by<>p_actor
    or attempt.environment not in ('sandbox','production') or attempt.status<>'claimed'
    or attempt.started_at<clock_timestamp()-interval '2 minutes' then
    raise exception using errcode='40001',message='Tentativa indisponível ou expirada.';
  end if;
  select * into req from apticket.inter_charge_requests where id=attempt.request_id for update;
  select * into snap from apticket.inter_payer_snapshots where id=attempt.snapshot_id and deleted_at is null;
  select * into binding from apticket.operating_company_inter_bindings where id=attempt.binding_id and deleted_at is null;
  select * into cfg from apticket.tenant_inter_configurations
    where tenant_id=attempt.tenant_id and environment=attempt.environment;
  if req.status<>'dispatching' or req.environment<>attempt.environment
    or snap.id is null or binding.id is null or cfg.tenant_id is null
    or cfg.version<>binding.configuration_version or cfg.certificate_expires_at<=now()
    or req.amount<>snap.amount or req.due_date<>snap.due_date
    or (attempt.environment='production' and (
      not cfg.is_active or cfg.webhook_status<>'active' or cfg.webhook_secret_id is null
      or attempt.production_confirmed_at is null
    )) then
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
    'attempt_id',attempt.id,'actor_id',attempt.created_by,'environment',attempt.environment,'account',cfg.account,
    'token_cache_key',cfg.tenant_id::text||':'||attempt.environment||':'||cfg.version::text||':'||cfg.certificate_fingerprint,
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
revoke all on function apticket_finance_private.load_inter_charge_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.load_inter_charge_dispatch(uuid,uuid)
  to service_role;

create function apticket.load_inter_charge_dispatch(p_attempt uuid,p_actor uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.load_inter_charge_dispatch(p_attempt,p_actor);
$$;
revoke all on function apticket.load_inter_charge_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function apticket.load_inter_charge_dispatch(uuid,uuid) to service_role;

create function apticket.finish_inter_charge_dispatch(
  p_attempt uuid,p_outcome text,p_bank_request uuid,p_http_status integer,
  p_error_code text,p_error_message text
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.finish_inter_sandbox_dispatch(
    p_attempt,p_outcome,p_bank_request,p_http_status,p_error_code,p_error_message
  );
$$;
revoke all on function apticket.finish_inter_charge_dispatch(uuid,text,uuid,integer,text,text)
  from public,anon,authenticated;
grant execute on function apticket.finish_inter_charge_dispatch(uuid,text,uuid,integer,text,text)
  to service_role;

notify pgrst,'reload schema';
