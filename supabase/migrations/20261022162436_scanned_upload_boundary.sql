-- Stage the RPC contract before deploying its clients. Enforce Storage writes
-- only after the API, web and Edge producers have migrated to the scanner.
create function apticket.can_upload_apticket_object(_bucket text,_path text)
returns boolean language plpgsql stable security invoker set search_path=pg_catalog as $$
declare tenant uuid:=apticket.current_tenant_id(); parts text[]:=string_to_array(_path,'/');
 uuid_pattern constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if auth.uid() is null or tenant is null or _path is null or _bucket is null or length(_path)>1024 or parts[1]<>tenant::text
  or array_length(parts,1)<3 or _path ~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]' or _path like '%//%' then return false; end if;
 if _bucket='ticket-attachments' then
  if not apticket.has_permission(auth.uid(),'tickets','edit') then return false; end if;
  if parts[2]='_stickers' then return true; end if;
  if parts[2] !~ uuid_pattern then return false; end if;
  return exists(select 1 from apticket.tickets where id=parts[2]::uuid and tenant_id=tenant);
 elsif _bucket='kb-attachments' then
  return apticket.has_permission(auth.uid(),'base_conhecimento','create') or apticket.has_permission(auth.uid(),'base_conhecimento','edit');
 elsif _bucket in ('funcionario-documentos','funcionario-beneficios') then
  if parts[2] !~ uuid_pattern or not apticket.has_permission(auth.uid(),'funcionarios','sensitive') then return false; end if;
  return exists(select 1 from apticket.funcionarios where id=parts[2]::uuid and tenant_id=tenant);
 elsif _bucket='client-documents' then
  if parts[2] !~ uuid_pattern or not apticket.has_permission(auth.uid(),'financeiro.disponibilizar_documentos','create') then return false; end if;
  return exists(select 1 from apticket.companies where id=parts[2]::uuid and tenant_id=tenant);
 elsif _bucket='supplier-payment-receipts' then
  if parts[2] !~ uuid_pattern or parts[3] !~ uuid_pattern then return false; end if;
  return apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit') and exists(
   select 1 from apticket.supplier_payments where id=parts[3]::uuid and tenant_id=tenant
    and operating_company_id=parts[2]::uuid and apticket.has_financial_scope(tenant,operating_company_id,true));
 elsif _bucket='supplier-payable-attachments' then
  if parts[2] !~ uuid_pattern or parts[3]<>auth.uid()::text then return false; end if;
  return apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit')
   and apticket.has_financial_scope(tenant,parts[2]::uuid,true);
 end if;
 -- Avatars retain their dedicated authenticated server function and cleanup.
 return false;
end $$;
alter function apticket.can_upload_apticket_object(text,text) owner to postgres;
revoke all on function apticket.can_upload_apticket_object(text,text) from public,anon,service_role;
grant execute on function apticket.can_upload_apticket_object(text,text) to authenticated;
notify pgrst,'reload schema';

create table apticket_security_private.scanned_upload_permits (
 id uuid primary key default gen_random_uuid(), bucket_id text not null, object_path text not null,
 byte_length bigint not null, sha256 text not null, expires_at timestamptz not null
);
alter table apticket_security_private.scanned_upload_permits owner to postgres;
alter table apticket_security_private.scanned_upload_permits enable row level security;
revoke all on apticket_security_private.scanned_upload_permits from public,anon,authenticated,service_role;
grant select,insert,delete on apticket_security_private.scanned_upload_permits to service_role;
create index scanned_upload_permits_lookup on apticket_security_private.scanned_upload_permits(bucket_id,object_path,expires_at);
create function apticket.create_scanned_upload_permit(_bucket text,_path text,_byte_length bigint,_sha256 text)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare permit uuid;
begin
 if _bucket is null or _bucket not in ('ticket-attachments','kb-attachments','client-documents','funcionario-documentos','funcionario-beneficios','supplier-payment-receipts','supplier-payable-attachments','apticket-profile-avatars')
  or _path is null or length(_path)>1024 or _path !~ '^[0-9a-f-]{36}/[^/]'
  or _path ~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]' or _path like '%//%'
  or _byte_length is null or _byte_length<1 or _byte_length>26214400 or _sha256 is null or _sha256 !~ '^[0-9a-f]{64}$' then
  raise check_violation using message='Invalid scanned upload permit';
 end if;
 delete from apticket_security_private.scanned_upload_permits where id in (
  select id from apticket_security_private.scanned_upload_permits where expires_at<now() limit 100);
 insert into apticket_security_private.scanned_upload_permits(bucket_id,object_path,byte_length,sha256,expires_at)
  values(_bucket,_path,_byte_length,_sha256,clock_timestamp()+interval '2 minutes') returning id into permit;
 return permit;
end $$;
alter function apticket.create_scanned_upload_permit(text,text,bigint,text) owner to postgres;
revoke all on function apticket.create_scanned_upload_permit(text,text,bigint,text) from public,anon,authenticated;
grant execute on function apticket.create_scanned_upload_permit(text,text,bigint,text) to service_role;
create function apticket.revoke_scanned_upload_permit(_id uuid) returns void language sql security invoker set search_path=pg_catalog as $$
 delete from apticket_security_private.scanned_upload_permits where id=_id;
$$;
alter function apticket.revoke_scanned_upload_permit(uuid) owner to postgres;
revoke all on function apticket.revoke_scanned_upload_permit(uuid) from public,anon,authenticated;
grant execute on function apticket.revoke_scanned_upload_permit(uuid) to service_role;
