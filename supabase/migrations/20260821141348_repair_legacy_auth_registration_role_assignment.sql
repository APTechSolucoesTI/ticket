-- Keep the legacy GoTrue fallback safe while APTicket uses its own profile
-- authentication. User metadata may identify this application, but it must
-- never be allowed to choose an existing tenant or role.

begin;

create or replace function apticket.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_tenant_id uuid;
  v_admin_role_id uuid;
  v_company text;
  v_name text;
  v_slug text;
begin
  if coalesce(new.raw_user_meta_data->>'app', '') is distinct from 'apticket' then
    return new;
  end if;

  -- invited_tenant_id and role identifiers in user metadata are intentionally
  -- ignored: raw_user_meta_data is controlled by the signing-up user.
  v_company := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'company_name'), ''),
    split_part(new.email, '@', 1) || ' workspace'
  );
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1)
  );
  v_slug := lower(regexp_replace(v_company, '[^a-zA-Z0-9]+', '-', 'g'))
    || '-'
    || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into apticket.tenants(name, slug)
  values (v_company, v_slug)
  returning id into v_tenant_id;

  insert into apticket.profiles(id, tenant_id, name, email)
  values (new.id, v_tenant_id, v_name, lower(new.email));

  select id
  into strict v_admin_role_id
  from apticket.roles
  where tenant_id = v_tenant_id
    and is_system;

  insert into apticket.user_roles(user_id, tenant_id, role_id)
  values (new.id, v_tenant_id, v_admin_role_id);

  return new;
end;
$$;

revoke all on function apticket.handle_new_user() from public, anon, authenticated;

commit;
