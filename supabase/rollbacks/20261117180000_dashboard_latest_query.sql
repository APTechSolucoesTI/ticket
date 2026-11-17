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
 with visible as materialized(select t.status,t.tipo_atendimento,t.sla_paused_at,t.sla_resolution_due_at,t.created_at,t.resolved_at,t.closed_at from apticket.tickets t where t.tenant_id=v_tenant), stats as (
   select count(*) filter(where status='new') new_count,count(*) filter(where status='in_progress') in_progress,
     count(*) filter(where status='pending') pending,count(*) filter(where status in ('resolved','closed')) finished,
     count(*) filter(where status not in ('resolved','closed')) open_count,
     count(*) filter(where status not in ('resolved','closed') and tipo_atendimento<>'avulso' and sla_paused_at is null and coalesce(sla_resolution_due_at,created_at+interval '4 hours')<v_now) sla_risk,
     count(*) filter(where created_at between v_now-interval '7 days' and v_now) last7,
     count(*) filter(where created_at>=v_now-interval '14 days' and created_at<v_now-interval '7 days') previous7,
     count(*) filter(where created_at between v_start and v_now) current_period,
     count(*) filter(where created_at>=v_previous and created_at<v_start) previous_period,
     count(*) filter(where status in ('resolved','closed') and coalesce(resolved_at,closed_at)>=created_at) resolution_sample,
     avg(extract(epoch from (coalesce(resolved_at,closed_at)-created_at))*1000) filter(where status in ('resolved','closed') and coalesce(resolved_at,closed_at)>=created_at) avg_ms
   from visible
 ), created as (select (created_at at time zone 'America/Sao_Paulo')::date as day,count(*) n from visible where created_at between v_start and v_now group by 1),
 resolved as (select (coalesce(resolved_at,closed_at) at time zone 'America/Sao_Paulo')::date as day,count(*) n from visible where coalesce(resolved_at,closed_at) between v_start and v_now group by 1),
 days as (select v_day-i as day from generate_series(0,_period_days-1) i), volume as (
   select days.day,to_char(days.day,'DD/MM') as date,coalesce(created.n,0) criados,coalesce(resolved.n,0) resolvidos
   from days left join created using(day) left join resolved using(day)
 ) select jsonb_build_object('newCount',new_count,'inProgress',in_progress,'pending',pending,'finished',finished,'openCount',open_count,'slaAtRisk',sla_risk,
   'currentPeriodCount',current_period,'previousPeriodCount',previous_period,'averageResolutionHours',coalesce(avg_ms/3600000,0),
   'summary',jsonb_build_object('inProgress',in_progress,'pending',pending,'finished',finished,'last7Count',last7,'last7DailyAverage',last7::numeric/7,
     'trendPercent',case when previous7=0 then case when last7=0 then 0 else 100 end else (last7-previous7)::numeric/previous7*100 end,
     'averageResolutionMs',avg_ms,'resolutionSample',resolution_sample),
   'volume',(select jsonb_agg(jsonb_build_object('date',date,'iso',day,'criados',criados,'resolvidos',resolvidos) order by day) from volume)) into result from stats;
 latest:=apticket.list_ticket_inbox(1,10,'','{}','created_at','desc')->'items';
 return result||jsonb_build_object('latest',jsonb_path_query_array(latest,'$[0 to 5]'),'timezone','America/Sao_Paulo');
end $$;
alter function apticket.get_ticket_metrics(integer) owner to postgres;
revoke all on function apticket.get_ticket_metrics(integer) from public,anon;
grant execute on function apticket.get_ticket_metrics(integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
