-- Ticket pause lifecycle, SLA accounting and outbound-delivery observability.

alter table apticket.tickets
  add column if not exists sla_paused_at timestamptz,
  add column if not exists total_sla_paused_seconds bigint not null default 0;

alter table apticket.messages
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_error text;

alter table apticket.portal_otp_codes
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

create table apticket.pause_reasons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index pause_reasons_tenant_active_idx
  on apticket.pause_reasons (tenant_id, is_active, name);

create table apticket.ticket_pauses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  ticket_id uuid not null references apticket.tickets(id) on delete cascade,
  reason_id uuid references apticket.pause_reasons(id) on delete set null,
  reason_snapshot text not null,
  complement text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  paused_by uuid not null references apticket.profiles(id) on delete restrict,
  resumed_by uuid references apticket.profiles(id) on delete set null,
  resume_source text check (resume_source in ('manual', 'customer_interaction')),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index ticket_pauses_one_active_idx
  on apticket.ticket_pauses (ticket_id)
  where ended_at is null;
create index ticket_pauses_ticket_started_idx
  on apticket.ticket_pauses (ticket_id, started_at desc);
create index ticket_pauses_tenant_idx on apticket.ticket_pauses (tenant_id);

grant select, insert, update, delete on apticket.pause_reasons to authenticated;
grant all on apticket.pause_reasons to service_role;
grant select, insert, update on apticket.ticket_pauses to authenticated;
grant all on apticket.ticket_pauses to service_role;

alter table apticket.pause_reasons enable row level security;
alter table apticket.ticket_pauses enable row level security;

create policy "pause_reasons select" on apticket.pause_reasons for select to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'view')
  );
create policy "pause_reasons insert" on apticket.pause_reasons for insert to authenticated
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  );
create policy "pause_reasons update" on apticket.pause_reasons for update to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  );
create policy "pause_reasons delete" on apticket.pause_reasons for delete to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  );

create policy "ticket_pauses select" on apticket.ticket_pauses for select to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'view')
  );
create policy "ticket_pauses insert" on apticket.ticket_pauses for insert to authenticated
  with check (
    tenant_id = apticket.current_tenant_id()
    and paused_by = auth.uid()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  );
create policy "ticket_pauses update" on apticket.ticket_pauses for update to authenticated
  using (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  )
  with check (
    tenant_id = apticket.current_tenant_id()
    and apticket.has_permission(auth.uid(), 'tickets', 'edit')
  );

