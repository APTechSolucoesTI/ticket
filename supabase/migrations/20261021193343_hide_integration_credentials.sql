-- Snapshot grants only, never credential values. Coordinate app deployment first.
create table apticket_security_private.integration_acl_snapshot as
select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
where table_schema='apticket' and table_name in ('tenants','outbound_channels')
  and grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('SELECT','INSERT','UPDATE');
alter table apticket_security_private.integration_acl_snapshot owner to postgres;
alter table apticket_security_private.integration_acl_snapshot enable row level security;
revoke all on apticket_security_private.integration_acl_snapshot from public, anon, authenticated, service_role;

do $$
declare tbl text; actor text; verb text; allowed text; secrets text;
begin
  foreach tbl in array array['tenants','outbound_channels'] loop
    select string_agg(quote_ident(attname),',') into secrets from pg_attribute
      where attrelid=format('apticket.%I',tbl)::regclass and attnum>0 and not attisdropped
      and attname in ('whatsapp_uazapi_token','email_imap_password','whatsapp_webhook_secret','access_token');
    foreach actor in array array['anon','authenticated'] loop
      foreach verb in array array['SELECT','INSERT','UPDATE'] loop
        select string_agg(quote_ident(attname),',') into allowed from pg_attribute
          where attrelid=format('apticket.%I',tbl)::regclass and attnum>0 and not attisdropped
          and attname not in ('whatsapp_uazapi_token','email_imap_password','whatsapp_webhook_secret','access_token')
          and has_column_privilege(actor, attrelid, attname, verb);
        execute format('revoke %s on apticket.%I from %I',verb,tbl,actor);
        execute format('revoke %s (%s) on apticket.%I from %I',verb,secrets,tbl,actor);
        if allowed is not null then
          execute format('grant %s (%s) on apticket.%I to %I',verb,allowed,tbl,actor);
        end if;
      end loop;
    end loop;
    execute format('revoke select,insert,update on apticket.%I from public',tbl);
    execute format('revoke select (%s),insert (%s),update (%s) on apticket.%I from public',secrets,secrets,secrets,tbl);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
