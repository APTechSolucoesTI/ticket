begin;
set local lock_timeout='5s';
create or replace function apticket.get_ticket_metrics(_period_days integer default 14)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id(); v_now timestamptz:=statement_timestamp();
 v_day date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
 v_start timestamptz; v_previous timestamptz; result jsonb; latest jsonb;
begin
 if v_tenant is null or not apticket.has_permission(auth.uid(),'tickets','view') then raise insufficient_privilege using message='ticket_access_denied'; end if;
 if _period_days is null or _period_days not in (7,14,30) then raise invalid_parameter_value using message='ticket_period_invalid'; end if;
 v_start:=(v_day-(_period_days-1))::timestamp at time zone 'America/Sao_Paulo';
 v_previous:=(v_day-(2*_period_days-1))::timestamp at time zone 'America/Sao_Paulo';
 -- Materialize calendar bucket pairs, not every historical ticket. All
 -- out-of-period timestamps share a NULL bucket; there are at most
 -- (_period_days+1)^2 groups regardless of the visible historical row count.
 -- The accepted periods never exceed 30 days. A constant series bound keeps
 -- the small calendar cardinality visible even in a cached generic plan.
 with days as materialized(select v_day-i as day from generate_series(0,29) i where i<_period_days),
 visible as not materialized(
   select t.*,created.day as created_day,resolved.day as resolved_day
   from apticket.tickets t
   left join days created on created.day=(t.created_at at time zone 'America/Sao_Paulo')::date and t.created_at between v_start and v_now
   left join days resolved on resolved.day=(coalesce(t.resolved_at,t.closed_at) at time zone 'America/Sao_Paulo')::date and coalesce(t.resolved_at,t.closed_at) between v_start and v_now
   where t.tenant_id=v_tenant
 ), grouped as materialized(
   select created_day,resolved_day,count(*) as total,
     count(*) filter(where status='new') new_count,count(*) filter(where status='in_progress') in_progress,
     count(*) filter(where status='pending') pending,count(*) filter(where status in ('resolved','closed')) finished,
     count(*) filter(where status not in ('resolved','closed')) open_count,
     count(*) filter(where status not in ('resolved','closed') and tipo_atendimento<>'avulso' and sla_paused_at is null and coalesce(sla_resolution_due_at,created_at+interval '4 hours')<v_now) sla_risk,
     count(*) filter(where created_at between v_now-interval '7 days' and v_now) last7,
     count(*) filter(where created_at>=v_now-interval '14 days' and created_at<v_now-interval '7 days') previous7,
     count(*) filter(where created_at between v_start and v_now) current_period,
     count(*) filter(where created_at>=v_previous and created_at<v_start) previous_period,
     count(*) filter(where status in ('resolved','closed') and coalesce(resolved_at,closed_at)>=created_at) resolution_sample,
     sum(extract(epoch from (coalesce(resolved_at,closed_at)-created_at))*1000) filter(where status in ('resolved','closed') and coalesce(resolved_at,closed_at)>=created_at) resolution_ms
   from visible group by created_day,resolved_day
 ), stats as (
   select coalesce(sum(new_count),0)::bigint new_count,coalesce(sum(in_progress),0)::bigint in_progress,
     coalesce(sum(pending),0)::bigint pending,coalesce(sum(finished),0)::bigint finished,
     coalesce(sum(open_count),0)::bigint open_count,coalesce(sum(sla_risk),0)::bigint sla_risk,
     coalesce(sum(last7),0)::bigint last7,coalesce(sum(previous7),0)::bigint previous7,
     coalesce(sum(current_period),0)::bigint current_period,coalesce(sum(previous_period),0)::bigint previous_period,
     coalesce(sum(resolution_sample),0)::bigint resolution_sample,
     sum(resolution_ms)/nullif(sum(resolution_sample),0) avg_ms
   from grouped
 ), created as (select created_day as day,sum(total)::bigint n from grouped where created_day is not null group by 1),
 resolved as (select resolved_day as day,sum(total)::bigint n from grouped where resolved_day is not null group by 1),
 volume as (
   select days.day,to_char(days.day,'DD/MM') as date,coalesce(created.n,0) criados,coalesce(resolved.n,0) resolvidos
   from days left join created using(day) left join resolved using(day)
 ) select jsonb_build_object('newCount',new_count,'inProgress',in_progress,'pending',pending,'finished',finished,'openCount',open_count,'slaAtRisk',sla_risk,
   'currentPeriodCount',current_period,'previousPeriodCount',previous_period,'averageResolutionHours',coalesce(avg_ms/3600000,0),
   'summary',jsonb_build_object('inProgress',in_progress,'pending',pending,'finished',finished,'last7Count',last7,'last7DailyAverage',last7::numeric/7,
     'trendPercent',case when previous7=0 then case when last7=0 then 0 else 100 end else (last7-previous7)::numeric/previous7*100 end,
     'averageResolutionMs',avg_ms,'resolutionSample',resolution_sample),
   'volume',(select jsonb_agg(jsonb_build_object('date',date,'iso',day,'criados',criados,'resolvidos',resolvidos) order by day) from volume)) into result from stats;
 -- Limit base tickets before resolving related names or building JSON. The
 -- dashboard does not need the inbox's exact count, search or dynamic sort.
 select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at desc nulls last,recent.id),'[]'::jsonb)
 into latest from (
   select t.id,t.tenant_id,t.number,t.subject,t.status,t.pending_type,t.priority,t.channel,t.company_id,t.contact_id,t.contract_id,
     t.tipo_atendimento,t.motivo_avulso,t.department_id,t.assigned_to,t.created_at,t.sla_resolution_due_at,t.sla_paused_at,t.resolved_at,t.closed_at,t.resolution_summary,
     case when c.id is not null then jsonb_build_object('name',c.name) end as companies,
     case when co.id is not null then jsonb_build_object('name',co.name) end as contacts,p.name as "assigneeName"
   from (
     select t.* from apticket.tickets t where t.tenant_id=v_tenant
     order by t.created_at desc nulls last,t.id limit 6
   ) t
   left join apticket.companies c on c.id=t.company_id and c.tenant_id=t.tenant_id
   left join apticket.contacts co on co.id=t.contact_id and co.tenant_id=t.tenant_id
   left join apticket.profiles p on p.id=t.assigned_to and p.tenant_id=t.tenant_id
 ) recent;
 return result||jsonb_build_object('latest',latest,'timezone','America/Sao_Paulo');
end $$;
alter function apticket.get_ticket_metrics(integer) owner to postgres;
revoke all on function apticket.get_ticket_metrics(integer) from public,anon;
grant execute on function apticket.get_ticket_metrics(integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
