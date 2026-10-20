-- Password changes revoke earlier APTicket JWTs without invalidating other apps.
-- Existing APTicket tokens without session_version are version 0 until a reset.
begin;
set local lock_timeout = '5s';

do $$
declare existing_hook text;
begin
  if not (select rolsuper from pg_roles where rolname = current_user)
     and exists (
       select 1 from pg_tables where schemaname in ('apticket', 'storage')
         and not pg_has_role(current_user, tableowner, 'USAGE')
     ) then
    raise insufficient_privilege using message = 'Migration requires ownership privileges for all application and Storage tables';
  end if;
  select split_part(setting, '=', 2) into existing_hook
  from pg_roles r cross join lateral unnest(r.rolconfig) setting
  where r.rolname = 'authenticator' and setting like 'pgrst.db_pre_request=%';
  if coalesce(existing_hook, '') not in ('', 'apticket_auth_private.check_session') then
    raise exception 'An existing PostgREST pre-request hook requires explicit composition';
  end if;
end $$;

create schema apticket_auth_private;
revoke all on schema apticket_auth_private from public;
grant usage on schema apticket_auth_private to anon, authenticated, service_role;

alter table apticket.profiles add column session_version bigint not null default 0
  check (session_version between 0 and 9007199254740991);
-- Profiles already use column grants. The new column is server-only.
revoke select (session_version), update (session_version) on apticket.profiles
  from public, anon, authenticated;

create function apticket_auth_private.protect_session_version()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.session_version is distinct from old.session_version
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise insufficient_privilege using message = 'Session version is server-managed';
  end if;
  if new.password_hash is distinct from old.password_hash then
    new.session_version := old.session_version + 1;
  end if;
  return new;
end $$;
revoke all on function apticket_auth_private.protect_session_version() from public, anon, authenticated;
create trigger profiles_revoke_sessions_on_password_change
before update on apticket.profiles for each row
execute function apticket_auth_private.protect_session_version();

