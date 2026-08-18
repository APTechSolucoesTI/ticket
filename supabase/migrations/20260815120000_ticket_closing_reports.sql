-- Relatório de Fechamento — gerado automaticamente quando um ticket é fechado.
-- Espelha o padrão já usado por csat_responses/get_csat_by_token: token opaco
-- gerado no banco, consulta pública via função SECURITY DEFINER (a tabela em
-- si não é exposta a anon).

create table public.ticket_closing_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  token text not null unique,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now()
);

create index ticket_closing_reports_tenant_idx on public.ticket_closing_reports(tenant_id);

grant select, insert on public.ticket_closing_reports to authenticated;
grant all on public.ticket_closing_reports to service_role;

alter table public.ticket_closing_reports enable row level security;

create policy "ticket_closing_reports tenant access" on public.ticket_closing_reports
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Auto-gera o relatório assim que o ticket entra em "closed". Token via
-- pgcrypto (já habilitado no projeto). ON CONFLICT mantém o mesmo token
-- (link permanece válido se o ticket for reaberto e fechado de novo), só
-- atualiza o carimbo de geração.
create or replace function public.generate_ticket_closing_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'closed' and (old.status is distinct from new.status) then
    insert into public.ticket_closing_reports (tenant_id, ticket_id, token, generated_by)
    values (new.tenant_id, new.id, encode(extensions.gen_random_bytes(20), 'hex'), auth.uid())
    on conflict (ticket_id) do update
      set generated_at = now(),
          generated_by = excluded.generated_by;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_generate_closing_report on public.tickets;
create trigger tickets_generate_closing_report
  after update on public.tickets
  for each row execute function public.generate_ticket_closing_report();

revoke all on function public.generate_ticket_closing_report() from public, anon, authenticated;

-- Conteúdo sempre lido ao vivo das tabelas de origem (não é snapshot) —
-- reabrir/editar o ticket depois de fechado nunca deixa o relatório
-- desatualizado. Retorna null se token inválido/não encontrado.
create or replace function public.get_closing_report_by_token(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if _token is null or length(_token) < 16 then
    return null;
  end if;

  select jsonb_build_object(
    'report_number', 'F-' || lpad(t.number::text, 6, '0'),
    'generated_at', r.generated_at,
    'ticket_number', t.number,
    'subject', coalesce(nullif(t.resolution_summary, ''), t.subject),
    'diagnosis_html', t.resolution_diagnosis,
    'closed_at', t.closed_at,
    'client_name', comp.name,
    'contact_name', cont.name,
    'contract_name', cty.name,
    'equipment_name', eq.name,
    'agent_name', ag.name,
    'total_minutes', coalesce(te.total_minutes, 0),
    'time_entries', coalesce(te.entries, '[]'::jsonb),
    'services', coalesce(svc.items, '[]'::jsonb),
    'tenant_name', ten.name
  )
  into result
  from public.ticket_closing_reports r
  join public.tickets t on t.id = r.ticket_id
  left join public.companies comp on comp.id = t.company_id
  left join public.contacts cont on cont.id = t.contact_id
  left join public.contracts ctr on ctr.id = t.contract_id
  left join public.contract_types cty on cty.id = ctr.contract_type_id
  left join public.equipments eq on eq.id = t.equipment_id
  left join public.profiles ag on ag.id = t.assigned_to
  left join public.tenants ten on ten.id = t.tenant_id
  left join lateral (
    select
      sum(te2.minutes) as total_minutes,
      jsonb_agg(jsonb_build_object(
        'started_at', te2.started_at,
        'minutes', te2.minutes,
        'description', te2.description,
        'agent_name', tp.name
      ) order by te2.created_at) as entries
    from public.time_entries te2
    left join public.profiles tp on tp.id = te2.agent_id
    where te2.ticket_id = t.id
  ) te on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'description', ps.description,
      'complement', tsp.complement
    ) order by tsp.created_at) as items
    from public.ticket_services_performed tsp
    join public.provided_services ps on ps.id = tsp.provided_service_id
    where tsp.ticket_id = t.id
  ) svc on true
  where r.token = _token;

  return result;
end;
$$;

revoke all on function public.get_closing_report_by_token(text) from public;
grant execute on function public.get_closing_report_by_token(text) to anon, authenticated;
