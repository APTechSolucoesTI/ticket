-- Credenciais e webhooks do Banco Inter passam a pertencer a uma empresa
-- operadora. A tenant continua representando o grupo empresarial.
alter table apticket.tenant_inter_configurations add column operating_company_id uuid;
update apticket.tenant_inter_configurations cfg set operating_company_id=(
  select c.id from apticket.operating_companies c
  where c.tenant_id=cfg.tenant_id and c.deleted_at is null
  order by c.created_at,c.id limit 1
);
do $$ begin
  if exists(select 1 from apticket.tenant_inter_configurations where operating_company_id is null) then
    raise exception 'Existe configuracao do Inter sem empresa operadora para migracao.';
  end if;
end $$;

alter table apticket.inter_configuration_audit add column operating_company_id uuid;
update apticket.inter_configuration_audit audit set operating_company_id=(
  select c.id from apticket.operating_companies c
  where c.tenant_id=audit.tenant_id and c.deleted_at is null
  order by c.created_at,c.id limit 1
);
alter table apticket.inter_webhook_registration_attempts add column operating_company_id uuid;
update apticket.inter_webhook_registration_attempts attempt set operating_company_id=(
  select cfg.operating_company_id from apticket.tenant_inter_configurations cfg
  where cfg.tenant_id=attempt.tenant_id and cfg.environment=attempt.environment
);

alter table apticket.operating_company_inter_bindings
  drop constraint operating_company_inter_bindings_tenant_id_environment_fkey;
alter table apticket.inter_webhook_registration_attempts
  drop constraint inter_webhook_registration_attempts_tenant_id_environment_fkey;
alter table apticket.tenant_inter_configurations drop constraint tenant_inter_configurations_pkey;
drop index apticket.one_inter_environment_per_tenant;
alter table apticket.tenant_inter_configurations
  alter column operating_company_id set not null,
  add constraint tenant_inter_configurations_pkey
    primary key(tenant_id,operating_company_id,environment),
  add constraint tenant_inter_configurations_operator_fkey
    foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict;
create unique index one_inter_environment_per_operator
  on apticket.tenant_inter_configurations(tenant_id,operating_company_id) where is_active;
create unique index inter_webhook_secret_key
  on apticket.tenant_inter_configurations(environment,webhook_secret_hash)
  where webhook_secret_hash is not null;

alter table apticket.inter_configuration_audit
  alter column operating_company_id set not null,
  add constraint inter_configuration_audit_operator_fkey
    foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict;
alter table apticket.inter_webhook_registration_attempts
  alter column operating_company_id set not null,
  add constraint inter_webhook_registration_configuration_fkey
    foreign key(tenant_id,operating_company_id,environment)
    references apticket.tenant_inter_configurations(tenant_id,operating_company_id,environment) on delete restrict;
alter table apticket.operating_company_inter_bindings
  add constraint operating_company_inter_binding_configuration_fkey
    foreign key(tenant_id,operating_company_id,environment)
    references apticket.tenant_inter_configurations(tenant_id,operating_company_id,environment) on delete restrict;
drop index apticket.inter_binding_current;
create unique index inter_binding_current
  on apticket.operating_company_inter_bindings(tenant_id,operating_company_id,environment)
  where deleted_at is null;

