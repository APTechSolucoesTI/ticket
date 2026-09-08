create table apticket.tenant_inter_configurations (
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  environment text not null check(environment in ('sandbox','production')),
  account text not null check(account ~ '^[1-9][0-9]{0,19}$'),
  secret_id uuid not null references vault.secrets(id) on delete restrict,
  certificate_expires_at timestamptz not null,
  certificate_fingerprint text not null,
  is_active boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key(tenant_id,environment),
  foreign key(updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index one_inter_environment_per_tenant on apticket.tenant_inter_configurations(tenant_id) where is_active;
alter table apticket.tenant_inter_configurations enable row level security;
revoke all on apticket.tenant_inter_configurations from public,anon,authenticated,service_role;
grant select on apticket.tenant_inter_configurations to service_role;

create table apticket.inter_configuration_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  actor_id uuid not null,
  environment text not null,
  action text not null check(action in ('saved','selected','deselected')),
  occurred_at timestamptz not null default now(),
  foreign key(actor_id,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
alter table apticket.inter_configuration_audit enable row level security;
revoke all on apticket.inter_configuration_audit from public,anon,authenticated,service_role;
grant select on apticket.inter_configuration_audit to service_role;
create trigger inter_audit_no_delete before delete on apticket.inter_configuration_audit
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_configuration_no_delete before delete on apticket.tenant_inter_configurations
  for each row execute function apticket_finance_private.guard_record();

-- Backend-only RPC: valida novamente identidade ativa e permissões, sem confiar
-- no tenant informado pelo browser. Não existe RPC para devolver os segredos.
create function apticket.save_tenant_inter_configuration(
  p_actor uuid,p_tenant uuid,p_environment text,p_account text,p_credentials jsonb,
  p_expires_at timestamptz,p_fingerprint text,p_activate boolean,p_production_confirmed boolean,p_version integer
) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare existing apticket.tenant_inter_configurations; credentials jsonb; secret uuid; k text;
begin
  if not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa','edit')
    or not apticket.has_permission(p_actor,'configuracoes','view') then
    raise exception using errcode='42501',message='Sem permissão.';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production')
    or p_account is null or p_account !~ '^[1-9][0-9]{0,19}$'
    or p_activate is null or p_version is null
    or (p_activate and p_environment='production' and not coalesce(p_production_confirmed,false))
    or p_credentials is null or jsonb_typeof(p_credentials)<>'object' then
    raise exception using errcode='22023',message='Configuração inválida.';
  end if;
  perform 1 from apticket.tenants where id=p_tenant for update;
  select * into existing from apticket.tenant_inter_configurations where tenant_id=p_tenant and environment=p_environment;
  if coalesce(existing.version,0)<>p_version then
    raise exception using errcode='40001',message='Configuração alterada por outro usuário.';
  end if;
  if existing.secret_id is not null then
    select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=existing.secret_id;
  end if;
  if exists(select 1 from jsonb_object_keys(p_credentials) key where key not in ('client_id','client_secret','certificate','private_key')) then
    raise exception using errcode='22023',message='Campo inválido.';
  end if;
  credentials:=coalesce(credentials,'{}')||p_credentials;
  foreach k in array array['client_id','client_secret','certificate','private_key'] loop
    if jsonb_typeof(credentials->k) is distinct from 'string' or length(btrim(credentials->>k))=0
      or length(credentials->>k)>32768 then
      raise exception using errcode='22023',message='Credenciais incompletas.';
    end if;
  end loop;
  if coalesce(p_expires_at,existing.certificate_expires_at,now())<=now()
    or coalesce(p_fingerprint,existing.certificate_fingerprint,'')='' then
    raise exception using errcode='22023',message='Certificado inválido.';
  end if;
  if existing.secret_id is null then
    select vault.create_secret(credentials::text,'apticket_inter_'||p_tenant||'_'||p_environment) into secret;
  else
    secret:=existing.secret_id;
    perform vault.update_secret(secret,credentials::text);
  end if;
  if p_activate then
    insert into apticket.inter_configuration_audit(tenant_id,actor_id,environment,action)
      select tenant_id,p_actor,environment,'deselected' from apticket.tenant_inter_configurations
      where tenant_id=p_tenant and environment<>p_environment and is_active;
    update apticket.tenant_inter_configurations set is_active=false,version=version+1,updated_by=p_actor,updated_at=now()
      where tenant_id=p_tenant and environment<>p_environment and is_active;
  end if;
  insert into apticket.tenant_inter_configurations(tenant_id,environment,account,secret_id,certificate_expires_at,
    certificate_fingerprint,is_active,updated_by,version)
  values(p_tenant,p_environment,p_account,secret,coalesce(p_expires_at,existing.certificate_expires_at),
    coalesce(p_fingerprint,existing.certificate_fingerprint),p_activate,p_actor,p_version+1)
  on conflict(tenant_id,environment) do update set account=excluded.account,certificate_expires_at=excluded.certificate_expires_at,
    certificate_fingerprint=excluded.certificate_fingerprint,is_active=excluded.is_active,updated_by=excluded.updated_by,
    updated_at=now(),version=excluded.version;
  insert into apticket.inter_configuration_audit(tenant_id,actor_id,environment,action)
    values(p_tenant,p_actor,p_environment,case when p_activate then 'selected' else 'saved' end);
end $$;
revoke all on function apticket.save_tenant_inter_configuration(uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer)
  from public,anon,authenticated;
grant execute on function apticket.save_tenant_inter_configuration(uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer) to service_role;
notify pgrst,'reload schema';
