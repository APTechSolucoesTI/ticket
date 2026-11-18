begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,apticket,pg_catalog;
set local plpgsql.check_asserts=on;
select no_plan();
-- All fixture writes are synthetic, rolled back and independent of domain triggers.
set local session_replication_role=replica;
insert into storage.buckets(id,name) values('ticket-attachments','ticket-attachments') on conflict do nothing;
insert into apticket.tenants(id,name,slug) values('bf100000-0000-4000-8000-000000000001','Storage reconciliation fixture','storage-reconciliation-fixture');
insert into storage.objects(id,bucket_id,name,created_at,updated_at)
select ('bf200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ticket-attachments',
 'bf100000-0000-4000-8000-000000000001/pending/object-'||n||'.pdf',
 now()-interval '40 days',now()-case when n=2 then interval '1 day' else interval '40 days' end
from generate_series(1,7) n;
insert into apticket.email_pending_messages(tenant_id,from_email,content,attachments)
values('bf100000-0000-4000-8000-000000000001','fixture@example.test','Referenced',
 '[{"path":"bf100000-0000-4000-8000-000000000001/pending/object-3.pdf"}]');
insert into apticket.whatsapp_pending_messages(tenant_id,phone,content,attachments)
values('bf100000-0000-4000-8000-000000000001','5500000000000','Legacy referenced',
 '[{"storage_path":"bf100000-0000-4000-8000-000000000001/pending/object-4.pdf"}]');
insert into apticket.stickers(tenant_id,name,storage_path)
values('bf100000-0000-4000-8000-000000000001','Protected sticker','bf100000-0000-4000-8000-000000000001/pending/object-5.pdf');
insert into apticket_security_private.scanned_upload_permits(bucket_id,object_path,byte_length,sha256,expires_at)
values('ticket-attachments','bf100000-0000-4000-8000-000000000001/pending/object-6.pdf',1,repeat('a',64),now()+interval '1 hour');
set local session_replication_role=origin;
set local role service_role;
do $test$
declare page jsonb; claim jsonb;
begin
 page:=apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001',null,30,100);
 assert jsonb_array_length(page)=7;
 assert (select x->>'state' from jsonb_array_elements(page) x where x->>'path' like '%object-1.pdf')='candidate';
 assert (select x->>'state' from jsonb_array_elements(page) x where x->>'path' like '%object-2.pdf')='recent';
 assert not exists(select 1 from jsonb_array_elements(page) x where x->>'path' ~ 'object-[3-6][.]pdf$' and x->>'state'<>'referenced');
 assert jsonb_array_length(apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001',null,30,2))=2;
 assert jsonb_array_length(apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001/pending/object-6.pdf',30,2))=1;
 claim:=apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000001',30);
 assert claim->>'state'='claimed';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000001',30)=claim, 'claim retry is idempotent';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000003',30)->>'state'='protected';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000002',30)->>'state'='protected';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000002','bf200000-0000-4000-8000-000000000007',30)->>'state'='missing';
 begin perform apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001',null,1,100); raise exception 'unsafe retention accepted'; exception when invalid_parameter_value then null; end;
end $test$;
reset role;
select pass('audit preserves references, recent objects, scope, cursor and idempotent claims');
set local session_replication_role=replica;
insert into apticket.tickets(id,tenant_id,number,subject) values('bf400000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001',-880001,'Reconciliation reference fixture');
insert into apticket_security_private.ticket_attachment_bindings(tenant_id,ticket_id,object_id,object_path,public_readable)
values('bf100000-0000-4000-8000-000000000001','bf400000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000007','bf100000-0000-4000-8000-000000000001/pending/object-7.pdf',false);
insert into storage.objects(id,bucket_id,name,created_at,updated_at) values
 ('bf200000-0000-4000-8000-000000000008','ticket-attachments','bf100000-0000-4000-8000-000000000001/pending/object-8.pdf',now()-interval '40 days',now()-interval '40 days'),
 ('bf200000-0000-4000-8000-000000000009','ticket-attachments','bf100000-0000-4000-8000-000000000001/'||repeat('x',1100),now()-interval '40 days',now()-interval '40 days'),
 ('bf200000-0000-4000-8000-000000000010','ticket-attachments','bf100000-0000-4000-8000-000000000001',now()-interval '40 days',now()-interval '40 days'),
 ('bf200000-0000-4000-8000-000000000011','ticket-attachments','bf100000-0000-4000-8000-000000000001/'||repeat('😀',600),now()-interval '40 days',now()-interval '40 days'),
 ('bf200000-0000-4000-8000-000000000012','ticket-attachments','bf100000-0000-4000-8000-000000000001/'||repeat('漢',970),now()-interval '40 days',now()-interval '40 days');
insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments)
values('bf100000-0000-4000-8000-000000000001','bf400000-0000-4000-8000-000000000001','system','Legacy message reference','[{"storage_path":"bf100000-0000-4000-8000-000000000001/pending/object-8.pdf"}]');
set local session_replication_role=origin;
set local role service_role;
do $test$ begin
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000007')->>'state'='protected', 'stale manifest cannot delete a newly bound object';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000008')->>'state'='protected', 'legacy message reference is protected';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000009')->>'state'='protected';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000010')->>'state'='protected';
 assert (select x->>'state' from jsonb_array_elements(apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001')) x where x->>'id'='bf200000-0000-4000-8000-000000000009')='invalid';
 assert jsonb_array_length(apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001/'||repeat('x',1100)))=2, 'cursor advances over invalid long names using C ordering';
 assert apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000012')->>'state'='claimed', 'long multibyte paths do not overflow index keys';
 assert apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000002')='[]'::jsonb;
end $test$;
reset role;
select pass('new bindings and legacy message references invalidate old candidates');
do $test$
begin
 begin
  insert into apticket.email_pending_messages(tenant_id,from_email,content,attachments) values('bf100000-0000-4000-8000-000000000001','fixture@example.test','Late reference','[{"path":"bf100000-0000-4000-8000-000000000001/pending/object-1.pdf"}]');
  raise exception 'late attachment accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into apticket.stickers(tenant_id,name,storage_path) values('bf100000-0000-4000-8000-000000000001','Late sticker','bf100000-0000-4000-8000-000000000001/pending/object-1.pdf');
  raise exception 'late sticker accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into apticket.whatsapp_pending_messages(tenant_id,phone,content,attachments) values('bf100000-0000-4000-8000-000000000001','5500000000000','Late legacy attachment','[{"storage_path":"bf100000-0000-4000-8000-000000000001/pending/object-1.pdf"}]');
  raise exception 'late legacy attachment accepted';
 exception when insufficient_privilege then null; end;
 begin
  insert into storage.objects(bucket_id,name) values('ticket-attachments','bf100000-0000-4000-8000-000000000001/pending/object-1.pdf');
  raise exception 'retired path recreated';
 exception when insufficient_privilege then null; end;
end $test$;
select pass('claims fence late references and stickers');
set local role authenticated;
do $test$ begin
 begin perform apticket.audit_ticket_storage('bf100000-0000-4000-8000-000000000001'); raise exception 'browser audit allowed'; exception when insufficient_privilege then null; end;
 begin perform apticket.claim_ticket_storage_orphan('bf100000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000007'); raise exception 'browser claim allowed'; exception when insufficient_privilege then null; end;
end $test$;
reset role;
select pass('browser roles cannot run reconciliation');
select * from finish();
rollback;
