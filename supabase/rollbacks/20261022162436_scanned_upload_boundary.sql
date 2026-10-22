-- Coordinate clients/API rollback before reopening direct Storage uploads.
drop function apticket.can_upload_apticket_object(text,text);
drop function apticket.create_scanned_upload_permit(text,text,bigint,text);
drop function apticket.revoke_scanned_upload_permit(uuid);
drop table apticket_security_private.scanned_upload_permits;
notify pgrst,'reload schema';
