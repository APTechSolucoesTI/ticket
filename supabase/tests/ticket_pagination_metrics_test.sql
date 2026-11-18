begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,apticket,pg_catalog;
set local plpgsql.check_asserts=on;
select no_plan();
insert into apticket.permissions(module,action) values ('tickets','view'),('clientes','view'),('contatos','view') on conflict do nothing;
create temp table ticket_query_fixture(tenant_id uuid,profile_id uuid);
insert into ticket_query_fixture select tenant_id,gen_random_uuid() from apticket.provision_tenant('Pagination A','Pagination owner','pagination-a@example.test','$2b$12$'||repeat('a',53));
insert into ticket_query_fixture select tenant_id,gen_random_uuid() from apticket.provision_tenant('Pagination B','Pagination other','pagination-b@example.test','$2b$12$'||repeat('a',53));
-- Individual denials belong to operators. Provisioned owners retain their
-- complete Admin access throughout this fixture.
insert into apticket.profiles(id,tenant_id,name,email)
select profile_id,tenant_id,'Pagination operator','pagination-operator-'||tenant_id::text||'@example.test'
from ticket_query_fixture;
insert into apticket.roles(tenant_id,name)
select tenant_id,'Pagination operator' from ticket_query_fixture;
insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r join ticket_query_fixture f on f.tenant_id=r.tenant_id
cross join apticket.permissions p
where r.name='Pagination operator' and p.module in ('tickets','clientes','contatos') and p.action='view';
insert into apticket.user_roles(user_id,tenant_id,role_id)
select f.profile_id,f.tenant_id,r.id from ticket_query_fixture f
join apticket.roles r on r.tenant_id=f.tenant_id and r.name='Pagination operator';
grant select on ticket_query_fixture to authenticated;
insert into apticket.companies(id,tenant_id,name) select 'ba300000-0000-4000-8000-000000000001',tenant_id,'Ação Clínica' from ticket_query_fixture order by profile_id limit 1;
-- Insert synthetic records without unrelated financial trigger side effects.
set local session_replication_role=replica;
insert into apticket.tickets(id,tenant_id,subject,status,priority,channel,created_at,company_id)
select ('ba400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.tenant_id,'Chamado '||n,
  'new','medium','manual',now()-interval '1 hour',c.id
from generate_series(1,1205) n cross join apticket.companies c where c.id='ba300000-0000-4000-8000-000000000001';
insert into apticket.contacts(id,tenant_id,name,email)
select 'ba500000-0000-4000-8000-000000000001',tenant_id,'Contato recente','pagination-contact@example.test' from apticket.companies where id='ba300000-0000-4000-8000-000000000001';
update apticket.tickets t set contact_id='ba500000-0000-4000-8000-000000000001',assigned_to=f.profile_id
from ticket_query_fixture f where t.id='ba400000-0000-4000-8000-000000000001' and f.tenant_id=t.tenant_id;
insert into apticket.tickets(tenant_id,subject,status,channel,created_at)
select tenant_id,'Other tenant private','new','manual',now() from ticket_query_fixture where tenant_id<>(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
set local session_replication_role=origin;
select set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'tenant_id',p.tenant_id,'app','apticket','role','authenticated','session_version',p.session_version)::text,true)
from apticket.profiles p join ticket_query_fixture f on f.profile_id=p.id and f.tenant_id=p.tenant_id
where p.tenant_id=(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
set local role authenticated;
do $test$
declare a jsonb; b jsonb; m jsonb;
begin
  a:=apticket.list_ticket_inbox(1,10,'','{}','number','asc');
  b:=apticket.list_ticket_inbox(2,10,'','{}','number','asc');
  assert (a->>'total')::int=1205 and jsonb_array_length(a->'items')=10;
  assert (a->'items'->0->>'number')::bigint < (b->'items'->0->>'number')::bigint;
  assert not exists(select 1 from jsonb_array_elements(a->'items') x join jsonb_array_elements(b->'items') y on x->>'id'=y->>'id');
  assert (apticket.list_ticket_inbox(9999,10,'','{}','created_at','desc')->>'page')::int=121;
  assert jsonb_array_length(apticket.list_ticket_inbox(9999,10,'','{}','created_at','desc')->'items')=5;
  assert (apticket.list_ticket_inbox(1,20,'acao clinica','{}','number','asc')->>'total')::int=1205;
  assert (apticket.list_ticket_inbox(1,10,'%','{}','number','asc')->>'total')::int=0;
  assert (apticket.list_ticket_inbox(1,10,'','{"status":["pending"]}','number','asc')->>'total')::int=0;
  assert (apticket.list_ticket_inbox(1,10,'Chamado 1205','{"channel":["manual"],"priority":["medium"]}','number','asc')->>'total')::int=1;
  assert apticket.list_ticket_inbox(1,10,'','{}','subject','asc')->'items'->1->>'subject'='Chamado 2', 'natural Portuguese sort puts 2 before 10';
  m:=apticket.get_ticket_metrics(14);
  assert (m->>'openCount')::int=1205 and (m->>'currentPeriodCount')::int=1205;
  assert (m->'summary'->>'last7Count')::int=1205;
  assert jsonb_array_length(m->'latest')=6 and jsonb_array_length(m->'volume')=14;
  assert m->'latest'=jsonb_path_query_array(apticket.list_ticket_inbox(1,10,'','{}','created_at','desc')->'items','$[0 to 5]'), 'recent rows preserve full inbox contract and stable tie ordering';
  assert m->'latest'->0->'companies'->>'name'='Ação Clínica' and m->'latest'->0->'contacts'->>'name'='Contato recente';
  assert m->'latest'->0->>'assigneeName' is not null, 'authorized related names remain present';
  assert (select sum((x->>'criados')::int) from jsonb_array_elements(m->'volume') x)=1205;
  begin perform apticket.list_ticket_inbox(1,11,'','{}','number','asc'); raise exception 'invalid size accepted'; exception when invalid_parameter_value then null; end;
  begin perform apticket.list_ticket_inbox(1,10,'','{}','number;drop table tickets','asc'); raise exception 'invalid sort accepted'; exception when invalid_parameter_value then null; end;
  begin perform apticket.list_ticket_inbox(1,10,'','{"unexpected":["x"]}','number','asc'); raise exception 'invalid filter accepted'; exception when invalid_parameter_value then null; end;
  begin perform apticket.get_ticket_metrics(365); raise exception 'invalid period accepted'; exception when invalid_parameter_value then null; end;
end $test$;
reset role;
select pass('server queries count all 1205 visible tickets, paginate stably, combine filters and bound payload');
-- Metrics should not need the full inbox endpoint (which counts and sorts the
-- entire visible list just to discard all but six rows).
revoke execute on function apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text) from authenticated;
set local role authenticated;
do $test$
declare m jsonb;
begin
  m:=apticket.get_ticket_metrics(14);
  assert (m->>'openCount')::int=1205 and jsonb_array_length(m->'latest')=6, 'dashboard is independent of the full inbox endpoint';
