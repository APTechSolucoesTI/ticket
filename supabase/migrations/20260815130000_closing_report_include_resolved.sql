-- Relatório do atendimento agora também é gerado quando o ticket vira
-- "resolved" (antes só disparava em "closed") — o botão de imprimir na tela
-- do ticket precisa funcionar assim que o ticket é resolvido, não só depois
-- de fechado. Mesma tabela/token/rota — reaberto/fechado depois mantém o
-- mesmo link (ON CONFLICT já cobre isso).

create or replace function public.generate_ticket_closing_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('resolved', 'closed') and (old.status is distinct from new.status) then
    insert into public.ticket_closing_reports (tenant_id, ticket_id, token, generated_by)
    values (new.tenant_id, new.id, encode(extensions.gen_random_bytes(20), 'hex'), auth.uid())
    on conflict (ticket_id) do update
      set generated_at = now(),
          generated_by = excluded.generated_by;
  end if;
  return new;
end;
$$;

-- Inclui resolved_at no payload público (closed_at pode ser nulo se o
-- ticket ainda não foi fechado, só resolvido).
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
    'status', t.status,
    'closed_at', t.closed_at,
    'resolved_at', t.resolved_at,
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
