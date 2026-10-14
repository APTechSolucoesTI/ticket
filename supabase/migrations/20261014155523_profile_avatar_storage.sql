-- Private profile photos. Uploads/replacements/deletions are handled by the
-- authenticated server functions, which derive tenant/user from the session.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('apticket-profile-avatars','apticket-profile-avatars',false,2097152,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists apticket_profile_avatar_read on storage.objects;
create policy apticket_profile_avatar_read on storage.objects for select to authenticated
using (
  bucket_id='apticket-profile-avatars'
  and (storage.foldername(name))[1]=(select apticket.current_tenant_id())::text
  and (storage.foldername(name))[2]=(select auth.uid())::text
  and exists (
    select 1 from apticket.profiles profile
    where profile.id=(select auth.uid()) and profile.tenant_id=(select apticket.current_tenant_id())
      and profile.is_active
  )
);

-- Other apps share storage.objects. Restrictive policies also enforce isolation
-- if an older app has broader permissive policies on the same table.
drop policy if exists apticket_profile_avatar_scope on storage.objects;
create policy apticket_profile_avatar_scope on storage.objects as restrictive
for select to authenticated using (
  bucket_id<>'apticket-profile-avatars' or (
    (storage.foldername(name))[1]=(select apticket.current_tenant_id())::text
    and (storage.foldername(name))[2]=(select auth.uid())::text
    and exists(select 1 from apticket.profiles profile where profile.id=(select auth.uid())
      and profile.tenant_id=(select apticket.current_tenant_id()) and profile.is_active)
  )
);
drop policy if exists apticket_profile_avatar_anon_read on storage.objects;
create policy apticket_profile_avatar_anon_read on storage.objects as restrictive
for select to anon using (bucket_id<>'apticket-profile-avatars');
drop policy if exists apticket_profile_avatar_server_insert on storage.objects;
create policy apticket_profile_avatar_server_insert on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id<>'apticket-profile-avatars');
drop policy if exists apticket_profile_avatar_server_update on storage.objects;
create policy apticket_profile_avatar_server_update on storage.objects as restrictive
for update to anon,authenticated using (bucket_id<>'apticket-profile-avatars')
with check (bucket_id<>'apticket-profile-avatars');
drop policy if exists apticket_profile_avatar_server_delete on storage.objects;
create policy apticket_profile_avatar_server_delete on storage.objects as restrictive
for delete to anon,authenticated using (bucket_id<>'apticket-profile-avatars');

comment on column apticket.profiles.avatar_url is
  'URL HTTPS legada ou caminho privado tenant_id/profile_id/uuid.ext no bucket apticket-profile-avatars. URLs assinadas são geradas somente no servidor.';
notify pgrst,'reload schema';
