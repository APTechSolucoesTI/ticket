begin;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('af100000-0000-4000-8000-000000000001','Session A','appsec-session-a'),
 ('af100000-0000-4000-8000-000000000002','Session B','appsec-session-b');
insert into apticket.profiles(id,tenant_id,name,email,password_hash,is_active) values
 ('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','Fixture A','session-a@example.test','$2b$12$'||repeat('a',53),true),
 ('af200000-0000-4000-8000-000000000002','af100000-0000-4000-8000-000000000001','Fixture Other','session-other@example.test','$2b$12$'||repeat('a',53),true),
 ('af200000-0000-4000-8000-000000000003','af100000-0000-4000-8000-000000000002','Fixture B','session-b@example.test','$2b$12$'||repeat('a',53),true);
insert into apticket.password_resets(profile_id,token_hash,expires_at) values
 ('af200000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 hour'),
 ('af200000-0000-4000-8000-000000000001',repeat('b',64),now()+interval '1 hour');
insert into apticket.invites(profile_id,token_hash,expires_at) values
 ('af200000-0000-4000-8000-000000000001',repeat('c',64),now()+interval '1 hour');
select ok(not has_function_privilege('anon','apticket.complete_password_reset(text,text)','EXECUTE'),'anonymous cannot reset directly');
select ok(not has_function_privilege('authenticated','apticket.complete_password_reset(text,text)','EXECUTE'),'authenticated cannot reset directly');
select ok(has_function_privilege('service_role','apticket.complete_password_reset(text,text)','EXECUTE'),'trusted server can reset');
select is((select count(*) from pg_policies where schemaname='apticket' and policyname='apticket_session_required'),(select count(*) from pg_tables where schemaname='apticket'),'all current application tables have a session fence');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","tenant_id":"af100000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket"}',true);
select ok(apticket_auth_private.session_is_current(),'legacy JWT remains valid at version zero');
select lives_ok('select apticket_auth_private.check_session()','legacy JWT pre-request accepted');
select is((select count(*) from apticket.tenants),1::bigint,'legacy session reads own tenant');
select throws_ok('select session_version from apticket.profiles','42501',null,'session version hidden from browser');
select throws_ok('update apticket.profiles set session_version=5','42501',null,'browser cannot reset session version');
reset role;
set local role service_role;
select is((select session_version from apticket.complete_password_reset(repeat('a',64),'$2b$12$'||repeat('b',53))),1::bigint,'reset increments version atomically');
select throws_ok($$select * from apticket.complete_password_reset(repeat('a',64),'$2b$12$'||repeat('c',53))$$,'22023','credential_token_invalid','reset token cannot be reused');
select throws_ok($$select * from apticket.complete_password_reset(repeat('b',64),'$2b$12$'||repeat('c',53))$$,'22023','credential_token_invalid','other pending reset token is revoked');
select throws_ok($$select * from apticket.complete_invite(repeat('c',64),'$2b$12$'||repeat('c',53))$$,'22023','credential_token_invalid','old invite cannot override the reset');
reset role;
set local role authenticated;
select ok(not apticket_auth_private.session_is_current(),'legacy JWT is revoked after reset');
select throws_ok('select apticket_auth_private.check_session()','PT401','session_revoked','PostgREST pre-request rejects revoked JWT before privileged RPC');
select is((select count(*) from apticket.tenants),0::bigint,'revoked JWT cannot read tenant');
select is((select count(*) from apticket.profiles),0::bigint,'revoked JWT cannot use uid-only profile policy');
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","tenant_id":"af100000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket","session_version":1}',true);
select ok(apticket_auth_private.session_is_current(),'fresh JWT accepted at new version');
select is((select count(*) from apticket.tenants),1::bigint,'fresh JWT retains own tenant access');
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","tenant_id":"af100000-0000-4000-8000-000000000002","role":"authenticated","app":"apticket","session_version":1}',true);
select ok(not apticket_auth_private.session_is_current(),'tenant substitution denied');
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","tenant_id":"af100000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket","session_version":"999999999999999999999999"}',true);
select ok(not apticket_auth_private.session_is_current(),'invalid version fails closed without cast error');
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","role":"authenticated","app":"other-app"}',true);
select lives_ok('select apticket_auth_private.check_session()','shared PostgREST hook preserves other applications');
reset role;
update apticket.profiles set password_hash='$2b$12$'||repeat('d',53) where id='af200000-0000-4000-8000-000000000001';
select is((select session_version from apticket.profiles where id='af200000-0000-4000-8000-000000000001'),2::bigint,'direct server password change also revokes sessions');
select is((select session_version from apticket.profiles where id='af200000-0000-4000-8000-000000000002'),0::bigint,'other user sessions are preserved');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000002","tenant_id":"af100000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket"}',true);
select ok(apticket_auth_private.session_is_current(),'another legacy session remains valid');
reset role;

