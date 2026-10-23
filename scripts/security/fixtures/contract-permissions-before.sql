-- Run only in the disposable migration test, before the split exists.
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug)
values('cd100000-0000-0000-0000-000000000001','Permission migration fixture','permission-migration-fixture');
insert into apticket.roles(tenant_id,name) values
 ('cd100000-0000-0000-0000-000000000001','Legacy finance'),
 ('cd100000-0000-0000-0000-000000000001','Legacy customer');
insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r cross join apticket.permissions p
where r.tenant_id='cd100000-0000-0000-0000-000000000001'
 and ((r.name='Legacy finance' and p.module in ('financeiro','financeiro_contas_pagar'))
   or (r.name='Legacy customer' and p.module='contratos'));
insert into apticket.profiles(id,tenant_id,name,email) values
 ('cd200000-0000-0000-0000-000000000001','cd100000-0000-0000-0000-000000000001','Legacy user','legacy-permission@example.test'),
 ('cd200000-0000-0000-0000-000000000002','cd100000-0000-0000-0000-000000000001','Parent denied','legacy-parent-denied@example.test');
insert into apticket.user_roles(user_id,tenant_id,role_id)
select 'cd200000-0000-0000-0000-000000000001',tenant_id,id from apticket.roles
where tenant_id='cd100000-0000-0000-0000-000000000001' and name='Legacy finance';
insert into apticket.user_roles(user_id,tenant_id,role_id)
select 'cd200000-0000-0000-0000-000000000002',tenant_id,id from apticket.roles
where tenant_id='cd100000-0000-0000-0000-000000000001' and name='Legacy finance';
insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted)
select 'cd100000-0000-0000-0000-000000000001','cd200000-0000-0000-0000-000000000001',id,action='edit'
from apticket.permissions where module='financeiro_contas_pagar';
insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted)
select 'cd100000-0000-0000-0000-000000000001','cd200000-0000-0000-0000-000000000002',id,false
from apticket.permissions where module='financeiro' and action='view';
