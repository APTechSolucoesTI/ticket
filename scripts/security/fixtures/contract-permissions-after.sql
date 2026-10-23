select is((select count(*) from apticket.role_permissions rp join apticket.roles r on r.id=rp.role_id
 join apticket.permissions p on p.id=rp.permission_id where r.name='Legacy finance' and p.module='contratos_fornecedores'),4::bigint,'legacy payable access copied to supplier CRUD');
select is((select count(*) from apticket.role_permissions rp join apticket.roles r on r.id=rp.role_id
 join apticket.permissions p on p.id=rp.permission_id where r.name='Legacy customer' and p.module='contratos_fornecedores'),0::bigint,'customer-only role not expanded');
select is((select count(*) from apticket.role_permissions rp join apticket.roles r on r.id=rp.role_id
 join apticket.permissions p on p.id=rp.permission_id where r.name='Legacy customer' and p.module='contratos'),4::bigint,'legacy customer CRUD preserved');
select is((select count(*) from apticket.user_permissions up join apticket.permissions p on p.id=up.permission_id
 where up.user_id='cd200000-0000-0000-0000-000000000001' and p.module='contratos_fornecedores' and p.action='view' and not up.granted),1::bigint,'individual view denial copied');
select is((select count(*) from apticket.user_permissions up join apticket.permissions p on p.id=up.permission_id
 where up.user_id='cd200000-0000-0000-0000-000000000001' and p.module='contratos_fornecedores' and p.action in ('create','edit','delete') and up.granted),3::bigint,'individual write grant copied to each write action');
select is((select count(*) from apticket.user_permissions up join apticket.permissions p on p.id=up.permission_id
 where up.user_id='cd200000-0000-0000-0000-000000000002' and p.module='contratos_fornecedores' and not up.granted),4::bigint,'old financial-parent deny preserves all effective supplier restrictions');
select is((select count(*) from apticket.roles r cross join apticket.permissions p where r.is_system
 and not exists(select 1 from apticket.role_permissions rp where rp.role_id=r.id and rp.permission_id=p.id)),0::bigint,'existing system role matrix complete');
insert into apticket.tenants(id,name,slug)
values('cd100000-0000-0000-0000-000000000002','New permission tenant','new-permission-fixture');
select is((select count(*) from apticket.role_permissions rp join apticket.roles r on r.id=rp.role_id
 join apticket.permissions p on p.id=rp.permission_id where r.tenant_id='cd100000-0000-0000-0000-000000000002' and r.name='Financeiro' and p.module='contratos_fornecedores'),4::bigint,'future finance role receives supplier CRUD');
select is((select count(*) from apticket.role_permissions rp join apticket.roles r on r.id=rp.role_id
 join apticket.permissions p on p.id=rp.permission_id where r.tenant_id='cd100000-0000-0000-0000-000000000002' and r.name in ('Agente','Solicitante') and p.module='contratos_fornecedores'),0::bigint,'future non-financial default roles remain restricted');
select * from finish();
