-- Append only after the original domain assertions and before their ROLLBACK.
-- All seeded business rows are synthetic. Do not install this helper in production.
reset role;
select set_config('request.jwt.claims','{}',true);
create or replace function pg_temp.foreign_crud_matrix() returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tab record; source uuid; source_actor uuid; own_count bigint; foreign_count bigint;
 affected bigint; rows jsonb:='[]'; actors jsonb:='{}'; can_read boolean;
 outsider uuid:='ad100000-0000-4000-8000-000000000099';
 outsider_actor uuid:='ad200000-0000-4000-8000-000000000099';
begin
 insert into apticket.tenants(id,name,slug) values(outsider,'Foreign CRUD principal','appsec-foreign-crud');
 insert into apticket.profiles(id,tenant_id,name,email)
  values(outsider_actor,outsider,'Foreign CRUD admin','foreign-crud@example.test');
 insert into apticket.user_roles(user_id,tenant_id,role_id)
  select outsider_actor,tenant_id,id from apticket.roles where tenant_id=outsider and name='Admin';
 for tab in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='apticket' and c.relkind='r' and exists(select 1 from pg_attribute a
    where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped) order by c.relname loop
  execute format('select tenant_id from apticket.%I where tenant_id is not null and tenant_id<>%L limit 1',tab.relname,outsider) into source;
  if source is null then continue; end if;
  -- Give an active admin in the source tenant a valid current session as a
  -- positive control. This happens after the domain assertions have finished.
  source_actor:=(actors->>source::text)::uuid;
  if source_actor is null then
   source_actor:=gen_random_uuid();
   insert into apticket.profiles(id,tenant_id,name,email)
    values(source_actor,source,'Source CRUD admin',source_actor::text||'@example.test');
   insert into apticket.user_roles(user_id,tenant_id,role_id)
    select source_actor,tenant_id,id from apticket.roles where tenant_id=source and name='Admin';
   actors:=actors||jsonb_build_object(source::text,source_actor);
  end if;
  perform set_config('request.jwt.claims',jsonb_build_object('app','apticket','role','authenticated','sub',source_actor,'tenant_id',source)::text,true);
  perform set_config('role','authenticated',true);
  own_count:=0; can_read:=true;
  begin
    execute format('select count(*) from apticket.%I where tenant_id=%L',tab.relname,source) into own_count;
  exception when insufficient_privilege then can_read:=false;
  end;
  perform set_config('role','supabase_admin',true);
  perform set_config('request.jwt.claims',jsonb_build_object('app','apticket','role','authenticated','sub',outsider_actor,'tenant_id',outsider)::text,true);
  perform set_config('role','authenticated',true);
  begin
    execute format('select count(*) from apticket.%I where tenant_id=%L',tab.relname,source) into foreign_count;
    if foreign_count<>0 then raise exception 'Foreign SELECT leaked rows in %',tab.relname; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('update apticket.%I set tenant_id=tenant_id where tenant_id=%L',tab.relname,source);
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Foreign UPDATE affected rows in %',tab.relname; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('delete from apticket.%I where tenant_id=%L',tab.relname,source);
    get diagnostics affected=row_count;
    if affected<>0 then raise exception 'Foreign DELETE affected rows in %',tab.relname; end if;
  exception when insufficient_privilege then null;
  end;
  perform set_config('role','supabase_admin',true);
  rows:=rows||jsonb_build_array(jsonb_build_object('table',tab.relname,'own_visible',own_count,'client_read_granted',can_read));
 end loop;
 return rows;
end $$;
select 'APPSEC_CRUD_MATRIX:'||pg_temp.foreign_crud_matrix()::text;
