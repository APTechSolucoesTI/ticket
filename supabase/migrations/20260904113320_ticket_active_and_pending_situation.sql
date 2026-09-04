begin;

alter table apticket.tickets
  drop constraint if exists tickets_pending_type_check;

alter table apticket.tickets
  add constraint tickets_pending_type_check
  check (
    pending_type is null
    or pending_type in ('awaiting_tech', 'awaiting_customer', 'tech_response', 'in_progress')
  );

drop function if exists apticket.pause_ticket(uuid, uuid, text, timestamptz);

create function apticket.pause_ticket(
  _ticket_id uuid,
  _reason_id uuid,
  _complement text,
  _timer_started_at timestamptz,
  _pending_type text
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
  if _pending_type is null or _pending_type not in ('awaiting_customer', 'awaiting_tech') then
    raise exception 'Selecione a situacao de pendencia do ticket';
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

  update apticket.tickets
  set sla_paused_at = v_now,
      status = 'pending',
      pending_type = _pending_type
  where id = _ticket_id;

  return v_pause_id;
end;
$$;

revoke all on function apticket.pause_ticket(uuid, uuid, text, timestamptz, text)
  from public, anon;
grant execute on function apticket.pause_ticket(uuid, uuid, text, timestamptz, text)
  to authenticated;

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
  set ended_at = v_now,
      resumed_by = auth.uid(),
      resume_source = 'manual'
  where id = v_pause.id;

  update apticket.tickets
  set sla_paused_at = null,
      total_sla_paused_seconds = total_sla_paused_seconds + v_seconds,
      sla_first_response_due_at = case
        when sla_first_response_due_at is null then null
        else sla_first_response_due_at + v_elapsed
      end,
      sla_resolution_due_at = case
        when sla_resolution_due_at is null then null
        else sla_resolution_due_at + v_elapsed
      end,
      status = 'in_progress',
      pending_type = case
        when channel in ('chat', 'whatsapp', 'email', 'portal') then 'in_progress'
        else null
      end
  where id = _ticket_id;
end;
$$;

revoke all on function apticket.resume_ticket(uuid) from public, anon;
grant execute on function apticket.resume_ticket(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