create function apticket_auth_private.session_is_current()
returns boolean language plpgsql stable security definer set search_path = pg_catalog as $$
declare claims jsonb := auth.jwt(); token_version text;
begin
  if coalesce(claims ->> 'app', '') <> 'apticket'
     or coalesce(claims ->> 'role', '') <> 'authenticated' then return false; end if;
  token_version := coalesce(claims ->> 'session_version', '0');
  if token_version !~ '^(0|[1-9][0-9]*)$' then return false; end if;
  return exists (
    select 1 from apticket.profiles p
    where p.id = auth.uid() and p.is_active
      and p.tenant_id::text = claims ->> 'tenant_id'
      and p.session_version = token_version::bigint
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end $$;
revoke all on function apticket_auth_private.session_is_current() from public;
grant execute on function apticket_auth_private.session_is_current() to anon, authenticated, service_role;

create or replace function apticket.current_tenant_id()
returns uuid language sql stable security definer set search_path = pg_catalog as $$
  select p.tenant_id from apticket.profiles p
  where p.id = auth.uid() and apticket_auth_private.session_is_current();
$$;

-- Restrictive policies also cover own-profile/permission policies that only use uid.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'apticket' loop
    execute format(
      'create policy apticket_session_required on apticket.%I as restrictive for all to authenticated using ((select apticket_auth_private.session_is_current())) with check ((select apticket_auth_private.session_is_current()))',
      t.tablename
    );
  end loop;
end $$;

create policy apticket_storage_session_required on storage.objects as restrictive
for all to authenticated, anon
using (
  bucket_id not in ('ticket-attachments','kb-attachments','client-documents',
    'funcionario-documentos','funcionario-beneficios','supplier-payment-receipts',
    'supplier-payable-attachments','apticket-profile-avatars')
  or (select apticket_auth_private.session_is_current())
)
with check (
  bucket_id not in ('ticket-attachments','kb-attachments','client-documents',
    'funcionario-documentos','funcionario-beneficios','supplier-payment-receipts',
    'supplier-payable-attachments','apticket-profile-avatars')
  or (select apticket_auth_private.session_is_current())
);

-- PostgREST must reject revoked tokens before SECURITY DEFINER RPCs as well.
-- The shared gateway keeps other applications' JWTs and anonymous flows intact.
create function apticket_auth_private.check_session()
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if coalesce(auth.jwt() ->> 'app', '') = 'apticket'
     and not apticket_auth_private.session_is_current() then
    raise sqlstate 'PT401' using message = 'session_revoked';
  end if;
end $$;
revoke all on function apticket_auth_private.check_session() from public;
grant execute on function apticket_auth_private.check_session() to anon, authenticated, service_role;

create function apticket_auth_private.complete_credential(
  _kind text, _token_hash text, _password_hash text
)
returns table(id uuid, tenant_id uuid, name text, email text, session_version bigint)
language plpgsql security invoker set search_path = pg_catalog as $$
declare target_id uuid; token_id uuid; claimed_id uuid; active boolean;
begin
  if _token_hash is null or _token_hash !~ '^[0-9a-f]{64}$'
     or _password_hash is null or _password_hash !~ '^[$]2[aby][$]1[2-5][$][./A-Za-z0-9]{53}$' then
    raise invalid_parameter_value using message = 'credential_token_invalid';
  end if;
  if _kind = 'reset' then
    select r.id, r.profile_id into token_id, target_id from apticket.password_resets r
    where r.token_hash = _token_hash and r.accepted_at is null and r.expires_at > clock_timestamp();
  elsif _kind = 'invite' then
    select i.id, i.profile_id into token_id, target_id from apticket.invites i
    where i.token_hash = _token_hash and i.accepted_at is null and i.expires_at > clock_timestamp();
  else raise invalid_parameter_value using message = 'credential_token_invalid';
  end if;
  if target_id is null then raise invalid_parameter_value using message = 'credential_token_invalid'; end if;

  -- Serialize all credential changes for a profile, including different tokens.
  select p.is_active into active from apticket.profiles p where p.id = target_id for update;
  if not found or (_kind = 'reset' and not active) then
    raise invalid_parameter_value using message = 'credential_token_invalid';
  end if;
  if _kind = 'reset' then
    update apticket.password_resets r set accepted_at = clock_timestamp()
    where r.id = token_id and r.accepted_at is null and r.expires_at > clock_timestamp()
    returning r.id into claimed_id;
  else
    update apticket.invites i set accepted_at = clock_timestamp()
    where i.id = token_id and i.accepted_at is null and i.expires_at > clock_timestamp()
    returning i.id into claimed_id;
  end if;
  if claimed_id is null then raise invalid_parameter_value using message = 'credential_token_invalid'; end if;

  update apticket.profiles p set password_hash = _password_hash,
    is_active = case when _kind = 'invite' then true else p.is_active end
  where p.id = target_id;
  update apticket.password_resets r set accepted_at = clock_timestamp()
    where r.profile_id = target_id and r.accepted_at is null;
  update apticket.invites i set accepted_at = clock_timestamp()
    where i.profile_id = target_id and i.accepted_at is null;

  return query select p.id,p.tenant_id,p.name,p.email,p.session_version
    from apticket.profiles p where p.id = target_id;
end $$;
revoke all on function apticket_auth_private.complete_credential(text,text,text) from public, anon, authenticated;
grant execute on function apticket_auth_private.complete_credential(text,text,text) to service_role;

create function apticket.complete_password_reset(_token_hash text, _password_hash text)
returns table(id uuid, tenant_id uuid, name text, email text, session_version bigint)
language sql security invoker set search_path = pg_catalog as $$
  select * from apticket_auth_private.complete_credential('reset', _token_hash, _password_hash);
$$;
create function apticket.complete_invite(_token_hash text, _password_hash text)
returns table(id uuid, tenant_id uuid, name text, email text, session_version bigint)
language sql security invoker set search_path = pg_catalog as $$
  select * from apticket_auth_private.complete_credential('invite', _token_hash, _password_hash);
$$;
revoke all on function apticket.complete_password_reset(text,text) from public, anon, authenticated;
revoke all on function apticket.complete_invite(text,text) from public, anon, authenticated;
grant execute on function apticket.complete_password_reset(text,text) to service_role;
grant execute on function apticket.complete_invite(text,text) to service_role;

-- Self-hosted tables have mixed owners, so a privileged migration role is needed.
-- Keep runtime helpers owned by the existing non-superuser BYPASSRLS role.
alter schema apticket_auth_private owner to postgres;
alter function apticket_auth_private.protect_session_version() owner to postgres;
alter function apticket_auth_private.session_is_current() owner to postgres;
alter function apticket_auth_private.check_session() owner to postgres;
alter function apticket_auth_private.complete_credential(text,text,text) owner to postgres;
alter function apticket.complete_password_reset(text,text) owner to postgres;
alter function apticket.complete_invite(text,text) owner to postgres;

alter role authenticator set pgrst.db_pre_request = 'apticket_auth_private.check_session';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
