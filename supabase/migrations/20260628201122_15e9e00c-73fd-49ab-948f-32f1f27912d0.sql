
-- =============================================================
-- APTicket – initial multi-tenant schema
-- =============================================================

create extension if not exists "pgcrypto";

-- ----- ENUMS -----
create type public.app_role as enum ('admin','agent','requester');
create type public.ticket_status as enum ('new','in_progress','pending','resolved','closed');
create type public.ticket_priority as enum ('low','medium','high','urgent');
create type public.ticket_channel as enum ('email','whatsapp','chat','manual','portal');
create type public.contract_status as enum ('active','suspended','cancelled','expired');
create type public.kb_status as enum ('draft','published');
create type public.message_author_type as enum ('agent','contact','system');

-- ----- updated_at helper -----
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----- TENANTS -----
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tenants to authenticated;
grant all on public.tenants to service_role;
alter table public.tenants enable row level security;

-- ----- PROFILES -----
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  email text not null,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_tenant_idx on public.profiles(tenant_id);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

-- ----- USER ROLES -----
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, tenant_id, role)
);
create index user_roles_user_idx on public.user_roles(user_id);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

-- ----- SECURITY DEFINER HELPERS -----
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- ----- handle_new_user trigger (provision tenant + profile + admin role) -----
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_company text;
  v_name text;
  v_slug text;
begin
  v_company := coalesce(new.raw_user_meta_data->>'company_name', split_part(new.email,'@',1) || ' workspace');
  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1));
  v_slug := lower(regexp_replace(v_company,'[^a-zA-Z0-9]+','-','g')) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6);

  insert into public.tenants(name, slug) values (v_company, v_slug) returning id into v_tenant_id;
  insert into public.profiles(id, tenant_id, name, email) values (new.id, v_tenant_id, v_name, new.email);
  insert into public.user_roles(user_id, tenant_id, role) values (new.id, v_tenant_id, 'admin');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----- TENANTS policies -----
create policy "tenant members read tenant" on public.tenants
  for select to authenticated using (id = public.current_tenant_id());
create policy "admins update tenant" on public.tenants
  for update to authenticated
  using (id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (id = public.current_tenant_id());

-- ----- PROFILES policies -----
create policy "read profiles in tenant" on public.profiles
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "user updates own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admin inserts profile" on public.profiles
  for insert to authenticated with check (public.has_role(auth.uid(),'admin') and tenant_id = public.current_tenant_id());
create policy "admin deletes profile" on public.profiles
  for delete to authenticated using (public.has_role(auth.uid(),'admin') and tenant_id = public.current_tenant_id());

-- ----- USER_ROLES policies -----
create policy "read own roles or admin reads tenant roles" on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin')));
create policy "admin manages roles" on public.user_roles
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'));

-- ============================================================
-- REUSABLE MACRO via DO block to set RLS on tenant-scoped tables
-- We'll write policies explicitly per table for clarity.
-- ============================================================

-- ----- DEPARTMENTS -----
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
create index departments_tenant_idx on public.departments(tenant_id);
grant select, insert, update, delete on public.departments to authenticated;
grant all on public.departments to service_role;
alter table public.departments enable row level security;
create policy "departments tenant access" on public.departments
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- SLA POLICIES -----
create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  priority public.ticket_priority,
  first_response_minutes integer not null default 60,
  resolution_minutes integer not null default 480,
  created_at timestamptz not null default now()
);
create index sla_policies_tenant_idx on public.sla_policies(tenant_id);
grant select, insert, update, delete on public.sla_policies to authenticated;
grant all on public.sla_policies to service_role;
alter table public.sla_policies enable row level security;
create policy "sla read tenant" on public.sla_policies
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "sla admin write" on public.sla_policies
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'));

-- ----- CONTRACT TYPES -----
create table public.contract_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  default_hours_monthly integer not null default 0,
  default_monthly_value numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);
create index contract_types_tenant_idx on public.contract_types(tenant_id);
grant select, insert, update, delete on public.contract_types to authenticated;
grant all on public.contract_types to service_role;
alter table public.contract_types enable row level security;
create policy "contract_types read tenant" on public.contract_types
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "contract_types admin write" on public.contract_types
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'));

-- ----- COMPANIES -----
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  fantasy_name text,
  cnpj text,
  segment text,
  phone text,
  website text,
  address_street text,
  address_number text,
  address_complement text,
  address_city text,
  address_state text,
  address_zip text,
  is_vip boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_tenant_idx on public.companies(tenant_id);
create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;
alter table public.companies enable row level security;
create policy "companies tenant access" on public.companies
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- CONTACTS -----
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  job_title text,
  can_open_tickets boolean not null default true,
  receives_csat boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contacts_tenant_idx on public.contacts(tenant_id);