-- A broad Storage policy from a shared app cannot bypass the session fence.
insert into storage.buckets(id,name,public) values ('ticket-attachments','ticket-attachments',false),('appsec-other-app','appsec-other-app',false) on conflict do nothing;
insert into storage.objects(bucket_id,name) values
 ('ticket-attachments','af100000-0000-4000-8000-000000000001/ticket/fixture.pdf'),
 ('appsec-other-app','fixture.pdf');
create policy appsec_session_test_broad on storage.objects for all to authenticated,anon using(true) with check(true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-4000-8000-000000000001","tenant_id":"af100000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket","session_version":1}',true);
select is((select count(*) from storage.objects where bucket_id='ticket-attachments'),0::bigint,'revoked JWT cannot use broad Storage policy');
select is((select count(*) from storage.objects where bucket_id='appsec-other-app'),1::bigint,'other app bucket policy unchanged');
reset role;

update apticket.profiles set is_active=false where id='af200000-0000-4000-8000-000000000002';
insert into apticket.invites(profile_id,token_hash,expires_at) values
 ('af200000-0000-4000-8000-000000000002',repeat('d',64),now()+interval '1 hour');
set local role service_role;
select is((select session_version from apticket.complete_invite(repeat('d',64),'$2b$12$'||repeat('d',53))),1::bigint,'invite activates profile and creates new credential version');
select throws_ok($$select * from apticket.complete_invite(repeat('d',64),'$2b$12$'||repeat('e',53))$$,'22023','credential_token_invalid','invite token cannot be reused');
reset role;
select ok((select is_active from apticket.profiles where id='af200000-0000-4000-8000-000000000002'),'invite retains activation behavior');
insert into apticket.password_resets(profile_id,token_hash,expires_at) values
 ('af200000-0000-4000-8000-000000000002',repeat('e',64),now()-interval '1 minute'),
 ('af200000-0000-4000-8000-000000000002',repeat('f',64),now()+interval '1 hour');
set local role service_role;
select throws_ok($$select * from apticket.complete_password_reset(repeat('e',64),'$2b$12$'||repeat('e',53))$$,'22023','credential_token_invalid','expired reset rejected');
reset role;
create function pg_temp.fail_fixture_password() returns trigger language plpgsql as $$begin raise exception 'fixture write failure'; end$$;
create trigger appsec_session_test_failure before update of password_hash on apticket.profiles for each row execute function pg_temp.fail_fixture_password();
set local role service_role;
select throws_ok($$select * from apticket.complete_password_reset(repeat('f',64),'$2b$12$'||repeat('f',53))$$,'P0001','fixture write failure','password write failure aborts reset');
reset role;
select ok((select accepted_at is null from apticket.password_resets where token_hash=repeat('f',64)),'failed write rolls back token consumption');
select is((select session_version from apticket.profiles where id='af200000-0000-4000-8000-000000000002'),1::bigint,'failed reset preserves credential version');
select * from finish();
rollback;