drop function apticket.save_tenant_inter_configuration(uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer);
create function apticket.save_tenant_inter_configuration(
  p_actor uuid,p_tenant uuid,p_company uuid,p_environment text,p_account text,p_credentials jsonb,
  p_expires_at timestamptz,p_fingerprint text,p_activate boolean,p_production_confirmed boolean,p_version integer
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare existing apticket.tenant_inter_configurations; credentials jsonb; secret uuid; k text;
begin
  if not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa_operadora','edit')
    or not apticket.has_permission(p_actor,'configuracoes','view')
    or not exists(select 1 from apticket.operating_companies where id=p_company and tenant_id=p_tenant and is_active and deleted_at is null)
    or not exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
      where ur.user_id=p_actor and ur.tenant_id=p_tenant and r.name in ('Admin','Financeiro')) then
    raise exception using errcode='42501',message='Sem permissao para configurar o banco desta empresa operadora.';
  end if;
  if p_environment not in ('sandbox','production') or p_account !~ '^[1-9][0-9]{0,19}$'
    or p_activate is null or p_version is null or (p_activate and p_environment='production' and not coalesce(p_production_confirmed,false))
    or p_credentials is null or jsonb_typeof(p_credentials)<>'object' then
    raise exception using errcode='22023',message='Configuracao invalida.';
  end if;
  perform 1 from apticket.operating_companies where id=p_company and tenant_id=p_tenant for update;
  select * into existing from apticket.tenant_inter_configurations
    where tenant_id=p_tenant and operating_company_id=p_company and environment=p_environment;
  if coalesce(existing.version,0)<>p_version then raise exception using errcode='40001',message='Configuracao alterada por outro usuario.'; end if;
  if existing.secret_id is not null then select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=existing.secret_id; end if;
  if exists(select 1 from jsonb_object_keys(p_credentials) key where key not in ('client_id','client_secret','certificate','private_key')) then
    raise exception using errcode='22023',message='Campo invalido.';
  end if;
  credentials:=coalesce(credentials,'{}')||p_credentials;
  foreach k in array array['client_id','client_secret','certificate','private_key'] loop
    if jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0 or length(credentials->>k)>32768 then
      raise exception using errcode='22023',message='Credenciais incompletas.';
    end if;
  end loop;
  if coalesce(p_expires_at,existing.certificate_expires_at,now())<=now() or coalesce(p_fingerprint,existing.certificate_fingerprint,'')='' then
    raise exception using errcode='22023',message='Certificado invalido.';
  end if;
  if existing.secret_id is null then
    select vault.create_secret(credentials::text,'apticket_inter_'||p_tenant||'_'||p_company||'_'||p_environment) into secret;
  else secret:=existing.secret_id; perform vault.update_secret(secret,credentials::text); end if;
  if p_activate then
    insert into apticket.inter_configuration_audit(tenant_id,operating_company_id,actor_id,environment,action)
      select tenant_id,operating_company_id,p_actor,environment,'deselected' from apticket.tenant_inter_configurations
      where tenant_id=p_tenant and operating_company_id=p_company and environment<>p_environment and is_active;
    update apticket.tenant_inter_configurations set is_active=false,version=version+1,updated_by=p_actor,updated_at=now()
      where tenant_id=p_tenant and operating_company_id=p_company and environment<>p_environment and is_active;
  end if;
  insert into apticket.tenant_inter_configurations(tenant_id,operating_company_id,environment,account,secret_id,
    certificate_expires_at,certificate_fingerprint,is_active,updated_by,version)
  values(p_tenant,p_company,p_environment,p_account,secret,coalesce(p_expires_at,existing.certificate_expires_at),
    coalesce(p_fingerprint,existing.certificate_fingerprint),p_activate,p_actor,p_version+1)
  on conflict(tenant_id,operating_company_id,environment) do update set account=excluded.account,
    certificate_expires_at=excluded.certificate_expires_at,certificate_fingerprint=excluded.certificate_fingerprint,
    is_active=excluded.is_active,updated_by=excluded.updated_by,updated_at=now(),version=excluded.version;
  insert into apticket.inter_configuration_audit(tenant_id,operating_company_id,actor_id,environment,action)
    values(p_tenant,p_company,p_actor,p_environment,case when p_activate then 'selected' else 'saved' end);
end $$;
revoke all on function apticket.save_tenant_inter_configuration(uuid,uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer) from public,anon,authenticated;
grant execute on function apticket.save_tenant_inter_configuration(uuid,uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer) to service_role;

drop function apticket.prepare_inter_connection_test(uuid,uuid,text,integer);
create function apticket.prepare_inter_connection_test(p_actor uuid,p_tenant uuid,p_company uuid,p_environment text,p_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare config apticket.tenant_inter_configurations; credentials jsonb;
begin
  if not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa_operadora','edit')
    or not exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
      where ur.user_id=p_actor and ur.tenant_id=p_tenant and r.name in ('Admin','Financeiro')) then
    raise exception using errcode='42501',message='Sem permissao.';
  end if;
  select * into config from apticket.tenant_inter_configurations
    where tenant_id=p_tenant and operating_company_id=p_company and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Salve a configuracao primeiro.'; end if;
  if config.version<>p_version then raise exception using errcode='40001',message='Atualize a configuracao.'; end if;
  if config.certificate_expires_at<=now() then raise exception using errcode='22023',message='Certificado vencido.'; end if;
  if config.last_connection_attempt>now()-interval '60 seconds' then raise exception using errcode='54000',message='Aguarde um minuto.'; end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=config.secret_id;
  if credentials is null then raise exception using errcode='22023',message='Credenciais indisponiveis.'; end if;
  update apticket.tenant_inter_configurations set last_connection_attempt=now()
    where tenant_id=p_tenant and operating_company_id=p_company and environment=p_environment;
  insert into apticket.inter_configuration_audit(tenant_id,operating_company_id,actor_id,environment,action)
    values(p_tenant,p_company,p_actor,p_environment,'connection_test');
  return credentials;
