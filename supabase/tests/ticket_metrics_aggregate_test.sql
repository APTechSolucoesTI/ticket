-- Independent oracle: the complete previous 20261117180000 implementation.
-- The transaction rolls back helper, fixtures, permissions and test policies.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,apticket,pg_catalog;
select no_plan();
create or replace function apticket.get_ticket_metrics_baseline(_period_days integer default 14)
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

revoke all on function apticket.get_ticket_metrics_baseline(integer) from public,anon;
grant execute on function apticket.get_ticket_metrics_baseline(integer) to authenticated;
set local plpgsql.check_asserts=on;
insert into apticket.permissions(module,action) values ('tickets','view') on conflict do nothing;
create temp table metrics_fixture(tenant_id uuid,profile_id uuid);
insert into metrics_fixture select tenant_id,id from apticket.provision_tenant('Metrics main','Metrics owner','metrics-main@example.test','$2b$12$'||repeat('a',53));
insert into metrics_fixture select tenant_id,id from apticket.provision_tenant('Metrics other','Metrics other','metrics-other@example.test','$2b$12$'||repeat('b',53));
grant select on metrics_fixture to authenticated;
set local session_replication_role=replica;
-- Two years of history; sparse recent dates; completed, pending, paused and
-- ad-hoc tickets; both completion columns; negative and fractional durations.
insert into apticket.tickets(tenant_id,subject,status,created_at,resolved_at,closed_at,
  sla_resolution_due_at,sla_paused_at,tipo_atendimento,motivo_avulso,resolution_summary,resolution_diagnosis)
select f.tenant_id,'Metrics synthetic '||n,
  (array['new','in_progress','pending','resolved','closed'])[1+n%5]::apticket.ticket_status,
  d.created,
  case when n%3=0 then d.created + (case when n%11=0 then -1 else 1+n%96 end)*interval '1 hour' + interval '0.123456 seconds' end,
  case when n%3<>0 then d.created + interval '2 hours 0.987654 seconds' end,
  case when n%7<>0 then d.created+interval '4 hours' end,
  case when n%17=0 then d.created+interval '1 hour' end,
  (case when n%13=0 then 'avulso' else 'contratual' end)::apticket.tipo_atendimento,
  case when n%13=0 then 'cliente_sem_contrato'::apticket.motivo_avulso end,
  'Synthetic completion','Synthetic diagnosis'
from metrics_fixture f cross join generate_series(1,coalesce(nullif(current_setting('apticket.test_metrics_rows',true),''),'2000')::integer) n
cross join lateral(select ((statement_timestamp() at time zone 'America/Sao_Paulo')::date-(n%730))::timestamp at time zone 'America/Sao_Paulo'
  + (n%24)*interval '1 hour' as created) d
where f.tenant_id=(select tenant_id from apticket.profiles where email='metrics-main@example.test');
-- Exact boundary/precedence fixtures include future events, zero duration,
-- both completion columns set, missing completion and recent completion of an
-- old ticket. The original implementation is the independent contract oracle.
insert into apticket.tickets(tenant_id,subject,status,created_at,resolved_at,closed_at,resolution_summary,resolution_diagnosis)
select f.tenant_id,'Metrics boundary '||n,'closed',
 case when n=1 then statement_timestamp() when n=2 then statement_timestamp()+interval '1 day'
 else ((statement_timestamp() at time zone 'America/Sao_Paulo')::date-30)::timestamp at time zone 'America/Sao_Paulo' end,
 case when n=3 then statement_timestamp()-interval '1 microsecond' when n=4 then statement_timestamp()+interval '1 day' end,
 case when n in(1,3,4,5) then statement_timestamp() end,'Synthetic completion','Synthetic diagnosis'
from metrics_fixture f cross join generate_series(1,6) n;
set local session_replication_role=origin;
analyze apticket.tickets;
select set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'tenant_id',p.tenant_id,'app','apticket','role','authenticated','session_version',p.session_version)::text,false)
from apticket.profiles p where email='metrics-main@example.test';
-- RESOURCE_FIXTURE_READY: the runner may retain only the synthetic setup above.
set local role authenticated;
do $test$
declare period integer; actual jsonb; expected jsonb;
begin
 foreach period in array array[7,14,30] loop
  actual:=apticket.get_ticket_metrics(period);
  expected:=apticket.get_ticket_metrics_baseline(period);
  assert actual=expected, 'grouped metrics preserve complete historical/calendar/latest JSON';
 end loop;
end $test$;
reset role;
select pass('all calendar periods preserve the complete previous metrics JSON');
create policy metrics_test_subset on apticket.tickets as restrictive for select to authenticated using(number%2=0);
set local role authenticated;
do $test$ begin
 assert apticket.get_ticket_metrics(30)=apticket.get_ticket_metrics_baseline(30), 'subset RLS is preserved';
end $test$;
reset role;
drop policy metrics_test_subset on apticket.tickets;
create policy metrics_test_empty on apticket.tickets as restrictive for select to authenticated using(false);
set local role authenticated;
do $test$
declare actual jsonb;
begin
 actual:=apticket.get_ticket_metrics(7);
 assert actual=apticket.get_ticket_metrics_baseline(7), 'empty visible set preserves the complete contract';
 assert actual->>'openCount'='0' and actual->'summary'->'averageResolutionMs'='null'::jsonb;
 assert jsonb_array_length(actual->'volume')=7 and actual->'latest'='[]'::jsonb;
end $test$;
reset role;
drop policy metrics_test_empty on apticket.tickets;
select pass('subset and empty RLS preserve aggregates, empty latest and null average');
select set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'tenant_id',p.tenant_id,'app','apticket','role','authenticated','session_version',p.session_version)::text,true)
from apticket.profiles p where email='metrics-other@example.test';
set local role authenticated;
do $test$ begin
 assert apticket.get_ticket_metrics(14)=apticket.get_ticket_metrics_baseline(14), 'other tenant sees only its six boundary tickets';
 assert apticket.get_ticket_metrics(14)->>'finished'='6';
end $test$;
reset role;
update apticket.tickets set status='new' where tenant_id=(select tenant_id from apticket.profiles where email='metrics-other@example.test');
set local role authenticated;
do $test$ begin
 assert apticket.get_ticket_metrics(14)=apticket.get_ticket_metrics_baseline(14), 'nonempty set without eligible duration samples is preserved';
 assert apticket.get_ticket_metrics(14)->'summary'->'averageResolutionMs'='null'::jsonb;
end $test$;
reset role;
select pass('other tenant and nonempty set without eligible resolution samples preserve the contract');
select * from finish();
-- The local runner alone substitutes COMMIT to EXPLAIN its disposable fixtures.
rollback;
