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

insert into storage.objects(bucket_id,name) select 'ticket-attachments','a9100000-0000-4000-8000-000000000001/'||p
from unnest(array['whatsapp-inbound/legacy.pdf','pending/ambiguous.pdf','a9500000-0000-4000-8000-000000000001/mixed.pdf']) p;
insert into apticket.messages(tenant_id,ticket_id,author_type,content,is_internal,attachments)
select 'a9100000-0000-4000-8000-000000000001',ticket::uuid,'contact','Legacy synthetic fixture',internal,
 jsonb_build_array(jsonb_build_object('path','a9100000-0000-4000-8000-000000000001/'||path))
from (values
 ('a9500000-0000-4000-8000-000000000001','whatsapp-inbound/legacy.pdf',false),
 ('a9500000-0000-4000-8000-000000000001','pending/ambiguous.pdf',false),
 ('a9500000-0000-4000-8000-000000000002','pending/ambiguous.pdf',false),
 ('a9500000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001/mixed.pdf',false),
 ('a9500000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001/mixed.pdf',true)) v(ticket,path,internal);
