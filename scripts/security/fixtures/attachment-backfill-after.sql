
set local search_path=extensions,public,apticket,pg_catalog;
select plan(4);
select is((select count(*) from apticket_security_private.ticket_attachment_bindings where object_path like '%/whatsapp-inbound/legacy.pdf'),1::bigint,'unique legacy path retains its ticket binding');
select is((select count(*) from apticket_security_private.ticket_attachment_bindings where object_path like '%/pending/ambiguous.pdf'),0::bigint,'ambiguous legacy references gain no binding');
select ok(not (select public_readable from apticket_security_private.ticket_attachment_bindings where object_path like '%/mixed.pdf'),'mixed public and private references remain private');
set local role service_role;
select ok(apticket.can_sign_ticket_attachment('a9100000-0000-4000-8000-000000000001','a9500000-0000-4000-8000-000000000001','a9400000-0000-4000-8000-000000000001','a9100000-0000-4000-8000-000000000001/whatsapp-inbound/legacy.pdf'),'authorized legacy contact remains compatible');
reset role;
select * from finish();
