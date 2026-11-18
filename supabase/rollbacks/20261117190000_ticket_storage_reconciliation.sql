begin;
set local lock_timeout='5s';
-- Do not remove fencing while a delayed Storage API request could still delete
-- a path. Claims are permanent, including when the bytes were already removed.
lock table apticket_security_private.ticket_storage_cleanup_claims in access exclusive mode;
do $$ begin
 if exists(select 1 from apticket_security_private.ticket_storage_cleanup_claims) then
  raise check_violation using message='storage_cleanup_claims_require_operator_review'; end if;
end $$;
drop trigger aa_guard_ticket_cleanup on storage.objects;
drop trigger aa_guard_ticket_cleanup on apticket.messages;
drop trigger aa_guard_ticket_cleanup on apticket.email_pending_messages;
drop trigger aa_guard_ticket_cleanup on apticket.whatsapp_pending_messages;
drop trigger aa_guard_ticket_cleanup on apticket.stickers;
drop function apticket.audit_ticket_storage(uuid,text,integer,integer);
drop function apticket.claim_ticket_storage_orphan(uuid,uuid,integer);
drop function apticket_security_private.guard_ticket_cleanup_reference();
drop function apticket_security_private.guard_ticket_cleanup_path(text);
drop function apticket_security_private.ticket_object_referenced(uuid,text);
drop function apticket_security_private.ticket_attachment_paths(jsonb);
drop table apticket_security_private.ticket_storage_cleanup_claims;
notify pgrst,'reload schema';
commit;
