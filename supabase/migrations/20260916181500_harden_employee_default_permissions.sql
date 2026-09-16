-- Somente Admin e RH recebem o pacote completo automaticamente. Financeiro
-- recebe apenas leitura, dados de pagamento e folha pela regra da migration-base.
delete from apticket.role_permissions role_permission
using apticket.roles role,apticket.permissions permission
where role.id=role_permission.role_id and permission.id=role_permission.permission_id
  and permission.module='funcionarios' and role.is_system
  and lower(role.name)<>'admin';

insert into apticket.role_permissions(role_id,permission_id)
select role.id,permission.id from apticket.roles role cross join apticket.permissions permission
where permission.module='funcionarios' and lower(role.name) in ('admin','rh')
on conflict do nothing;
