create table apticket_security_private.ticket_attachment_bindings (
  tenant_id uuid not null references apticket.tenants(id),
  ticket_id uuid not null references apticket.tickets(id) on delete cascade,
  object_id uuid not null references storage.objects(id) on delete cascade,
  object_path text not null,
  public_readable boolean not null,
  primary key (tenant_id,ticket_id,object_path)
);
alter table apticket_security_private.ticket_attachment_bindings owner to postgres;
alter table apticket_security_private.ticket_attachment_bindings enable row level security;
revoke all on apticket_security_private.ticket_attachment_bindings from public,anon,authenticated,service_role;
grant select on apticket_security_private.ticket_attachment_bindings to service_role;
grant usage on schema storage to postgres;
grant select on storage.objects,apticket.tickets,apticket.messages,apticket.stickers,
  apticket.email_pending_messages,apticket.whatsapp_pending_messages to postgres;

-- Existing unambiguous legacy references retain their association. Ambiguous
-- legacy paths receive no portal capability and need explicit ownership review.
with refs as (
  select m.tenant_id,m.ticket_id,a->>'path' path,bool_and(not m.is_internal) public_readable
  from apticket.messages m cross join lateral jsonb_array_elements(
    case when jsonb_typeof(m.attachments)='array' then m.attachments else '[]'::jsonb end) a
  where jsonb_typeof(a->'path')='string'
  group by m.tenant_id,m.ticket_id,a->>'path'
), owners as (select tenant_id,path,count(*) tickets from refs group by 1,2)
insert into apticket_security_private.ticket_attachment_bindings
select r.tenant_id,r.ticket_id,o.id,r.path,r.public_readable
from refs r join owners own using(tenant_id,path)
join storage.objects o on o.bucket_id='ticket-attachments' and o.name=r.path
where r.path like r.tenant_id::text||'/%' and r.path !~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]'
and (r.path like r.tenant_id::text||'/'||r.ticket_id::text||'/%'
  or (own.tickets=1 and split_part(r.path,'/',2) in ('pending','whatsapp-inbound'))
  or exists(select 1 from apticket.stickers s where s.tenant_id=r.tenant_id
    and s.storage_path=r.path and r.path like r.tenant_id::text||'/_stickers/%'));

create function apticket_security_private.protect_attachment_binding()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare attachment jsonb; key text; object_uuid uuid; bound boolean; owner_contact uuid; gallery boolean;
begin
  if tg_op='UPDATE' then
    if row(new.id,new.tenant_id,new.attachments) is distinct from row(old.id,old.tenant_id,old.attachments)
       or (tg_table_name='messages' and to_jsonb(new)->>'ticket_id' is distinct from to_jsonb(old)->>'ticket_id')
       or (tg_table_name<>'messages' and to_jsonb(new)->>'contact_id' is distinct from to_jsonb(old)->>'contact_id') then
      raise insufficient_privilege using message='Attachment identity is immutable';
    end if;
    if tg_table_name='messages' then
      if old.is_internal and not new.is_internal and exists(
        select 1 from apticket_security_private.ticket_attachment_bindings b where b.tenant_id=new.tenant_id
          and b.ticket_id=new.ticket_id and not b.public_readable
          and exists(select 1 from jsonb_array_elements(coalesce(new.attachments,'[]')) a where a->>'path'=b.object_path)
      ) then raise insufficient_privilege using message='Private attachments cannot be published'; end if;
    end if;
    return new;
  end if;
  if tg_table_name <> 'messages' then
    if current_setting('role') in ('authenticated','anon') then
      raise insufficient_privilege using message='Pending ingestion is server-managed';
    end if;
    return new;
  end if;
  if new.attachments is null then return new; end if;
  if jsonb_typeof(new.attachments)<>'array' then
    raise check_violation using message='Attachments must be an array';
  end if;
  select contact_id into owner_contact from apticket.tickets where id=new.ticket_id and tenant_id=new.tenant_id;
  for attachment in select value from jsonb_array_elements(new.attachments) loop
    key:=attachment->>'path';
    -- Structured contact/location cards and externally hosted media have no
    -- Storage key and never gain a privileged Storage signature through this RPC.
    if key is null or key='' then continue; end if;
    if key not like new.tenant_id::text||'/%' or length(key)>1024
       or key ~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]' or key like '%//%' then
      raise insufficient_privilege using message='Invalid attachment scope';
    end if;
    select id into object_uuid from storage.objects where bucket_id='ticket-attachments' and name=key;
    if object_uuid is null then raise foreign_key_violation using message='Attachment object does not exist'; end if;
    select public_readable into bound from apticket_security_private.ticket_attachment_bindings
      where tenant_id=new.tenant_id and ticket_id=new.ticket_id and object_path=key;
    if found then
      if not new.is_internal and not bound then
        raise insufficient_privilege using message='Private attachments cannot be published';
      end if;
      continue;
    end if;
    gallery:=key like new.tenant_id::text||'/_stickers/%' and exists(
      select 1 from apticket.stickers where tenant_id=new.tenant_id and storage_path=key);
    if not gallery and exists(select 1 from apticket_security_private.ticket_attachment_bindings
      where tenant_id=new.tenant_id and object_path=key and ticket_id<>new.ticket_id) then
      raise insufficient_privilege using message='Attachment belongs to another ticket';
    end if;
    if key not like new.tenant_id::text||'/'||new.ticket_id::text||'/%' and not gallery and not exists(
      select 1 from apticket.email_pending_messages p where p.tenant_id=new.tenant_id
        and p.contact_id=owner_contact and key like new.tenant_id::text||'/pending/'||p.id::text||'/%'
        and exists(select 1 from jsonb_array_elements(coalesce(p.attachments,'[]')) a where a->>'path'=key)
    ) then raise insufficient_privilege using message='Attachment has no trusted ticket source'; end if;
    if not new.is_internal and exists(select 1 from apticket.messages m where m.tenant_id=new.tenant_id
      and m.ticket_id=new.ticket_id and m.is_internal and exists(
        select 1 from jsonb_array_elements(coalesce(m.attachments,'[]')) a where a->>'path'=key)) then
      raise insufficient_privilege using message='Private attachments cannot be published';
    end if;
    insert into apticket_security_private.ticket_attachment_bindings
      values(new.tenant_id,new.ticket_id,object_uuid,key,not new.is_internal) on conflict do nothing;
    select public_readable into bound from apticket_security_private.ticket_attachment_bindings
      where tenant_id=new.tenant_id and ticket_id=new.ticket_id and object_path=key;
    if not new.is_internal and not bound then
      raise insufficient_privilege using message='Private attachments cannot be published';
    end if;
  end loop;
  return new;
