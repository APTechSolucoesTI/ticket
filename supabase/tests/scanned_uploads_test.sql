begin;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ae100000-0000-4000-8000-000000000001','Scan A','scan-fixture-a'),
 ('ae100000-0000-4000-8000-000000000002','Scan B','scan-fixture-b');
insert into apticket.profiles(id,tenant_id,name,email) values
 ('ae200000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','Scan admin','scan@example.test');
insert into apticket.user_roles(user_id,tenant_id,role_id)
 select 'ae200000-0000-4000-8000-000000000001',tenant_id,id from apticket.roles
 where tenant_id='ae100000-0000-4000-8000-000000000001' and name='Admin';
insert into apticket.tickets(id,tenant_id,subject) values
 ('ae300000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001','Scan A'),
 ('ae300000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000002','Scan B');
insert into storage.buckets(id,name,public) values('scan-test-other-app','scan-test-other-app',false);
select ok(not has_function_privilege('anon','apticket.can_upload_apticket_object(text,text)','execute'),'anonymous cannot authorize uploads');
select ok(not has_function_privilege('authenticated','apticket.create_scanned_upload_permit(text,text,bigint,text)','execute'),'browser cannot mint scan receipts');
select ok(has_function_privilege('service_role','apticket.create_scanned_upload_permit(text,text,bigint,text)','execute'),'scanner server can mint receipts');
select ok((select relrowsecurity from pg_class where oid='apticket_security_private.scanned_upload_permits'::regclass),'private receipt table has RLS');
select ok(not (select rolsuper from pg_roles where oid=(select proowner from pg_proc where oid='apticket_security_private.require_scanned_object()'::regprocedure)),'receipt trigger owner is not superuser');

set local role authenticated;
select set_config('request.jwt.claims','{"app":"apticket","role":"authenticated","sub":"ae200000-0000-4000-8000-000000000001","tenant_id":"ae100000-0000-4000-8000-000000000001"}',true);
select ok(apticket.can_upload_apticket_object('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/fixture.pdf'),'staff can authorize a visible own ticket');
select ok(not apticket.can_upload_apticket_object('ticket-attachments','ae100000-0000-4000-8000-000000000002/ae300000-0000-4000-8000-000000000002/fixture.pdf'),'foreign namespace denied');
select ok(not apticket.can_upload_apticket_object('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000002/fixture.pdf'),'foreign ticket under own namespace denied');
select ok(not apticket.can_upload_apticket_object('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/../fixture.pdf'),'traversal denied');
select ok(not apticket.can_upload_apticket_object('kb-attachments',null),'null path never authorizes a knowledge-base upload');
select ok(not apticket.can_upload_apticket_object('apticket-profile-avatars','ae100000-0000-4000-8000-000000000001/ae200000-0000-4000-8000-000000000001/avatar.png'),'avatars keep their dedicated server boundary');
select ok(apticket.can_upload_apticket_object('ticket-attachments','ae100000-0000-4000-8000-000000000001/_stickers/fixture.webp'),'gallery scope remains available through API');
select throws_ok($$select * from apticket_security_private.scanned_upload_permits$$,'42501',null,'receipts hidden from browser');
select throws_ok($$insert into storage.objects(bucket_id,name) values('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/raw.pdf')$$,'42501',null,'direct upload cannot bypass scanner');

reset role;
set local role service_role;
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/legacy.pdf','{"size":3,"mimetype":"application/pdf"}')$$,'42501',null,'legacy service-role producer also requires scanner receipt');
select throws_ok($$select apticket.create_scanned_upload_permit('ticket-attachments','invalid',3,repeat('a',64))$$,'23514',null,'permit validates canonical path');
select set_config('test.scan_receipt',apticket.create_scanned_upload_permit('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/scanned.pdf',3,repeat('a',64))::text,true);
-- Reproduce Storage v1.60.4's rolled-back caller-policy probe.
savepoint caller_probe;
insert into storage.objects(bucket_id,name,metadata,user_metadata) values
 ('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/scanned.pdf','{"contentLength":3,"mimetype":"application/pdf"}',jsonb_build_object('scan_id',current_setting('test.scan_receipt')));
rollback to caller_probe;
select is((select count(*) from apticket_security_private.scanned_upload_permits where id=current_setting('test.scan_receipt')::uuid),1::bigint,'permission probe does not consume the real receipt');
select lives_ok($$insert into storage.objects(bucket_id,name,metadata,user_metadata) values('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/scanned.pdf','{"size":3,"mimetype":"application/pdf","eTag":"fixture-etag"}',jsonb_build_object('scan_id',current_setting('test.scan_receipt')))$$,'final Storage write consumes a valid receipt');
select is((select count(*) from apticket_security_private.scanned_upload_permits where id=current_setting('test.scan_receipt')::uuid),0::bigint,'receipt is single use');
select throws_ok($$update storage.objects set metadata='{"size":4,"mimetype":"text/html","eTag":"new"}' where name like '%/scanned.pdf'$$,'42501',null,'unscanned content replacement denied');
select lives_ok($$update storage.objects set last_accessed_at=now() where name like '%/scanned.pdf'$$,'access metadata does not require rescanning unchanged bytes');
select set_config('test.bad_size_receipt',apticket.create_scanned_upload_permit('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/bad-size.pdf',3,repeat('b',64))::text,true);
select throws_ok($$insert into storage.objects(bucket_id,name,metadata,user_metadata) values('ticket-attachments','ae100000-0000-4000-8000-000000000001/ae300000-0000-4000-8000-000000000001/bad-size.pdf','{"size":4}',jsonb_build_object('scan_id',current_setting('test.bad_size_receipt')))$$,'42501',null,'actual Storage size must match receipt');
select is((select count(*) from apticket_security_private.scanned_upload_permits where id=current_setting('test.bad_size_receipt')::uuid),1::bigint,'failed write atomically restores receipt');
select lives_ok($$select apticket.revoke_scanned_upload_permit(current_setting('test.bad_size_receipt')::uuid)$$,'failed upload can revoke its receipt');
select is((select count(*) from apticket_security_private.scanned_upload_permits where id=current_setting('test.bad_size_receipt')::uuid),0::bigint,'receipt revocation removes capability');
select lives_ok($$insert into storage.objects(bucket_id,name) values('scan-test-other-app','fixture.txt')$$,'other applications keep their Storage behavior');
reset role;
select * from finish();
rollback;
