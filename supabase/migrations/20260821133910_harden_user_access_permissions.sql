-- Auditoria de autorizacao: isolamento por tenant, revogacao imediata de
-- usuarios inativos, privilegios de coluna e funcoes internas.

begin;

-- Impede associacoes inconsistentes mesmo quando uma operacao usa service_role.
alter table apticket.profiles
  add constraint profiles_id_tenant_unique unique (id, tenant_id);
alter table apticket.roles
  add constraint roles_id_tenant_unique unique (id, tenant_id);

alter table apticket.user_roles
  add constraint user_roles_profile_tenant_fkey
    foreign key (user_id, tenant_id)
    references apticket.profiles (id, tenant_id) on delete cascade,
  add constraint user_roles_role_tenant_fkey
    foreign key (role_id, tenant_id)
    references apticket.roles (id, tenant_id) on delete restrict;

alter table apticket.user_permissions
  add constraint user_permissions_profile_tenant_fkey
    foreign key (user_id, tenant_id)
    references apticket.profiles (id, tenant_id) on delete cascade;

-- Token so pertence ao APTicket e usuario inativo perde RLS imediatamente.
create or replace function apticket.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p.tenant_id
  from apticket.profiles p
  where p.id = (select auth.uid())
    and p.is_active
    and coalesce(auth.jwt() ->> 'app', '') = 'apticket';
$$;

revoke all on function apticket.current_tenant_id() from public, anon;
grant execute on function apticket.current_tenant_id() to authenticated;

-- Consulta autenticada so pode resolver o proprio usuario. service_role e
-- postgres continuam aptos a resolver alvos depois de validar tenant no app.
create or replace function apticket.get_effective_permissions(_user_id uuid)
returns table(
  module text,
  action text,
  granted_by_role boolean,
  override boolean,
  effective boolean
)
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select
    p.module,
    p.action,
    (rp.permission_id is not null) as granted_by_role,
    up.granted as override,
    coalesce(up.granted, rp.permission_id is not null) as effective
  from apticket.permissions p
  left join apticket.user_roles ur on ur.user_id = _user_id
  left join apticket.role_permissions rp
    on rp.permission_id = p.id and rp.role_id = ur.role_id
  left join apticket.user_permissions up
    on up.permission_id = p.id and up.user_id = _user_id
  where _user_id = (select auth.uid())
     or current_user in ('service_role', 'postgres');
$$;

create or replace function apticket.has_permission(
  _user_id uuid,
  _module text,
  _action text
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(
    (select ep.effective
     from apticket.get_effective_permissions(_user_id) ep
     where ep.module = _module and ep.action = _action),
    false
  );
$$;

revoke all on function apticket.get_effective_permissions(uuid) from public, anon;
revoke all on function apticket.has_permission(uuid, text, text) from public, anon;
grant execute on function apticket.get_effective_permissions(uuid) to authenticated, service_role;
grant execute on function apticket.has_permission(uuid, text, text) to authenticated, service_role;

-- Funcoes de trigger/helper nao sao endpoints RPC publicos.
revoke all on function apticket.enforce_service_remote_only() from public, anon, authenticated;
revoke all on function apticket.protect_system_role() from public, anon, authenticated;
revoke all on function apticket.protect_system_role_permissions() from public, anon, authenticated;
revoke all on function apticket.seed_tenant_default_roles(uuid) from public, anon, authenticated;
revoke all on function apticket.seed_tenant_default_roles_trigger() from public, anon, authenticated;

-- Perfis: nunca entregar hash; cliente so altera preferencias e dados visuais.
revoke select, update on apticket.profiles from authenticated;
grant select (
  id, tenant_id, name, email, avatar_url, is_active, created_at, updated_at,
  tickets_auto_refresh_enabled, tickets_auto_refresh_seconds
) on apticket.profiles to authenticated;
grant update (
  name, avatar_url, tickets_auto_refresh_enabled, tickets_auto_refresh_seconds
) on apticket.profiles to authenticated;

-- Tenants: senhas e segredo de webhook ficam exclusivamente server-side.
-- Token UAZAPI permanece temporariamente disponivel para os envios legados
-- server-side do frontend; seu valor atual ja esta cifrado em repouso.
revoke select, update on apticket.tenants from authenticated;
grant select (
  id, name, slug, plan, created_at, updated_at,
  legal_name, trade_name, cnpj, state_registration, municipal_registration,
  email, phone, whatsapp, website, support_email, support_phone,
  zip_code, address_street, address_number, address_complement,
  address_district, address_city, address_state, address_country,
  logo_url, primary_color, timezone, business_hours_start,
  business_hours_end, business_days, notes,
  email_enabled, email_inbox_address, email_imap_host, email_imap_port,
  email_imap_secure, email_imap_user, email_smtp_host, email_smtp_port,
  email_smtp_secure, email_poll_interval_minutes, email_last_polled_at,
  whatsapp_enabled, whatsapp_uazapi_base_url, whatsapp_uazapi_instance,
  whatsapp_uazapi_token, whatsapp_connected_number
) on apticket.tenants to authenticated;
grant update (
  name, legal_name, trade_name, cnpj, state_registration,
  municipal_registration, email, phone, whatsapp, website, support_email,
  support_phone, zip_code, address_street, address_number,
  address_complement, address_district, address_city, address_state,
  address_country, logo_url, primary_color, timezone, business_hours_start,
  business_hours_end, business_days, notes
) on apticket.tenants to authenticated;

-- Papel de sistema e tenant do papel nao podem ser adulterados pela Data API.
revoke insert, update on apticket.roles from authenticated;
grant insert (tenant_id, name, description) on apticket.roles to authenticated;
grant update (name, description) on apticket.roles to authenticated;

-- Ninguem muda o proprio papel/override. Papel atribuido e permissao delegada
-- nao podem exceder as permissoes efetivas do ator.
drop policy "role_permissions manage" on apticket.role_permissions;
create policy "role_permissions manage" on apticket.role_permissions
  for all to authenticated
  using (
    exists (
      select 1 from apticket.roles r
      where r.id = role_permissions.role_id
        and r.tenant_id = apticket.current_tenant_id()
    )
    and apticket.has_permission(auth.uid(), 'papeis', 'edit')
    and exists (
      select 1 from apticket.permissions p
      where p.id = role_permissions.permission_id
        and apticket.has_permission(auth.uid(), p.module, p.action)
    )
  )
  with check (
    exists (
      select 1 from apticket.roles r
      where r.id = role_permissions.role_id
        and r.tenant_id = apticket.current_tenant_id()
    )
    and apticket.has_permission(auth.uid(), 'papeis', 'edit')
    and exists (
      select 1 from apticket.permissions p
      where p.id = role_permissions.permission_id
        and apticket.has_permission(auth.uid(), p.module, p.action)
    )
  );

drop policy "admin manages roles" on apticket.user_roles;
drop policy "read own roles or admin reads tenant roles" on apticket.user_roles;
create policy "read own roles or admin reads tenant roles" on apticket.user_roles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      tenant_id = apticket.current_tenant_id()
      and (
        apticket.has_permission(auth.uid(), 'usuarios', 'view')
        or apticket.has_permission(auth.uid(), 'permissoes', 'view')
      )
    )
  );