end;
$$;
alter function apticket_security_private.protect_attachment_binding() owner to postgres;
revoke all on function apticket_security_private.protect_attachment_binding() from public,anon,authenticated,service_role;
create trigger immutable_attachment_binding before insert or update on apticket.messages
  for each row execute function apticket_security_private.protect_attachment_binding();
create trigger immutable_attachment_binding before insert or update on apticket.email_pending_messages
  for each row execute function apticket_security_private.protect_attachment_binding();
create trigger immutable_attachment_binding before insert or update on apticket.whatsapp_pending_messages
  for each row execute function apticket_security_private.protect_attachment_binding();

create function apticket_security_private.protect_bound_storage_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if row(new.id,new.bucket_id,new.name) is distinct from row(old.id,old.bucket_id,old.name)
    and (old.bucket_id='ticket-attachments' or new.bucket_id='ticket-attachments') then
    raise insufficient_privilege using message='Bound attachment object identity is immutable';
  end if;
  return new;
end;
$$;
alter function apticket_security_private.protect_bound_storage_identity() owner to postgres;
revoke all on function apticket_security_private.protect_bound_storage_identity() from public,anon,authenticated,service_role;
create trigger apticket_bound_attachment_identity before update on storage.objects
  for each row execute function apticket_security_private.protect_bound_storage_identity();

create function apticket.can_sign_ticket_attachment(_tenant_id uuid,_ticket_id uuid,_contact_id uuid,_path text)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists(select 1 from apticket_security_private.ticket_attachment_bindings b
    join apticket.tickets t on t.id=b.ticket_id and t.tenant_id=b.tenant_id
    join storage.objects o on o.id=b.object_id and o.bucket_id='ticket-attachments' and o.name=b.object_path
    where b.tenant_id=_tenant_id and b.ticket_id=_ticket_id and b.object_path=_path
      and b.public_readable and t.contact_id=_contact_id and exists(
        select 1 from apticket.messages m where m.ticket_id=t.id and m.tenant_id=t.tenant_id and not m.is_internal
          and exists(select 1 from jsonb_array_elements(coalesce(m.attachments,'[]')) a where a->>'path'=_path)));
$$;
alter function apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text) owner to postgres;
revoke all on function apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function apticket.can_sign_ticket_attachment(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
