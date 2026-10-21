begin;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(22);
insert into apticket.tenants(id,name,slug) values
 ('a9100000-0000-4000-8000-000000000001','Attachment A','attachment-fixture-a'),
 ('a9100000-0000-4000-8000-000000000002','Attachment B','attachment-fixture-b');
insert into apticket.profiles(id,tenant_id,name,email) values
 ('a9200000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','Attachment agent','attachment-agent@example.test');
insert into apticket.companies(id,tenant_id,name) values
 ('a9300000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','Client A'),
 ('a9300000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000002','Client B');
insert into apticket.contacts(id,tenant_id,company_id,name,email) values
 ('a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001','Contact A','attachment-a@example.test'),
 ('a9400000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001','Contact A2','attachment-a2@example.test');
insert into apticket.tickets(id,tenant_id,company_id,contact_id,subject) values
 ('a9500000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','Attachment ticket 1'),
 ('a9500000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000001','a9300000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000002','Attachment ticket 2');
insert into storage.objects(bucket_id,name) values
 ('ticket-attachments','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'),
 ('ticket-attachments','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/private.pdf'),
 ('ticket-attachments','a9100000-0000-4000-8000-000000000001/pending/a9700000-0000-4000-8000-000000000001/mail.pdf'),
 ('ticket-attachments','a9100000-0000-4000-8000-000000000001/_stickers/fixture.png');
insert into apticket.stickers(tenant_id,name,storage_path) values('a9100000-0000-4000-8000-000000000001','Shared fixture','a9100000-0000-4000-8000-000000000001/_stickers/fixture.png');
select ok(not has_function_privilege('anon','apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text)','execute'),'anonymous cannot request a signing capability');
select ok(not has_function_privilege('authenticated','apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text)','execute'),'JWT alone cannot request a signing capability');
select ok((select relrowsecurity from pg_class where oid='apticket_security_private.ticket_attachment_bindings'::regclass),'binding table has RLS');
select ok(not (select rolsuper from pg_roles where oid=(select proowner from pg_proc where oid='apticket_security_private.protect_attachment_binding()'::regprocedure)),'trigger owner is not superuser');
create function pg_temp.can_sign(ticket uuid,contact uuid,path text) returns boolean language sql as $$
 select apticket.can_sign_ticket_attachment('a9100000-0000-4000-8000-000000000001',ticket,contact,path);
$$;
set local role service_role;
insert into apticket.messages(id,tenant_id,ticket_id,author_type,content,is_internal,attachments) values
 ('a9600000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','contact','Public fixture',false,'[{"path":"a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf"}]'),
 ('a9600000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','agent','Private fixture',true,'[{"path":"a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/private.pdf"}]');
select ok(pg_temp.can_sign('a9500000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'),'authorized public attachment');
select ok(not pg_temp.can_sign('a9500000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'),'another contact denied');
select ok(not pg_temp.can_sign('a9500000-0000-4000-8000-000000000002','a9400000-0000-4000-8000-000000000002','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'),'same tenant different ticket denied');
select ok(not apticket.can_sign_ticket_attachment('a9100000-0000-4000-8000-000000000002','a9500000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'),'foreign tenant denied');
select throws_ok($$insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments) values('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000002','contact','Substitution','[{"path":"a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf"}]')$$,'42501',null,'cross-ticket substitution denied');
select throws_ok($$update apticket.messages set attachments='[]' where id='a9600000-0000-4000-8000-000000000001'$$,'42501',null,'attachment identity cannot be rewritten');
select throws_ok($$update apticket.messages set ticket_id='a9500000-0000-4000-8000-000000000002' where id='a9600000-0000-4000-8000-000000000001'$$,'42501',null,'message cannot move ownership');
select ok(not pg_temp.can_sign('a9500000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/private.pdf'),'internal attachment never signed');
select throws_ok($$update apticket.messages set is_internal=false where id='a9600000-0000-4000-8000-000000000002'$$,'42501',null,'private attachment cannot become public');
select throws_ok($$insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments) values('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','contact','Publish private','[{"path":"a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/private.pdf"}]')$$,'42501',null,'copying private metadata to public message denied');
insert into apticket.email_pending_messages(id,tenant_id,contact_id,from_email,content,attachments)
values('a9700000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','fixture@example.test','Pending fixture','[{"path":"a9100000-0000-4000-8000-000000000001/pending/a9700000-0000-4000-8000-000000000001/mail.pdf"}]');
select lives_ok($$insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments) values('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','contact','Accepted pending','[{"path":"a9100000-0000-4000-8000-000000000001/pending/a9700000-0000-4000-8000-000000000001/mail.pdf"}]')$$,'trusted pending contact retains attachment');
select throws_ok($$insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments) values('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000002','contact','Wrong pending contact','[{"path":"a9100000-0000-4000-8000-000000000001/pending/a9700000-0000-4000-8000-000000000001/mail.pdf"}]')$$,'42501',null,'another contact cannot claim pending file');
select throws_ok($$update apticket.email_pending_messages set attachments='[]' where id='a9700000-0000-4000-8000-000000000001'$$,'42501',null,'pending source is immutable');
select throws_ok($$update apticket.email_pending_messages set contact_id='a9400000-0000-4000-8000-000000000002' where id='a9700000-0000-4000-8000-000000000001'$$,'42501',null,'pending file cannot move contact ownership');
select throws_ok($$update storage.objects set name='a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000002/moved.pdf' where name='a9100000-0000-4000-8000-000000000001/a9500000-0000-4000-8000-000000000001/public.pdf'$$,'42501',null,'storage rename cannot bypass ticket binding');
select lives_ok($$insert into apticket.messages(tenant_id,ticket_id,author_type,content,attachments) values
 ('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','contact','Shared sticker','[{"path":"a9100000-0000-4000-8000-000000000001/_stickers/fixture.png"}]'),
 ('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000002','contact','Shared sticker','[{"path":"a9100000-0000-4000-8000-000000000001/_stickers/fixture.png"}]')$$,'shared sticker gallery remains compatible');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"app":"apticket","role":"authenticated","sub":"a9200000-0000-4000-8000-000000000001","tenant_id":"a9100000-0000-4000-8000-000000000001"}',true);
select throws_ok($$insert into apticket.email_pending_messages(tenant_id,from_email,content) values('a9100000-0000-4000-8000-000000000001','forged@example.test','Forged pending source')$$,'42501',null,'user cannot forge trusted pending source');
select throws_ok($$select * from apticket_security_private.ticket_attachment_bindings$$,'42501',null,'binding table not exposed');
reset role;
select * from finish();
rollback;
