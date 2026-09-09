begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug,cnpj) values
 ('b6100000-0000-0000-0000-000000000001','Binding A','binding-test-a','12.345.678/0001-95'),
 ('b6100000-0000-0000-0000-000000000002','Binding B','binding-test-b','98.765.432/0001-98');
insert into apticket.profiles(id,tenant_id,name,email,is_active)
select ('b6200000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'b6100000-0000-0000-0000-000000000001','Binding user','binding-'||n||'@example.test',true from generate_series(1,3) n;
insert into apticket.roles(tenant_id,name) values('b6100000-0000-0000-0000-000000000001','Financeiro') on conflict do nothing;
insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r cross join apticket.permissions p where r.tenant_id='b6100000-0000-0000-0000-000000000001'
 and r.name='Financeiro' and p.module='financeiro' and p.action in ('view','edit') on conflict do nothing;
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id
 and r.name=case when right(p.id::text,1)='3' then 'Financeiro' else 'Admin' end where p.id::text like 'b6200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name,tax_id) values
 ('b6300000-0000-0000-0000-000000000001','b6100000-0000-0000-0000-000000000001','Binding A','12345678000195'),
 ('b6300000-0000-0000-0000-000000000002','b6100000-0000-0000-0000-000000000002','Binding B','98765432000198');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write)
select tenant_id,id,'b6300000-0000-0000-0000-000000000001',true from apticket.profiles
 where id in ('b6200000-0000-0000-0000-000000000001','b6200000-0000-0000-0000-000000000003');
-- Fake configuration only; no bank calls and all fixtures roll back.
insert into apticket.tenant_inter_configurations(tenant_id,environment,account,secret_id,certificate_expires_at,certificate_fingerprint,updated_by)
select 'b6100000-0000-0000-0000-000000000001',env,'12345678',vault.create_secret('{}'),now()+interval '1 year','fixture',
 'b6200000-0000-0000-0000-000000000001' from unnest(array['sandbox','production']) env;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'state','confirmation_required','not bound automatically');
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'account_last_four','5678','account masked');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',1,null,false)$$,'22023',null,'explicit confirmation required');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',9,null,true)$$,'40001',null,'stale configuration denied');
select is(apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',1,null,true)->>'reused','false','admin can confirm');
select is(apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',1,null,true)->>'reused','true','retry idempotent');
select is((select count(*) from apticket.operating_company_inter_bindings),1::bigint,'no duplicate');
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'state','confirmed','confirmed state');
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'dispatch_enabled','false','does not enable bank dispatch');
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','production')->>'state','confirmation_required','production independent');
select throws_ok($$select apticket.review_inter_binding('b6300000-0000-0000-0000-000000000002','sandbox')$$,'42501',null,'cross tenant read denied');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000002','sandbox',1,null,true)$$,'42501',null,'cross tenant write denied');
select throws_ok($$select * from apticket.tenant_inter_configurations$$,'42501',null,'configuration secrets remain inaccessible');
select throws_ok($$update apticket.operating_company_inter_bindings set configuration_version=2$$,'42501',null,'direct edits denied');
select throws_ok($$insert into apticket.operating_company_inter_bindings default values$$,'42501',null,'direct insert denied');
select throws_ok($$delete from apticket.operating_company_inter_bindings$$,'42501',null,'delete denied');
select set_config('test.binding',(select id::text from apticket.operating_company_inter_bindings where environment='sandbox'),true);
reset role;
update apticket.tenant_inter_configurations set version=2 where tenant_id='b6100000-0000-0000-0000-000000000001' and environment='sandbox';
set local role authenticated;
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'state','confirmation_outdated','configuration change invalidates confirmation');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',2,null,true)$$,'40001',null,'must review previous binding');
select is(apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',2,current_setting('test.binding')::uuid,true)->>'reused','false','reconfirmation creates new snapshot');
select is((select count(*) from apticket.operating_company_inter_bindings where deleted_at is not null),1::bigint,'old snapshot retained');
select is((select count(*) from apticket.financial_audit_log where entity_table='operating_company_inter_bindings' and actor_id=auth.uid()),3::bigint,'inserts and supersession audited');
select set_config('request.jwt.claims','{"sub":"b6200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')$$,'42501',null,'admin without financial grant denied');
select is((select count(*) from apticket.operating_company_inter_bindings),0::bigint,'RLS hides bindings without scope');
select set_config('request.jwt.claims','{"sub":"b6200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is(apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','production',1,null,true)->>'reused','false','finance profile can confirm');
reset role;
update apticket.financial_access set can_write=false where user_id='b6200000-0000-0000-0000-000000000003';
set local role authenticated;
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','production')->>'state','confirmed','read-only scope can consult');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','production',1,null,true)$$,'42501',null,'read-only scope cannot confirm');
reset role;
update apticket.tenants set cnpj='98.765.432/0001-98' where id='b6100000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b6200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'state','company_tax_mismatch','company identity change detected');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',2,null,true)$$,'23514',null,'mismatched company denied');
reset role;
update apticket.tenants set cnpj='12.345.678/0001-95' where id='b6100000-0000-0000-0000-000000000001';
update apticket.tenant_inter_configurations set certificate_expires_at=now()-interval '1 day'
 where tenant_id='b6100000-0000-0000-0000-000000000001' and environment='sandbox';
set local role authenticated;
select is(apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox')->>'state','certificate_expired','expired certificate detected');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','sandbox',2,null,true)$$,'23514',null,'expired certificate rejected');
select throws_ok($$select apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','invalid')$$,'22023',null,'invalid environment rejected');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','production',1,null,null)$$,'22023',null,'null confirmation rejected');
reset role;
update apticket.profiles set is_active=false where id='b6200000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select apticket.review_inter_binding('b6300000-0000-0000-0000-000000000001','production')$$,'42501',null,'inactive user denied with existing claims');
select throws_ok($$select apticket.confirm_inter_binding('b6300000-0000-0000-0000-000000000001','production',1,null,true)$$,'42501',null,'inactive user cannot confirm');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select apticket.review_inter_binding(null,'sandbox')$$,'42501',null,'missing subject denied');
set local role anon;
select throws_ok($$select apticket.review_inter_binding(null,'sandbox')$$,'42501',null,'anon cannot consult');
select throws_ok($$select apticket.confirm_inter_binding(null,'sandbox',1,null,true)$$,'42501',null,'anon cannot confirm');
set local role service_role;
select throws_ok($$select apticket.confirm_inter_binding(null,'sandbox',1,null,true)$$,'42501',null,'service cannot impersonate user confirmation');
reset role;
select throws_ok($$delete from apticket.operating_company_inter_bindings where tenant_id='b6100000-0000-0000-0000-000000000001'$$,'23514',null,'history protected from physical deletion');
select * from finish();
rollback;