end $$;
revoke all on function apticket.prepare_inter_connection_test(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function apticket.prepare_inter_connection_test(uuid,uuid,uuid,text,integer) to service_role;

drop function apticket.prepare_inter_webhook_registration(uuid,uuid,text,integer,text);
drop function apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,text,integer,text);
create function apticket_finance_private.prepare_inter_webhook_registration(
  p_actor uuid,p_tenant uuid,p_company uuid,p_environment text,p_version integer,p_callback_base_url text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cfg apticket.tenant_inter_configurations; attempt apticket.inter_webhook_registration_attempts;
  credentials jsonb; candidate_token text; candidate_hash text;
begin
  if not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa_operadora','edit')
    or not exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
      where ur.user_id=p_actor and ur.tenant_id=p_tenant and r.name in ('Admin','Financeiro')) then
    raise exception using errcode='42501',message='Exige perfil Admin ou Financeiro.';
  end if;
  if p_environment not in ('sandbox','production') or p_version<1 or p_callback_base_url is null
    or length(p_callback_base_url)>500 or p_callback_base_url !~ '^https://[^?#]+$' then
    raise exception using errcode='22023',message='Ambiente ou URL publica invalida.';
  end if;
  select * into cfg from apticket.tenant_inter_configurations where tenant_id=p_tenant
    and operating_company_id=p_company and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Configuracao bancaria nao encontrada.'; end if;
  if cfg.version<>p_version then raise exception using errcode='40001',message='Configuracao alterada.'; end if;
  if cfg.certificate_expires_at<=now() then raise exception using errcode='22023',message='Certificado vencido.'; end if;
  select * into attempt from apticket.inter_webhook_registration_attempts where tenant_id=p_tenant
    and operating_company_id=p_company and environment=p_environment and status='claimed'
    order by started_at desc limit 1;
  if found and attempt.started_at>clock_timestamp()-interval '2 minutes' then
    raise exception using errcode='54000',message='Ja existe uma configuracao em andamento.';
  end if;
  if found then update apticket.inter_webhook_registration_attempts set status='failed',finished_at=clock_timestamp(),
    error_code='LEASE_EXPIRED',error_message='A configuracao anterior nao foi concluida.' where id=attempt.id; end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=cfg.secret_id;
  if credentials is null or exists(select 1 from unnest(array['client_id','client_secret','certificate','private_key']) k
    where jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0) then
    raise exception using errcode='22023',message='Credenciais bancarias incompletas.';
  end if;
  candidate_token:=encode(extensions.gen_random_bytes(32),'hex');
  candidate_hash:=encode(extensions.digest(candidate_token,'sha256'),'hex');
  insert into apticket.inter_webhook_registration_attempts(
    tenant_id,operating_company_id,environment,configuration_version,callback_base_url,candidate_secret_hash,created_by
  ) values(p_tenant,p_company,p_environment,p_version,p_callback_base_url,candidate_hash,p_actor) returning * into attempt;
  update apticket.tenant_inter_configurations set webhook_status='configuring',webhook_updated_at=clock_timestamp(),
    webhook_last_error_code=null,webhook_last_error_message=null where tenant_id=p_tenant
      and operating_company_id=p_company and environment=p_environment;
  return jsonb_build_object('attempt_id',attempt.id,'environment',p_environment,'account',cfg.account,
    'callback_url',p_callback_base_url||'?token='||candidate_token,'candidate_token',candidate_token,
    'token_cache_key',p_tenant||':'||p_company||':'||p_environment||':'||cfg.version||':'||cfg.certificate_fingerprint,
    'credentials',credentials);
end $$;
revoke all on function apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text) to service_role;
create function apticket.prepare_inter_webhook_registration(
  p_actor uuid,p_tenant uuid,p_company uuid,p_environment text,p_version integer,p_callback_base_url text
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_webhook_registration(
    p_actor,p_tenant,p_company,p_environment,p_version,p_callback_base_url);
$$;
revoke all on function apticket.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function apticket.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text) to service_role;

