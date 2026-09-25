begin;

drop trigger if exists roles_grant_financial_document_permissions on apticket.roles;
create constraint trigger roles_grant_financial_document_permissions
after insert on apticket.roles
deferrable initially deferred
for each row execute function apticket.grant_financial_document_permissions_to_role();

comment on trigger roles_grant_financial_document_permissions on apticket.roles is
  'Executa após o seed completo do tenant, evitando duplicidade no papel Admin.';

commit;
