-- Família de Serviços / Serviços Prestados (service catalog) + the
-- "Serviços Executados" section on the ticket final report (laudo final).
-- Same conventions as the rest of the schema: tenant-scoped tables, RLS
-- "tenant access" ALL policy keyed on current_tenant_id(), grants to
-- authenticated/service_role, includes_remote/lab/onsite booleans mirroring
-- the exact naming already used on contracts/contract_types.

-- ---------- service_families ----------
create table public.service_families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  description text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

grant select, insert, update, delete on public.service_families to authenticated;
grant all on public.service_families to service_role;
alter table public.service_families enable row level security;

create policy "service_families tenant access" on public.service_families
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger service_families_set_updated_at
  before update on public.service_families
  for each row execute function public.set_updated_at();

-- ---------- provided_services ----------
create table public.provided_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  description text not null,
  family_id uuid not null references public.service_families(id) on delete restrict,
  includes_remote boolean not null default false,
  includes_lab boolean not null default false,
  includes_onsite boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index provided_services_family_idx on public.provided_services(family_id);
create index provided_services_remote_idx on public.provided_services(tenant_id) where includes_remote;

grant select, insert, update, delete on public.provided_services to authenticated;
grant all on public.provided_services to service_role;
alter table public.provided_services enable row level security;

create policy "provided_services tenant access" on public.provided_services
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create trigger provided_services_set_updated_at
  before update on public.provided_services
  for each row execute function public.set_updated_at();

-- ---------- ticket_services_performed ("Serviços Executados" on the laudo) ----------
create table public.ticket_services_performed (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  provided_service_id uuid not null references public.provided_services(id) on delete restrict,
  complement text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ticket_services_performed_ticket_idx on public.ticket_services_performed(ticket_id);

grant select, insert, update, delete on public.ticket_services_performed to authenticated;
grant all on public.ticket_services_performed to service_role;
alter table public.ticket_services_performed enable row level security;

create policy "ticket_services_performed tenant access" on public.ticket_services_performed
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Backend enforcement (not just UI filtering): a service can only be logged
-- as "executed" here if it's actually flagged for Suporte Remoto.
create or replace function public.enforce_service_remote_only()
returns trigger
language plpgsql
as $$
declare
  v_remote boolean;
begin
  select includes_remote into v_remote
  from public.provided_services
  where id = new.provided_service_id;

  if v_remote is not true then
    raise exception 'Serviço selecionado não está disponível para Suporte Remoto';
  end if;

  return new;
end;
$$;

create trigger ticket_services_performed_enforce_remote
  before insert or update on public.ticket_services_performed
  for each row execute function public.enforce_service_remote_only();
