-- Browsers must go through the authenticated scanner API. Other applications
-- sharing this Supabase keep their own buckets and policies unchanged.
create policy apticket_scanned_upload_insert on storage.objects as restrictive
for insert to authenticated,anon with check(bucket_id not in (
 'ticket-attachments','kb-attachments','client-documents','funcionario-documentos',
 'funcionario-beneficios','supplier-payment-receipts','supplier-payable-attachments','apticket-profile-avatars'));
create policy apticket_scanned_upload_update on storage.objects as restrictive
for update to authenticated,anon using(bucket_id not in (
 'ticket-attachments','kb-attachments','client-documents','funcionario-documentos',
 'funcionario-beneficios','supplier-payment-receipts','supplier-payable-attachments','apticket-profile-avatars'))
with check(bucket_id not in (
 'ticket-attachments','kb-attachments','client-documents','funcionario-documentos',
 'funcionario-beneficios','supplier-payment-receipts','supplier-payable-attachments','apticket-profile-avatars'));

-- Service producers must also present a short-lived scan receipt. This closes
-- forgotten/legacy service-role upload paths, not just browser SDK uploads.
create function apticket_security_private.require_scanned_object()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare receipt uuid; expected bigint;
begin
 if new.bucket_id not in ('ticket-attachments','kb-attachments','client-documents','funcionario-documentos','funcionario-beneficios','supplier-payment-receipts','supplier-payable-attachments','apticket-profile-avatars') then return new; end if;
 -- A database administrator can seed metadata or restore a backup directly.
 -- Storage requests retain their authenticated/service/storage-admin role.
 if session_user='supabase_admin' and current_setting('role')='none' then return new; end if;
 if tg_op='UPDATE' then
  if row(new.id,new.bucket_id,new.name,new.metadata->>'eTag',new.metadata->>'size',new.metadata->>'mimetype')
   is not distinct from row(old.id,old.bucket_id,old.name,old.metadata->>'eTag',old.metadata->>'size',old.metadata->>'mimetype') then return new; end if;
 end if;
 if current_setting('role') in ('anon','authenticated') then
  raise insufficient_privilege using message='Uploads require the file security service';
 end if;
 -- Storage performs a rolled-back permissions probe before transferring bytes.
 -- The final metadata write must provide and atomically consume the receipt.
 if new.metadata is null then
  if not exists(select 1 from apticket_security_private.scanned_upload_permits
    where bucket_id=new.bucket_id and object_path=new.name and expires_at>clock_timestamp()) then
   raise insufficient_privilege using message='Scanned upload receipt required';
  end if;
  return new;
 end if;
 begin receipt:=(new.user_metadata->>'scan_id')::uuid;
 exception when invalid_text_representation then receipt:=null; end;
 delete from apticket_security_private.scanned_upload_permits where id=receipt and bucket_id=new.bucket_id
   and object_path=new.name and expires_at>clock_timestamp() returning byte_length into expected;
 if expected is null or coalesce(new.metadata->>'size',new.metadata->>'contentLength','')<>expected::text then
  raise insufficient_privilege using message='Valid scanned upload receipt required';
 end if;
 return new;
end $$;
alter function apticket_security_private.require_scanned_object() owner to postgres;
revoke all on function apticket_security_private.require_scanned_object() from public,anon,authenticated,service_role;
create trigger apticket_require_scanned_object before insert or update on storage.objects
 for each row execute function apticket_security_private.require_scanned_object();

