begin;
set local lock_timeout='5s';
-- Match the UI's Portuguese, accent-insensitive natural ordering (2 before 10).
create collation apticket.ticket_sort_pt_br(provider=icu,locale='pt-BR-u-kn-true',deterministic=false);
create function apticket.ticket_search_text(_value text) returns text
language sql immutable parallel safe set search_path=pg_catalog as $$
 select lower(translate(coalesce(_value,''),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ','AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'));
$$;

create function apticket.list_ticket_inbox(
 _page integer default 1,_page_size integer default 10,_search text default '',
 _filters jsonb default '{}',_sort_key text default 'created_at',_sort_direction text default 'desc'
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog as $$
declare v_tenant uuid:=apticket.current_tenant_id(); f record; x text; result jsonb;
begin
 if v_tenant is null or not apticket.has_permission(auth.uid(),'tickets','view') then raise insufficient_privilege using message='ticket_access_denied'; end if;
 if _page is null or _page<1 or _page>1000000 or _page_size is null or _page_size not in (10,20,30,50,100)
    or char_length(coalesce(_search,''))>200 or _sort_key is null
    or _sort_key not in ('number','subject','customer','company','contact','assignee','priority','sla','status','channel','created_at')
    or _sort_direction is null or _sort_direction not in ('asc','desc') or jsonb_typeof(_filters) is distinct from 'object' then
   raise invalid_parameter_value using message='ticket_query_invalid';
 end if;
 for f in select * from jsonb_each(_filters) loop
   if f.key not in ('status','attendanceType','priority','assignee','channel','department') or jsonb_typeof(f.value)<>'array' then raise invalid_parameter_value using message='ticket_filter_invalid'; end if;
   if jsonb_array_length(f.value)>100 then raise invalid_parameter_value using message='ticket_filter_invalid'; end if;
   for x in select jsonb_array_elements_text(f.value) loop
     if x is null or (f.key='status' and x not in ('new','in_progress','pending','resolved','closed'))
       or (f.key='attendanceType' and x not in ('contratual','avulso')) or (f.key='priority' and x not in ('low','medium','high','urgent'))
       or (f.key='channel' and x not in ('email','whatsapp','chat','manual','portal'))
       or (f.key in ('assignee','department') and x !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
       raise invalid_parameter_value using message='ticket_filter_invalid';
     end if;
   end loop;
 end loop;
 with filtered as materialized (
   select t.id,t.tenant_id,t.number,t.subject,t.status,t.pending_type,t.priority,t.channel,t.company_id,t.contact_id,t.contract_id,
     t.tipo_atendimento,t.motivo_avulso,t.department_id,t.assigned_to,t.created_at,t.sla_resolution_due_at,t.sla_paused_at,t.resolved_at,t.closed_at,t.resolution_summary,
     case when c.id is not null then jsonb_build_object('name',c.name) end as companies,
     case when co.id is not null then jsonb_build_object('name',co.name) end as contacts,p.name as "assigneeName"
   from apticket.tickets t left join apticket.companies c on c.id=t.company_id and c.tenant_id=t.tenant_id
   left join apticket.contacts co on co.id=t.contact_id and co.tenant_id=t.tenant_id
   left join apticket.profiles p on p.id=t.assigned_to and p.tenant_id=t.tenant_id
   where t.tenant_id=v_tenant
     and (coalesce(_filters->'status','[]')='[]' or _filters->'status' ? t.status::text)
     and (coalesce(_filters->'attendanceType','[]')='[]' or _filters->'attendanceType' ? t.tipo_atendimento::text)
     and (coalesce(_filters->'priority','[]')='[]' or _filters->'priority' ? t.priority::text)
     and (coalesce(_filters->'channel','[]')='[]' or _filters->'channel' ? t.channel::text)
     and (coalesce(_filters->'assignee','[]')='[]' or _filters->'assignee' ? t.assigned_to::text)
     and (coalesce(_filters->'department','[]')='[]' or _filters->'department' ? t.department_id::text)
     and strpos(apticket.ticket_search_text(concat_ws(' ',t.number::text,t.subject,c.name,co.name)),apticket.ticket_search_text(btrim(_search)))>0
 ), info as (
   select count(*) total,greatest(1,least(_page,ceil(count(*)::numeric/_page_size)::integer)) page from filtered
 ), sortable as (
   select b.*,
     case when _sort_key='number' then b.number when _sort_key='priority' then array_position(array['low','medium','high','urgent'],b.priority::text)::bigint end as _numeric,
     case when _sort_key='created_at' then b.created_at when _sort_key='sla' and b.tipo_atendimento<>'avulso' then coalesce(b.sla_resolution_due_at,b.created_at+interval '4 hours') end as _date,
     apticket.ticket_search_text(case _sort_key when 'subject' then b.subject when 'customer' then concat_ws(' ',b.contacts->>'name',b.companies->>'name')
       when 'company' then b.companies->>'name' when 'contact' then b.contacts->>'name' when 'assignee' then b."assigneeName" when 'status' then b.status::text when 'channel' then b.channel::text end) as _text
   from filtered b
 ), page as (
   select s.*,row_number() over(order by
     case when _sort_direction='asc' then _numeric end asc nulls last,case when _sort_direction='desc' then _numeric end desc nulls last,
     case when _sort_direction='asc' then _date end asc nulls last,case when _sort_direction='desc' then _date end desc nulls last,
     case when _sort_direction='asc' then _text end collate apticket.ticket_sort_pt_br asc,case when _sort_direction='desc' then _text end collate apticket.ticket_sort_pt_br desc,id) as _ordinal
   from sortable s order by _ordinal limit _page_size offset ((select page from info)-1)*_page_size
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)-array['_numeric','_date','_text','_ordinal'] order by _ordinal) from page p),'[]'::jsonb),
   'total',info.total,'page',info.page,'pageSize',_page_size) into result from info;
 return result;
end $$;

create function apticket.get_ticket_metrics(_period_days integer default 14)
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
alter function apticket.ticket_search_text(text) owner to postgres;
alter function apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text) owner to postgres;
alter function apticket.get_ticket_metrics(integer) owner to postgres;
revoke all on function apticket.ticket_search_text(text),apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text),apticket.get_ticket_metrics(integer) from public,anon;
grant execute on function apticket.ticket_search_text(text),apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text),apticket.get_ticket_metrics(integer) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
