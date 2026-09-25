begin;

drop trigger if exists roles_grant_automation_permissions on apticket.roles;
create constraint trigger roles_grant_automation_permissions
after insert on apticket.roles
deferrable initially deferred
for each row execute function apticket.grant_automation_permissions_to_admin_role();

comment on trigger roles_grant_automation_permissions on apticket.roles is
  'Executa após o seed completo do tenant para não disputar a carga inicial de permissões.';

commit;