create or replace function apticket.seed_default_pause_reasons(_tenant_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into apticket.pause_reasons (tenant_id, name)
  values
    (_tenant_id, 'Aguardando retorno do cliente'),
    (_tenant_id, 'Aguardando fornecedor ou terceiro'),
    (_tenant_id, 'Aguardando janela de manutenção'),
    (_tenant_id, 'Aguardando acesso ou autorização'),
    (_tenant_id, 'Outro')
  on conflict (tenant_id, name) do nothing;
$$;

select apticket.seed_default_pause_reasons(id) from apticket.tenants;

create or replace function apticket.seed_pause_reasons_for_new_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform apticket.seed_default_pause_reasons(new.id);
  return new;
end;
$$;

create trigger tenants_seed_pause_reasons
  after insert on apticket.tenants
  for each row execute function apticket.seed_pause_reasons_for_new_tenant();

revoke all on function apticket.seed_default_pause_reasons(uuid) from public, anon, authenticated;
revoke all on function apticket.seed_pause_reasons_for_new_tenant() from public, anon, authenticated;

create or replace function apticket.pause_ticket(
  _ticket_id uuid,
  _reason_id uuid,
  _complement text,
  _timer_started_at timestamptz
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_ticket apticket.tickets%rowtype;
  v_reason text;
  v_pause_id uuid;
  v_now timestamptz := clock_timestamp();
  v_minutes integer;
begin
  if auth.uid() is null then raise exception 'Sessao expirada'; end if;
  if _timer_started_at is null or _timer_started_at > v_now then
    raise exception 'O Time Tracking precisa estar ativo para pausar o ticket';
  end if;

  select * into v_ticket
  from apticket.tickets
  where id = _ticket_id
    and tenant_id = apticket.current_tenant_id()
  for update;

  if not found then raise exception 'Ticket nao encontrado'; end if;
  if v_ticket.assigned_to is distinct from auth.uid() then
    raise exception 'Somente o tecnico responsavel pode pausar o ticket';
  end if;
  if v_ticket.status in ('resolved', 'closed') then
    raise exception 'Nao e possivel pausar um ticket finalizado';
  end if;
  if v_ticket.sla_paused_at is not null or exists (
    select 1 from apticket.ticket_pauses where ticket_id = _ticket_id and ended_at is null
  ) then
    raise exception 'Este ticket ja esta pausado';
  end if;

  select name into v_reason
  from apticket.pause_reasons
  where id = _reason_id and tenant_id = v_ticket.tenant_id and is_active;
  if v_reason is null then raise exception 'Selecione um motivo de pausa valido'; end if;
  if v_reason = 'Outro' and length(trim(coalesce(_complement, ''))) < 3 then
    raise exception 'Descreva o motivo da pausa';
  end if;

  v_minutes := greatest(1, ceil(extract(epoch from (v_now - _timer_started_at)) / 60.0)::integer);
  insert into apticket.time_entries (
    tenant_id, ticket_id, agent_id, minutes, started_at, ended_at, description
  ) values (
    v_ticket.tenant_id, _ticket_id, auth.uid(), v_minutes, _timer_started_at, v_now,
    concat('Atendimento finalizado ao pausar: ', v_reason,
      case when nullif(trim(coalesce(_complement, '')), '') is not null
        then concat(' - ', trim(_complement)) else '' end)
  );

  insert into apticket.ticket_pauses (
    tenant_id, ticket_id, reason_id, reason_snapshot, complement, started_at, paused_by
  ) values (
    v_ticket.tenant_id, _ticket_id, _reason_id, v_reason,
    nullif(trim(coalesce(_complement, '')), ''), v_now, auth.uid()
  ) returning id into v_pause_id;

  update apticket.tickets set sla_paused_at = v_now where id = _ticket_id;
  return v_pause_id;
end;
$$;

create or replace function apticket.resume_ticket(_ticket_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ticket apticket.tickets%rowtype;
  v_pause apticket.ticket_pauses%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed interval;
  v_seconds bigint;
begin
  if auth.uid() is null then raise exception 'Sessao expirada'; end if;
  select * into v_ticket from apticket.tickets
  where id = _ticket_id and tenant_id = apticket.current_tenant_id()
  for update;
  if not found then raise exception 'Ticket nao encontrado'; end if;
  if v_ticket.assigned_to is distinct from auth.uid() then
    raise exception 'Somente o tecnico responsavel pode retomar o ticket';
  end if;

  select * into v_pause from apticket.ticket_pauses
  where ticket_id = _ticket_id and ended_at is null
  for update;
  if not found then raise exception 'Este ticket nao esta pausado'; end if;

  v_elapsed := v_now - v_pause.started_at;
  v_seconds := greatest(0, floor(extract(epoch from v_elapsed))::bigint);
  update apticket.ticket_pauses
    set ended_at = v_now, resumed_by = auth.uid(), resume_source = 'manual'
    where id = v_pause.id;
  update apticket.tickets set
    sla_paused_at = null,
    total_sla_paused_seconds = total_sla_paused_seconds + v_seconds,
    sla_first_response_due_at = case when sla_first_response_due_at is null then null else sla_first_response_due_at + v_elapsed end,
    sla_resolution_due_at = case when sla_resolution_due_at is null then null else sla_resolution_due_at + v_elapsed end
  where id = _ticket_id;
end;
$$;

revoke all on function apticket.pause_ticket(uuid, uuid, text, timestamptz) from public, anon;
revoke all on function apticket.resume_ticket(uuid) from public, anon;
grant execute on function apticket.pause_ticket(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function apticket.resume_ticket(uuid) to authenticated;

create or replace function apticket.resume_paused_ticket_on_customer_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pause apticket.ticket_pauses%rowtype;
  v_now timestamptz := clock_timestamp();
  v_elapsed interval;
  v_seconds bigint;
begin
  if new.author_type <> 'contact' then return new; end if;

  select * into v_pause from apticket.ticket_pauses
  where ticket_id = new.ticket_id and ended_at is null
  for update;
  if not found then return new; end if;

  v_elapsed := v_now - v_pause.started_at;
  v_seconds := greatest(0, floor(extract(epoch from v_elapsed))::bigint);
  update apticket.ticket_pauses set
    ended_at = v_now, resumed_by = null, resume_source = 'customer_interaction'
  where id = v_pause.id and ended_at is null;
  update apticket.tickets set
    sla_paused_at = null,
    total_sla_paused_seconds = total_sla_paused_seconds + v_seconds,
    sla_first_response_due_at = case when sla_first_response_due_at is null then null else sla_first_response_due_at + v_elapsed end,
    sla_resolution_due_at = case when sla_resolution_due_at is null then null else sla_resolution_due_at + v_elapsed end
  where id = new.ticket_id;
  return new;
end;
$$;

create trigger messages_resume_paused_ticket
  after insert on apticket.messages
  for each row execute function apticket.resume_paused_ticket_on_customer_message();

revoke all on function apticket.resume_paused_ticket_on_customer_message()
  from public, anon, authenticated;

alter publication supabase_realtime add table apticket.pause_reasons;
alter publication supabase_realtime add table apticket.ticket_pauses;
