begin;
drop function apticket.get_ticket_metrics(integer);
drop function apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text);
drop function apticket.ticket_search_text(text);
drop collation apticket.ticket_sort_pt_br;
notify pgrst,'reload schema';
commit;