create policy "admin manages roles" on apticket.user_roles
  for all to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and user_id <> (select auth.uid())
    and apticket.has_permission(auth.uid(), 'usuarios', 'edit')
    and not exists (
      select 1
      from apticket.role_permissions rp
      join apticket.permissions p on p.id = rp.permission_id
      where rp.role_id = user_roles.role_id
        and not apticket.has_permission(auth.uid(), p.module, p.action)
    )
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and user_id <> (select auth.uid())
    and apticket.has_permission(auth.uid(), 'usuarios', 'edit')
    and not exists (
      select 1
      from apticket.role_permissions rp
      join apticket.permissions p on p.id = rp.permission_id
      where rp.role_id = user_roles.role_id
        and not apticket.has_permission(auth.uid(), p.module, p.action)
    )
  );

drop policy "user_permissions read tenant" on apticket.user_permissions;
create policy "user_permissions read tenant" on apticket.user_permissions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      tenant_id = apticket.current_tenant_id()
      and apticket.has_permission(auth.uid(), 'permissoes', 'view')
    )
  );

drop policy "user_permissions manage" on apticket.user_permissions;
create policy "user_permissions manage" on apticket.user_permissions
  for all to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and user_id <> (select auth.uid())
    and apticket.has_permission(auth.uid(), 'permissoes', 'edit')
    and exists (
      select 1 from apticket.permissions p
      where p.id = user_permissions.permission_id
        and apticket.has_permission(auth.uid(), p.module, p.action)
    )
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and user_id <> (select auth.uid())
    and created_by = (select auth.uid())
    and apticket.has_permission(auth.uid(), 'permissoes', 'edit')
    and exists (
      select 1 from apticket.permissions p
      where p.id = user_permissions.permission_id
        and apticket.has_permission(auth.uid(), p.module, p.action)
    )
  );

-- Impede remover ou rebaixar o ultimo administrador ativo do tenant.
create or replace function apticket.protect_last_active_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if old.is_active
     and (tg_op = 'DELETE' or not new.is_active)
     and exists (
       select 1
       from apticket.user_roles ur
       join apticket.roles r on r.id = ur.role_id
       where ur.user_id = old.id and r.is_system
     )
     and not exists (
       select 1
       from apticket.profiles p
       join apticket.user_roles ur on ur.user_id = p.id
       join apticket.roles r on r.id = ur.role_id
       where p.tenant_id = old.tenant_id
         and p.is_active
         and p.id <> old.id
         and r.is_system
     ) then
    raise exception 'nao e possivel remover ou desativar o ultimo administrador ativo';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_protect_last_admin on apticket.profiles;
create trigger profiles_protect_last_admin
  before update of is_active or delete on apticket.profiles
  for each row execute function apticket.protect_last_active_admin_profile();

create or replace function apticket.protect_last_active_admin_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
       select 1 from apticket.roles r
       where r.id = old.role_id and r.is_system
     )
     and exists (
       select 1 from apticket.profiles p
       where p.id = old.user_id and p.is_active
     )
     and not exists (
       select 1
       from apticket.profiles p
       join apticket.user_roles ur on ur.user_id = p.id
       join apticket.roles r on r.id = ur.role_id
       where p.tenant_id = old.tenant_id
         and p.is_active
         and p.id <> old.user_id
         and r.is_system
     ) then
    raise exception 'nao e possivel rebaixar o ultimo administrador ativo';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists user_roles_protect_last_admin on apticket.user_roles;
create trigger user_roles_protect_last_admin
  before update of role_id or delete on apticket.user_roles
  for each row execute function apticket.protect_last_active_admin_role();

revoke all on function apticket.protect_last_active_admin_profile() from public, anon, authenticated;
revoke all on function apticket.protect_last_active_admin_role() from public, anon, authenticated;

commit;
