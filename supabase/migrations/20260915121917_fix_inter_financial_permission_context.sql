-- Funcoes bancarias chamadas por Edge Functions recebem o ator explicitamente.
-- Nelas, current_user e o proprietario SECURITY DEFINER, portanto o helper
-- publico has_permission (deliberadamente limitado a auth.uid()) nao pode ser
-- usado para autorizar esse ator. Mantenha a verificacao explicita privada,
-- vinculada ao tenant e respeitando overrides por usuario.
create or replace function apticket_finance_private.actor_has_permission(
  p_actor uuid,
  p_tenant uuid,
  p_module text,
  p_action text
) returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from apticket.profiles profile
    join apticket.permissions permission
      on permission.module = p_module
     and permission.action = p_action
    where profile.id = p_actor
      and profile.tenant_id = p_tenant
      and profile.is_active
      and coalesce(
        (
          select user_permission.granted
          from apticket.user_permissions user_permission
          where user_permission.user_id = p_actor
            and user_permission.tenant_id = p_tenant
            and user_permission.permission_id = permission.id
        ),
        exists (
          select 1
          from apticket.user_roles user_role
          join apticket.roles role
            on role.id = user_role.role_id
           and role.tenant_id = user_role.tenant_id
          join apticket.role_permissions role_permission
            on role_permission.role_id = role.id
           and role_permission.permission_id = permission.id
          where user_role.user_id = p_actor
            and user_role.tenant_id = p_tenant
        )
      )
  );
$$;

revoke all on function apticket_finance_private.actor_has_permission(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

create function apticket_finance_private.patch_inter_actor_permission(
  p_function regprocedure
) returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(p_function) into definition;
  patched := replace(
    definition,
    'apticket.has_permission(p_actor,',
    'apticket_finance_private.actor_has_permission(p_actor,p_tenant,'
  );
  if patched = definition then
    raise exception 'A funcao % nao continha a verificacao de permissao esperada.', p_function;
  end if;
  execute patched;
end;
$$;

select apticket_finance_private.patch_inter_actor_permission(
  'apticket.save_tenant_inter_configuration(uuid,uuid,uuid,text,text,jsonb,timestamptz,text,boolean,boolean,integer)'
    ::regprocedure
);
select apticket_finance_private.patch_inter_actor_permission(
  'apticket.prepare_inter_connection_test(uuid,uuid,uuid,text,integer)'::regprocedure
);
select apticket_finance_private.patch_inter_actor_permission(
  'apticket_finance_private.prepare_inter_webhook_registration(uuid,uuid,uuid,text,integer,text)'
    ::regprocedure
);

drop function apticket_finance_private.patch_inter_actor_permission(regprocedure);

notify pgrst, 'reload schema';
