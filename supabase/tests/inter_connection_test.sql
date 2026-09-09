begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values ('d1000000-0000-0000-0000-000000000001','Inter test','inter-test');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Inter admin','inter-admin@example.test',true),
 ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','Inter viewer','inter-view@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select 'd2000000-0000-0000-0000-000000000001',tenant_id,id from apticket.roles where tenant_id='d1000000-0000-0000-0000-000000000001' and name='Admin';
set local role service_role;
select apticket.save_tenant_inter_configuration('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','sandbox','123456',
 '{"client_id":"test-id","client_secret":"test-secret","certificate":"test-cert","private_key":"test-key"}','2099-01-01','test-fingerprint',false,false,0);
select throws_ok($$select apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','sandbox',1)$$,'42501',null,'viewer denied');
select throws_ok($$select apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','sandbox',1)$$,'42501',null,'cross tenant denied');
select throws_ok($$select apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','production',1)$$,'P0002',null,'unsaved environment denied');
select throws_ok($$select apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','sandbox',2)$$,'40001',null,'stale version denied');
select is(apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','sandbox',1)->>'client_id','test-id','backend receives correct environment');
select throws_ok($$select apticket.prepare_inter_connection_test('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','sandbox',1)$$,'54000',null,'cooldown enforced');
select is((select count(*) from apticket.inter_configuration_audit where action='connection_test' and tenant_id='d1000000-0000-0000-0000-000000000001'),1::bigint,'attempt audited');
set local role authenticated;
select throws_ok($$select apticket.prepare_inter_connection_test(null,null,'sandbox',1)$$,'42501',null,'user cannot retrieve credentials');
set local role anon;
select throws_ok($$select apticket.prepare_inter_connection_test(null,null,'sandbox',1)$$,'42501',null,'anon cannot retrieve credentials');
reset role;
select * from finish();
rollback;
