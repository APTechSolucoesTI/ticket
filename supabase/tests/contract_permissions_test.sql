begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ca100000-0000-0000-0000-000000000001','Rateios A','allocation-tests-a'),
 ('ca100000-0000-0000-0000-000000000002','Rateios B','allocation-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ca200000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios Admin','allocations-admin@example.test',true),
 ('ca200000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000002','Rateios B','allocations-other@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'ca200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('ca300000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios operadora A'),
 ('ca300000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000002','Rateios operadora B'),
 ('ca300000-0000-0000-0000-000000000003','ca100000-0000-0000-0000-000000000001','Rateios outra operadora');
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('ca400000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','10.01.0001','Categoria A','both'),
 ('ca400000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','10.01.0002','Categoria B','both'),
 ('ca400000-0000-0000-0000-000000000003','ca100000-0000-0000-0000-000000000002','ca300000-0000-0000-0000-000000000002','10.01.0001','Categoria outra tenant','both'),
 ('ca400000-0000-0000-0000-000000000004','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000003','10.01.0001','Categoria outra operadora','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('ca500000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','20.01.0001','Centro A'),
 ('ca500000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','20.01.0002','Centro B');
insert into apticket.companies(id,tenant_id,name) values
 ('ca600000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios cliente');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ca200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('ca700000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100.01,10,'ca400000-0000-0000-0000-000000000001','ca500000-0000-0000-0000-000000000001');
insert into apticket.suppliers(id, tenant_id, legal_name, category) values
 ('ca800000-0000-0000-0000-000000000001', apticket_appsec.fixture_actor('ca100000-0000-0000-0000-000000000001'), 'Rateios fornecedor', 'software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,financial_category_id,cost_center_id) values
 ('ca900000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca800000-0000-0000-0000-000000000001','Rateios fornecedor fixo','fixed',1,100.01,0,10,'2026-01-01','2026-12-31','ca400000-0000-0000-0000-000000000001','ca500000-0000-0000-0000-000000000001');


insert into apticket.roles(tenant_id,name) values
 ('ca100000-0000-0000-0000-000000000001','Supplier only'),
 ('ca100000-0000-0000-0000-000000000001','Customer only'),
 ('ca100000-0000-0000-0000-000000000001','Payables only'),
 ('ca100000-0000-0000-0000-000000000001','Supplier reader');
insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r cross join apticket.permissions p
where (r.name='Supplier only' and p.module='contratos_fornecedores')
 or (r.name='Customer only' and p.module='contratos')
 or (r.name='Payables only' and p.module like 'financeiro%')
 or (r.name='Supplier reader' and p.module='contratos_fornecedores' and p.action='view');
insert into apticket.profiles(id,tenant_id,name,email)
select ('cb200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'ca100000-0000-0000-0000-000000000001', 'Contract role '||n,'contract-role-'||n||'@example.test'
from generate_series(1,4) n;
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id
 and r.name=case right(p.id::text,1) when '1' then 'Supplier only' when '2' then 'Customer only'
 when '3' then 'Payables only' else 'Supplier reader' end where p.id::text like 'cb200000-%';
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write)
select p.tenant_id,p.id,'ca300000-0000-0000-0000-000000000001',right(p.id::text,1)<>'4'
from apticket.profiles p where p.id::text like 'cb200000-%';
select is((select count(*) from apticket.permissions where module='contratos_fornecedores'),4::bigint,'supplier module has independent CRUD');
select is((select count(*) from apticket.roles r cross join apticket.permissions p where r.is_system
 and not exists(select 1 from apticket.role_permissions rp where rp.role_id=r.id and rp.permission_id=p.id)),0::bigint,'all system role matrices complete');
-- A future catalogue entry is immediately effective for protected Admin.
insert into apticket.permissions(module,action) values('synthetic_new_area','view');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ca200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select ok(apticket.has_permission(auth.uid(),'synthetic_new_area','view'),'admin gets newly added catalogue actions');
select is((select count(*) from apticket.get_effective_permissions(auth.uid()) where not effective),0::bigint,'admin has every area/action');
select throws_ok($$insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted)
 select 'ca100000-0000-0000-0000-000000000001',auth.uid(),id,false from apticket.permissions where module='tickets' and action='view'$$,
 '42501',null,'admin cannot be individually restricted');
reset role;
-- A pre-existing deny must not limit a user subsequently promoted to Admin.
insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted)
 select 'ca100000-0000-0000-0000-000000000001','cb200000-0000-0000-0000-000000000004',id,false
 from apticket.permissions where module='tickets' and action='view';
update apticket.user_roles set role_id=(select id from apticket.roles where tenant_id='ca100000-0000-0000-0000-000000000001' and is_system)
 where user_id='cb200000-0000-0000-0000-000000000004';
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"cb200000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select ok(apticket.has_permission(auth.uid(),'tickets','view'),'promotion to admin ignores a legacy deny');
select is((select override from apticket.get_effective_permissions(auth.uid()) where module='tickets' and action='view'),null::boolean,'admin matrix does not advertise an effective override');
reset role;
update apticket.user_roles set role_id=(select id from apticket.roles where tenant_id='ca100000-0000-0000-0000-000000000001' and name='Supplier reader')
 where user_id='cb200000-0000-0000-0000-000000000004';
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"cb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select ok(not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','view'),'supplier-only user does not receive payable access');
select is((select count(*) from apticket.supplier_contracts),1::bigint,'supplier-only user reads permitted company contracts');
select is((select count(*) from apticket.contracts),0::bigint,'supplier-only user cannot read customer contracts');
select is(jsonb_array_length(apticket.get_supplier_contract_options()->'companies'),1,'lookup lists only scoped companies without finance permissions');
select is(jsonb_array_length(apticket.get_supplier_contract_options()->'suppliers'),1,'lookup returns minimal supplier references');
select ok(jsonb_array_length(apticket.get_supplier_contract_options('ca300000-0000-0000-0000-000000000001')->'categories')>0,'contract categories available without finance screen permission');
select throws_ok($$select apticket.get_supplier_contract_options('ca300000-0000-0000-0000-000000000003')$$,'42501',null,'lookup rejects unassigned company');
select throws_ok($$select apticket.get_supplier_contract_options('ca300000-0000-0000-0000-000000000002')$$,'42501',null,'lookup rejects foreign tenant company');
select lives_ok($$update apticket.supplier_contracts set description='Supplier-only edit' where id='ca900000-0000-0000-0000-000000000001'$$,'supplier edit does not require payable edit');
select is((select description from apticket.supplier_contracts where id='ca900000-0000-0000-0000-000000000001'),'Supplier-only edit','supplier edit persisted');
select throws_ok($$select apticket.generate_supplier_measurement('ca900000-0000-0000-0000-000000000001','2026-01-01')$$,'42501',null,'payment generation retains financial authorization');
reset role;
-- Only create is allowed; update and archive remain separate actions.
delete from apticket.role_permissions rp using apticket.roles r,apticket.permissions p
where rp.role_id=r.id and rp.permission_id=p.id and r.name='Supplier only' and p.action in ('edit','delete');
set local role authenticated;
select lives_ok($$insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,base_amount,unit_price,due_day,starts_at,financial_category_id,cost_center_id)
values('cb900000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca800000-0000-0000-0000-000000000001','Create-only supplier contract','fixed',1,0,10,'2026-01-01','ca400000-0000-0000-0000-000000000001','ca500000-0000-0000-0000-000000000001')$$,'create permission creates supplier contract');
with changed as (update apticket.supplier_contracts set description='Not allowed' where id='ca900000-0000-0000-0000-000000000001' returning id) select is((select count(*) from changed),0::bigint,'create permission does not allow editing');
select throws_ok($$select apticket.archive_supplier_contract('ca900000-0000-0000-0000-000000000001')$$,'42501',null,'create permission does not allow deletion');
reset role;
insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r cross join apticket.permissions p where r.name='Supplier only' and p.module='contratos_fornecedores' and p.action='delete';
set local role authenticated;
select lives_ok($$select apticket.archive_supplier_contract('cb900000-0000-0000-0000-000000000001')$$,'delete permission archives without edit permission');
reset role;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"cb200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select is((select count(*) from apticket.contracts),1::bigint,'customer-only user still reads customer contracts');
select is((select count(*) from apticket.supplier_contracts),0::bigint,'customer permissions do not grant supplier contracts');
select throws_ok($$select apticket.get_supplier_contract_options()$$,'42501',null,'customer-only user cannot invoke supplier lookup');
reset role;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"cb200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select is((select count(*) from apticket.supplier_contracts),0::bigint,'payable permissions alone no longer grant supplier contracts');
select throws_ok($$select apticket.archive_supplier_contract('ca900000-0000-0000-0000-000000000001')$$,'42501',null,'payable edit does not allow contract deletion');
select throws_ok($$select apticket.generate_supplier_payable('ca900000-0000-0000-0000-000000000001','2026-01-01')$$,'42501',null,'payable generator also checks supplier contract edit');
reset role;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"cb200000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
set local role authenticated;
select ok(not apticket.has_permission(auth.uid(),'tickets','view'),'non-admin personal deny remains effective');
select is((select count(*) from apticket.supplier_contracts where deleted_at is null),1::bigint,'supplier reader retains scoped read');
with changed as (update apticket.supplier_contracts set description='Reader denied' where id='ca900000-0000-0000-0000-000000000001' returning id) select is((select count(*) from changed),0::bigint,'supplier reader cannot update');
select throws_ok($$select apticket.archive_supplier_contract('ca900000-0000-0000-0000-000000000001')$$,'42501',null,'supplier reader cannot archive');
reset role;
select * from finish();
rollback;
