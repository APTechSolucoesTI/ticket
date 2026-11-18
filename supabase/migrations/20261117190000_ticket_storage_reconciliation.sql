begin;
set local lock_timeout='5s';
create table apticket_security_private.ticket_storage_cleanup_claims(
 object_path text not null,object_id uuid primary key,tenant_id uuid not null,
 claimed_at timestamptz not null default clock_timestamp()
);
alter table apticket_security_private.ticket_storage_cleanup_claims owner to postgres;
-- Hash lookup avoids B-tree key size failures for valid multibyte paths.
-- Advisory locking serializes creation of each path; only the claim function writes.
create index ticket_storage_cleanup_path_lookup on apticket_security_private.ticket_storage_cleanup_claims using hash(object_path);
alter table apticket_security_private.ticket_storage_cleanup_claims enable row level security;
revoke all on apticket_security_private.ticket_storage_cleanup_claims from public,anon,authenticated,service_role;
grant usage on schema apticket,apticket_security_private,storage to postgres;
grant select on storage.objects,apticket.messages,apticket.email_pending_messages,apticket.whatsapp_pending_messages,
 apticket.stickers,apticket_security_private.ticket_attachment_bindings,apticket_security_private.scanned_upload_permits to postgres;

create function apticket_security_private.ticket_attachment_paths(_attachments jsonb)
returns setof text language sql immutable set search_path=pg_catalog as $$
 select distinct v #>> '{}' from (
  select jsonb_path_query(coalesce(_attachments,'null'::jsonb),'$.**.path') v
  union all select jsonb_path_query(coalesce(_attachments,'null'::jsonb),'$.**.storage_path')
 ) paths where jsonb_typeof(v)='string' and v #>> '{}'<>'';
$$;
alter function apticket_security_private.ticket_attachment_paths(jsonb) owner to postgres;
revoke all on function apticket_security_private.ticket_attachment_paths(jsonb) from public,anon,authenticated,service_role;

create function apticket_security_private.ticket_object_referenced(_id uuid,_path text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from apticket_security_private.ticket_attachment_bindings where object_id=_id or object_path=_path)
 or exists(select 1 from apticket.stickers where storage_path=_path)
 or exists(select 1 from apticket.messages m where exists(select 1 from apticket_security_private.ticket_attachment_paths(m.attachments) p where p=_path))
 or exists(select 1 from apticket.email_pending_messages m where exists(select 1 from apticket_security_private.ticket_attachment_paths(m.attachments) p where p=_path))
 or exists(select 1 from apticket.whatsapp_pending_messages m where exists(select 1 from apticket_security_private.ticket_attachment_paths(m.attachments) p where p=_path))
 or exists(select 1 from apticket_security_private.scanned_upload_permits where bucket_id='ticket-attachments' and object_path=_path and expires_at>statement_timestamp());
$$;
alter function apticket_security_private.ticket_object_referenced(uuid,text) owner to postgres;
revoke all on function apticket_security_private.ticket_object_referenced(uuid,text) from public,anon,authenticated,service_role;

create function apticket.audit_ticket_storage(_tenant uuid,_after text default null,_days integer default 30,_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 if _tenant is null or _days is null or _days not between 7 and 3650 or _limit is null or _limit not between 1 and 500
  or (_after is not null and split_part(_after,'/',1)<>_tenant::text) then
  raise invalid_parameter_value using message='storage_audit_invalid'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'path',o.name,'createdAt',o.created_at,'updatedAt',o.updated_at,
  'state',case
   when o.name !~ ('^'||_tenant::text||'/.' ) or o.name ~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]' or o.name like '%//%' or length(o.name)>1024 then 'invalid'
   when apticket_security_private.ticket_object_referenced(o.id,o.name) then 'referenced'
   when o.created_at is null or o.updated_at is null or greatest(o.created_at,o.updated_at)>statement_timestamp()-make_interval(days=>_days) then 'recent'
   else 'candidate' end) order by o.name collate "C"),'[]'::jsonb) into result
 from (select id,name,created_at,updated_at from storage.objects where bucket_id='ticket-attachments'
  and split_part(name,'/',1)=_tenant::text and (_after is null or name collate "C">_after collate "C")
  order by name collate "C" limit _limit) o;
 return result;
