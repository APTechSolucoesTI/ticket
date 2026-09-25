begin;

create or replace function apticket.grant_automation_permissions_to_admin_role()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if lower(new.name) = 'admin' then
    insert into apticket.role_permissions(role_id, permission_id)
    select new.id, permission.id
    from apticket.permissions permission
    where permission.module = 'automacoes'
    on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function apticket.grant_automation_permissions_to_admin_role()
  from public, anon, authenticated, service_role;

create trigger roles_grant_automation_permissions
after insert on apticket.roles
for each row execute function apticket.grant_automation_permissions_to_admin_role();

comment on function apticket.grant_automation_permissions_to_admin_role() is
  'Garante que o papel Admin de novos tenants receba o catálogo de automações.';

commit;