end $test$;
reset role;
grant execute on function apticket.list_ticket_inbox(integer,integer,text,jsonb,text,text) to authenticated;
select pass('metrics fetch at most six recent rows without calling the full inbox endpoint');
insert into apticket.user_permissions(user_id,tenant_id,permission_id,granted)
select f.profile_id,f.tenant_id,p.id,false from ticket_query_fixture f cross join apticket.permissions p
where f.tenant_id=(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001') and p.module='clientes' and p.action='view';
set local role authenticated;
do $test$
declare m jsonb;
begin
  m:=apticket.get_ticket_metrics(30);
  assert m->'latest'->0->'companies'='null'::jsonb, 'ticket visibility does not bypass company RLS';
  assert m->'latest'=jsonb_path_query_array(apticket.list_ticket_inbox(1,10,'','{}','created_at','desc')->'items','$[0 to 5]');
end $test$;
reset role;
delete from apticket.user_permissions u using apticket.permissions p,ticket_query_fixture f
where u.user_id=f.profile_id and u.permission_id=p.id and p.module='clientes' and p.action='view'
and f.tenant_id=(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
select pass('recent ticket names follow related-table RLS');
select set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'tenant_id',p.tenant_id,'app','apticket','role','authenticated','session_version',p.session_version)::text,true)
from apticket.profiles p join ticket_query_fixture f on f.profile_id=p.id and f.tenant_id=p.tenant_id
where p.tenant_id<>(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
set local role authenticated;
do $test$
begin
  assert (apticket.list_ticket_inbox(1,10,'','{}','number','asc')->>'total')::int=1;
  assert (apticket.get_ticket_metrics(7)->>'openCount')::int=1;
  assert jsonb_array_length(apticket.get_ticket_metrics(7)->'latest')=1;
  assert apticket.get_ticket_metrics(7)->'latest'=apticket.list_ticket_inbox(1,10,'','{}','created_at','desc')->'items';
end $test$;
reset role;
select pass('another tenant cannot see counts or rows from the first tenant');
create policy dashboard_test_hide_all on apticket.tickets as restrictive for select to authenticated using(false);
set local role authenticated;
do $test$
declare m jsonb;
begin
  m:=apticket.get_ticket_metrics(7);
  assert (m->>'openCount')::int=0 and m->'latest'='[]'::jsonb;
  assert jsonb_array_length(m->'volume')=7;
end $test$;
reset role;
drop policy dashboard_test_hide_all on apticket.tickets;
select pass('empty RLS-visible set returns no recent tickets');
-- Historical completions, invalid durations and SLA pauses must not be lost
-- behind the most recent 500/1000 tickets. Calendar buckets use Sao Paulo.
set local session_replication_role=replica;
insert into apticket.tickets(tenant_id,subject,status,channel,created_at,resolved_at,closed_at,tipo_atendimento,sla_resolution_due_at,sla_paused_at,resolution_summary,resolution_diagnosis,motivo_avulso)
select tenant_id,'Metric edge '||n,
  case when n=1 then 'resolved'::apticket.ticket_status when n in(2,3) then 'closed'::apticket.ticket_status else 'pending'::apticket.ticket_status end,
  'manual', now()-interval '40 days',
  case when n=1 then now()-interval '39 days' when n=3 then now()-interval '41 days' end,
  case when n=2 then now()-interval '38 days' end,
  (case when n=6 then 'avulso' else 'contratual' end)::apticket.tipo_atendimento,
  case when n between 4 and 6 then now()-interval '1 day' end,
  case when n=5 then now()-interval '2 days' end,'Synthetic completion','Synthetic diagnosis',
  case when n=6 then 'cliente_sem_contrato'::apticket.motivo_avulso end
from ticket_query_fixture cross join generate_series(1,7) n
where tenant_id<>(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
insert into apticket.tickets(tenant_id,subject,status,created_at,sla_resolution_due_at)
select tenant_id,'Timezone midnight','new',
  (((now() at time zone 'America/Sao_Paulo')::date-2)::timestamp+interval '23 hours 30 minutes') at time zone 'America/Sao_Paulo',now()+interval '1 day'
from ticket_query_fixture where tenant_id<>(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001');
set local session_replication_role=origin;
set local role authenticated;
do $test$
declare m jsonb; bucket text;
begin
  m:=apticket.get_ticket_metrics(7);
  assert (m->>'openCount')::int=6 and (m->>'finished')::int=3;
  assert (m->'summary'->>'resolutionSample')::int=2;
  assert (m->>'averageResolutionHours')::numeric=36;
  assert (m->>'slaAtRisk')::int=2, 'only unpaused contractual pending tickets, including the legacy fallback, are overdue';
  bucket:=to_char((now() at time zone 'America/Sao_Paulo')::date-2,'YYYY-MM-DD');
  assert (select (v->>'criados')::int from jsonb_array_elements(m->'volume') v where v->>'iso'=bucket)=1, '23:30 local belongs to the local calendar date';
end $test$;
reset role;
select pass('metrics include historical completions, reject negative durations, respect SLA pauses and local dates');
insert into apticket.user_permissions(user_id,tenant_id,permission_id,granted)
select f.profile_id,f.tenant_id,p.id,false from ticket_query_fixture f cross join apticket.permissions p
where f.tenant_id<>(select tenant_id from apticket.companies where id='ba300000-0000-4000-8000-000000000001') and p.module='tickets' and p.action='view';
set local role authenticated;
do $test$ begin
  begin perform apticket.get_ticket_metrics(7); raise exception 'permissionless metrics accepted'; exception when insufficient_privilege then null; end;
  begin perform apticket.list_ticket_inbox(); raise exception 'permissionless listing accepted'; exception when insufficient_privilege then null; end;
end $test$;
reset role;
select pass('authenticated users without tickets.view cannot query either endpoint');
set local role anon;
do $test$ begin
  begin perform apticket.get_ticket_metrics(7); raise exception 'anonymous access accepted'; exception when insufficient_privilege then null; end;
  begin perform apticket.list_ticket_inbox(1,10,'','{}','number','asc'); raise exception 'anonymous listing accepted'; exception when insufficient_privilege then null; end;
end $test$;
reset role;
select pass('anonymous access to aggregate and list functions is denied');
select * from finish();
rollback;