end $$;
alter function apticket.audit_ticket_storage(uuid,text,integer,integer) owner to postgres;
revoke all on function apticket.audit_ticket_storage(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function apticket.audit_ticket_storage(uuid,text,integer,integer) to service_role;

-- Every writer of canonical ticket attachment references uses the same lock as
-- claims. Locks are acquired in C order to avoid reverse-array deadlocks.
create function apticket_security_private.guard_ticket_cleanup_path(_path text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if _path is null or _path='' then return; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise insufficient_privilege using message='storage_requires_read_committed'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ticket-attachments/'||_path,0));
 if exists(select 1 from apticket_security_private.ticket_storage_cleanup_claims where object_path=_path) then
  raise insufficient_privilege using message='storage_path_retired'; end if;
end $$;
alter function apticket_security_private.guard_ticket_cleanup_path(text) owner to postgres;
revoke all on function apticket_security_private.guard_ticket_cleanup_path(text) from public,anon,authenticated,service_role;

create function apticket_security_private.guard_ticket_cleanup_reference()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare key text;
begin
 if tg_table_schema='storage' then
  if new.bucket_id='ticket-attachments' then perform apticket_security_private.guard_ticket_cleanup_path(new.name); end if;
 elsif tg_table_name='stickers' then perform apticket_security_private.guard_ticket_cleanup_path(new.storage_path);
 else
  for key in select p from apticket_security_private.ticket_attachment_paths(new.attachments) p order by p collate "C" loop
   perform apticket_security_private.guard_ticket_cleanup_path(key);
  end loop;
 end if;
 return new;
end $$;
alter function apticket_security_private.guard_ticket_cleanup_reference() owner to postgres;
revoke all on function apticket_security_private.guard_ticket_cleanup_reference() from public,anon,authenticated,service_role;
create trigger aa_guard_ticket_cleanup before insert or update on storage.objects for each row execute function apticket_security_private.guard_ticket_cleanup_reference();
create trigger aa_guard_ticket_cleanup before insert or update on apticket.messages for each row execute function apticket_security_private.guard_ticket_cleanup_reference();
create trigger aa_guard_ticket_cleanup before insert or update on apticket.email_pending_messages for each row execute function apticket_security_private.guard_ticket_cleanup_reference();
create trigger aa_guard_ticket_cleanup before insert or update on apticket.whatsapp_pending_messages for each row execute function apticket_security_private.guard_ticket_cleanup_reference();
create trigger aa_guard_ticket_cleanup before insert or update on apticket.stickers for each row execute function apticket_security_private.guard_ticket_cleanup_reference();

create function apticket.claim_ticket_storage_orphan(_tenant uuid,_id uuid,_days integer default 30)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare object record; claim record;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise insufficient_privilege using message='storage_requires_read_committed'; end if;
 if _tenant is null or _id is null or _days is null or _days not between 7 and 3650 then
  raise invalid_parameter_value using message='storage_claim_invalid'; end if;
 select id,name,created_at,updated_at into object from storage.objects
  where bucket_id='ticket-attachments' and id=_id and split_part(name,'/',1)=_tenant::text;
 if not found then return jsonb_build_object('state','missing'); end if;
 perform pg_advisory_xact_lock(hashtextextended('ticket-attachments/'||object.name,0));
 -- A fresh command snapshot after acquiring the lock observes a reference that
 -- committed while this claim waited. This function must remain VOLATILE.
 select id,name,created_at,updated_at into object from storage.objects
  where bucket_id='ticket-attachments' and id=_id and split_part(name,'/',1)=_tenant::text;
 if not found then return jsonb_build_object('state','missing'); end if;
 select * into claim from apticket_security_private.ticket_storage_cleanup_claims where object_path=object.name;
 if found then
  if claim.object_id<>_id or claim.tenant_id<>_tenant then return jsonb_build_object('state','protected'); end if;
 else
  if object.name !~ ('^'||_tenant::text||'/.' ) or length(object.name)>1024 or object.name ~ '(^|/)[.][.]?(/|$)|[[:cntrl:]%?#\\]' or object.name like '%//%'
   or object.created_at is null or object.updated_at is null
   or greatest(object.created_at,object.updated_at)>statement_timestamp()-make_interval(days=>_days)
   or apticket_security_private.ticket_object_referenced(_id,object.name) then return jsonb_build_object('state','protected'); end if;
  insert into apticket_security_private.ticket_storage_cleanup_claims(object_path,object_id,tenant_id) values(object.name,_id,_tenant);
 end if;
 return jsonb_build_object('state','claimed','id',_id,'path',object.name,'bucket','ticket-attachments');
end $$;
alter function apticket.claim_ticket_storage_orphan(uuid,uuid,integer) owner to postgres;
revoke all on function apticket.claim_ticket_storage_orphan(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function apticket.claim_ticket_storage_orphan(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;
