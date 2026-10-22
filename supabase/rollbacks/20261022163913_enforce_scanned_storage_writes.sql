-- Reopens the direct/service upload paths; use only for coordinated rollback.
drop trigger apticket_require_scanned_object on storage.objects;
drop function apticket_security_private.require_scanned_object();
drop policy apticket_scanned_upload_insert on storage.objects;
drop policy apticket_scanned_upload_update on storage.objects;
notify pgrst,'reload schema';