create index contacts_company_idx on public.contacts(company_id);
create index contacts_email_idx on public.contacts(tenant_id, lower(email));
create index contacts_phone_idx on public.contacts(tenant_id, phone);
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts to service_role;
alter table public.contacts enable row level security;
create policy "contacts tenant access" on public.contacts
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- CONTRACTS -----
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_type_id uuid references public.contract_types(id) on delete set null,
  sla_policy_id uuid references public.sla_policies(id) on delete set null,
  status public.contract_status not null default 'active',
  starts_at date not null,
  ends_at date not null,
  hours_monthly_quota integer not null default 0,
  extra_hour_price numeric(12,2) not null default 0,
  monthly_value numeric(12,2) not null default 0,
  auto_renew boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contracts_tenant_idx on public.contracts(tenant_id);
create index contracts_company_idx on public.contracts(company_id);
create trigger contracts_set_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.contracts to authenticated;
grant all on public.contracts to service_role;
alter table public.contracts enable row level security;
create policy "contracts tenant access" on public.contracts
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- TICKETS -----
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  number bigserial,
  subject text not null,
  status public.ticket_status not null default 'new',
  priority public.ticket_priority not null default 'medium',
  channel public.ticket_channel not null default 'manual',
  department_id uuid references public.departments(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  sla_policy_id uuid references public.sla_policies(id) on delete set null,
  sla_first_response_due_at timestamptz,
  sla_resolution_due_at timestamptz,
  sla_breached boolean not null default false,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tickets_tenant_idx on public.tickets(tenant_id);
create index tickets_status_idx on public.tickets(tenant_id, status);
create index tickets_assigned_idx on public.tickets(assigned_to);
create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.tickets to authenticated;
grant all on public.tickets to service_role;
alter table public.tickets enable row level security;
create policy "tickets tenant access" on public.tickets
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- MESSAGES -----
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_contact_id uuid references public.contacts(id) on delete set null,
  author_type public.message_author_type not null,
  content text not null,
  is_internal boolean not null default false,
  channel public.ticket_channel,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index messages_ticket_idx on public.messages(ticket_id, created_at);
create index messages_tenant_idx on public.messages(tenant_id);
grant select, insert, update, delete on public.messages to authenticated;
grant all on public.messages to service_role;
alter table public.messages enable row level security;
create policy "messages tenant access" on public.messages
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- TIME ENTRIES -----
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  agent_id uuid not null references auth.users(id) on delete cascade,
  minutes integer not null check (minutes > 0),
  description text,
  started_at timestamptz,
  created_at timestamptz not null default now()
);
create index time_entries_ticket_idx on public.time_entries(ticket_id);
create index time_entries_tenant_idx on public.time_entries(tenant_id);
grant select, insert, update, delete on public.time_entries to authenticated;
grant all on public.time_entries to service_role;
alter table public.time_entries enable row level security;
create policy "time_entries tenant access" on public.time_entries
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- CANNED RESPONSES -----
create table public.canned_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index canned_responses_tenant_idx on public.canned_responses(tenant_id);
grant select, insert, update, delete on public.canned_responses to authenticated;
grant all on public.canned_responses to service_role;
alter table public.canned_responses enable row level security;
create policy "canned tenant access" on public.canned_responses
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- KB CATEGORIES -----
create table public.kb_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  parent_id uuid references public.kb_categories(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index kb_categories_tenant_idx on public.kb_categories(tenant_id);
grant select, insert, update, delete on public.kb_categories to authenticated;
grant select on public.kb_categories to anon;
grant all on public.kb_categories to service_role;
alter table public.kb_categories enable row level security;
create policy "kb_categories read tenant" on public.kb_categories
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "kb_categories admin write" on public.kb_categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'));

-- ----- KB ARTICLES -----
create table public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.kb_categories(id) on delete set null,
  title text not null,
  body text not null default '',
  slug text not null,
  is_public boolean not null default false,
  status public.kb_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index kb_articles_tenant_idx on public.kb_articles(tenant_id);
create trigger kb_articles_set_updated_at before update on public.kb_articles
  for each row execute function public.set_updated_at();
grant select, insert, update, delete on public.kb_articles to authenticated;
grant select on public.kb_articles to anon;
grant all on public.kb_articles to service_role;
alter table public.kb_articles enable row level security;
create policy "kb_articles read tenant" on public.kb_articles
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy "kb_articles public read" on public.kb_articles
  for select to anon using (is_public = true and status = 'published');
create policy "kb_articles admin write" on public.kb_articles
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'))
  with check (tenant_id = public.current_tenant_id() and public.has_role(auth.uid(),'admin'));

-- ----- CSAT -----
create table public.csat_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  rating integer check (rating between 1 and 5),
  comment text,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);
create index csat_tenant_idx on public.csat_responses(tenant_id);
grant select, insert, update, delete on public.csat_responses to authenticated;
grant all on public.csat_responses to service_role;
alter table public.csat_responses enable row level security;
create policy "csat tenant access" on public.csat_responses
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ----- REALTIME -----
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.time_entries;
