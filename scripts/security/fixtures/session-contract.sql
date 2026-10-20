-- Minimal session contract for CI, not the full APTicket schema/RLS matrix.
-- Use only an empty disposable PostgreSQL database; no production data needed.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
create role postgres login nosuperuser bypassrls;
grant anon, authenticated, service_role to authenticator;
create schema extensions;
create extension pgtap with schema extensions;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid;
$$;
create schema apticket;
create table apticket.tenants(id uuid primary key, name text, slug text unique);
create table apticket.profiles(
  id uuid primary key, tenant_id uuid not null references apticket.tenants on delete cascade,
  name text, email text unique, password_hash text, is_active boolean not null default true
);
create table apticket.password_resets(
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references apticket.profiles on delete cascade,
  token_hash text unique not null, accepted_at timestamptz, expires_at timestamptz not null
);
create table apticket.invites(like apticket.password_resets including all);
alter table apticket.invites add foreign key (profile_id) references apticket.profiles on delete cascade;
create table apticket.contacts(
  id uuid primary key, tenant_id uuid not null references apticket.tenants on delete cascade,
  name text not null, email text
);
alter table apticket.contacts enable row level security;
create table apticket.portal_otp_codes(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references apticket.tenants on delete cascade,
  contact_id uuid not null references apticket.contacts on delete cascade, email text not null, code_hash text not null,
  expires_at timestamptz not null, attempts integer not null default 0,
  consumed_at timestamptz, created_at timestamptz not null default now()
);
alter table apticket.portal_otp_codes enable row level security;
create function apticket.current_tenant_id() returns uuid language sql stable security definer set search_path=pg_catalog as $$
  select p.tenant_id from apticket.profiles p where p.id = auth.uid() and p.is_active;
$$;
alter table apticket.tenants enable row level security;
alter table apticket.profiles enable row level security;
alter table apticket.password_resets enable row level security;
alter table apticket.invites enable row level security;
create policy tenant_scope on apticket.tenants to authenticated using(id=apticket.current_tenant_id()) with check(id=apticket.current_tenant_id());
create policy own_profile on apticket.profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text);
alter table storage.objects enable row level security;
grant usage on schema auth,apticket,storage,extensions to anon,authenticated,service_role;
grant execute on all functions in schema auth,extensions to anon,authenticated,service_role;
grant select,update on apticket.tenants to authenticated;
-- Match the production column grants; password_hash and new server fields hidden.
grant select(id,tenant_id,name,email,is_active),update(name,email) on apticket.profiles to authenticated;
grant select,insert,update,delete on storage.objects to authenticated,anon;
grant all on all tables in schema apticket,storage to service_role;
alter default privileges in schema apticket grant all on tables to service_role;
-- Match production's privilege boundary: mixed table ownership and a
-- non-superuser postgres runtime owner with RLS bypass for private lookups.
alter schema apticket owner to postgres;
alter table apticket.tenants owner to postgres;
alter table apticket.profiles owner to postgres;
alter table apticket.password_resets owner to postgres;
alter function apticket.current_tenant_id() owner to postgres;
grant all on all tables in schema apticket,storage to postgres;
grant usage on schema auth,storage,extensions to postgres;