-- Atualiza consumidores internos para escolher a credencial da mesma operadora
-- da cobranca, tentativa ou vinculo. A migration falha se uma assinatura mudar.
create function apticket_finance_private.patch_inter_function(fn regprocedure,old_text text,new_text text)
returns void language plpgsql set search_path=pg_catalog as $$
declare d text; original text;
begin
  select pg_get_functiondef(fn) into d; original:=d; d:=replace(d,old_text,new_text);
  if d=original then raise exception 'Nao foi possivel adaptar %',fn; end if;
  execute d;
end $$;
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_charge_dispatch(uuid,uuid)',
  'where tenant_id=attempt.tenant_id and environment=attempt.environment',
  'where tenant_id=attempt.tenant_id and operating_company_id=attempt.operating_company_id and environment=attempt.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_charge_dispatch(uuid,uuid)',
  'cfg.tenant_id::text||'':''||attempt.environment',
  'cfg.tenant_id::text||'':''||attempt.operating_company_id::text||'':''||attempt.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_charge_sync(uuid,uuid)',
  'where tenant_id=attempt.tenant_id and environment=attempt.environment',
  'where tenant_id=attempt.tenant_id and operating_company_id=attempt.operating_company_id and environment=attempt.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_charge_sync(uuid,uuid)',
  'cfg.tenant_id::text||'':''||attempt.environment',
  'cfg.tenant_id::text||'':''||attempt.operating_company_id::text||'':''||attempt.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_sandbox_dispatch(uuid,uuid)',
  'where tenant_id=attempt.tenant_id and environment=''sandbox''',
  'where tenant_id=attempt.tenant_id and operating_company_id=attempt.operating_company_id and environment=''sandbox''');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.load_inter_sandbox_dispatch(uuid,uuid)',
  'cfg.tenant_id::text||'':sandbox:''',
  'cfg.tenant_id::text||'':''||attempt.operating_company_id::text||'':sandbox:''');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.review_inter_payer(uuid)',
  'where tenant_id = req.tenant_id and environment = req.environment',
  'where tenant_id = req.tenant_id and operating_company_id = req.operating_company_id and environment = req.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.prepare_inter_charge_sync_from_webhook(uuid,uuid)',
  'where tenant_id=req.tenant_id and environment=req.environment',
  'where tenant_id=req.tenant_id and operating_company_id=req.operating_company_id and environment=req.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.prepare_inter_charge_dispatch(uuid,boolean,boolean)',
  'where cfg.tenant_id=req.tenant_id and cfg.environment=''production''',
  'where cfg.tenant_id=req.tenant_id and cfg.operating_company_id=req.operating_company_id and cfg.environment=''production''');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.accept_inter_charge_webhook(text,text,jsonb)',
  'where tenant_id=cfg.tenant_id and environment=p_environment',
  'where tenant_id=cfg.tenant_id and operating_company_id=cfg.operating_company_id and environment=p_environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.finish_inter_webhook_registration(uuid,text,integer,text,text,text)',
  'where tenant_id=attempt.tenant_id and environment=attempt.environment',
  'where tenant_id=attempt.tenant_id and operating_company_id=attempt.operating_company_id and environment=attempt.environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.review_inter_binding(uuid,text)',
  'where tenant_id=c.tenant_id and environment=p_environment',
  'where tenant_id=c.tenant_id and operating_company_id=c.id and environment=p_environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.review_inter_binding(uuid,text)',
  'where tenant_id=c.tenant_id
    and environment=p_environment and deleted_at is null',
  'where tenant_id=c.tenant_id and operating_company_id=c.id
    and environment=p_environment and deleted_at is null');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.review_inter_binding(uuid,text)',
  'when c.tax_id is null or c.tax_id is distinct from tenant_tax then',
  'when c.tax_id is null then');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.confirm_inter_binding(uuid,text,integer,uuid,boolean)',
  'where tenant_id=c.tenant_id and environment=p_environment',
  'where tenant_id=c.tenant_id and operating_company_id=c.id and environment=p_environment');
select apticket_finance_private.patch_inter_function(
  'apticket_finance_private.confirm_inter_binding(uuid,text,integer,uuid,boolean)',
  'if not found or c.tax_id is null or c.tax_id is distinct from tenant_tax then',
  'if not found or c.tax_id is null then');
drop function apticket_finance_private.patch_inter_function(regprocedure,text,text);

comment on column apticket.tenant_inter_configurations.operating_company_id is
  'Empresa operadora proprietaria das credenciais, ambiente e webhook bancario.';
notify pgrst,'reload schema';
