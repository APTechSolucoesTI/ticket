-- Reopens metadata-based attachment substitution. Coordinate application rollback.
drop function apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text);
drop trigger immutable_attachment_binding on apticket.messages;
drop trigger immutable_attachment_binding on apticket.email_pending_messages;
drop trigger immutable_attachment_binding on apticket.whatsapp_pending_messages;
drop trigger apticket_bound_attachment_identity on storage.objects;
drop function apticket_security_private.protect_bound_storage_identity();
drop function apticket_security_private.protect_attachment_binding();
drop table apticket_security_private.ticket_attachment_bindings;
notify pgrst,'reload schema';
