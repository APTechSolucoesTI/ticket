-- Emergency rollback only, coordinated with reverting the session-aware apps.
-- WARNING: removing version checks restores validity of previously revoked JWTs
-- until their original expiry. Prefer a forward fix. Never run automatically.
begin;
set local lock_timeout = '5s';
do $$
declare existing_hook text; t record;
begin
  select split_part(setting, '=', 2) into existing_hook
  from pg_roles r cross join lateral unnest(r.rolconfig) setting
  where r.rolname = 'authenticator' and setting like 'pgrst.db_pre_request=%';
  if existing_hook is distinct from 'apticket_auth_private.check_session' then
    raise exception 'Unexpected PostgREST hook; review rollback composition';
  end if;
  for t in select tablename from pg_tables where schemaname = 'apticket' loop
    execute format('drop policy if exists apticket_session_required on apticket.%I', t.tablename);
  end loop;
end $$;
alter role authenticator reset pgrst.db_pre_request;
drop policy apticket_storage_session_required on storage.objects;
-- Restore the active-profile helper observed before this migration in production.
create or replace function apticket.current_tenant_id()
returns uuid language sql stable security definer set search_path = pg_catalog as $$
  select p.tenant_id from apticket.profiles p where p.id = auth.uid() and p.is_active;
$$;
drop trigger profiles_revoke_sessions_on_password_change on apticket.profiles;
drop function apticket.complete_password_reset(text,text);
drop function apticket.complete_invite(text,text);
drop function apticket_auth_private.complete_credential(text,text,text);
drop function apticket_auth_private.check_session();
drop function apticket_auth_private.session_is_current();
drop function apticket_auth_private.protect_session_version();
drop schema apticket_auth_private; -- No CASCADE: unknown dependencies abort safely.
alter table apticket.profiles drop column session_version;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
