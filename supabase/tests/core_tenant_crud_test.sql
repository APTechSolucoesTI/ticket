begin;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ac100000-0000-4000-8000-000000000001','CRUD A','appsec-crud-a'),
 ('ac100000-0000-4000-8000-000000000002','CRUD B','appsec-crud-b');
insert into apticket.profiles(id,tenant_id,name,email) values
 ('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','CRUD admin','crud@example.test');
insert into apticket.user_roles(user_id,tenant_id,role_id)
 select 'ac200000-0000-4000-8000-000000000001',tenant_id,id from apticket.roles
 where tenant_id='ac100000-0000-4000-8000-000000000001' and name='Admin';
insert into apticket.companies(id,tenant_id,name) values
 ('ac300000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001','Parent A'),
 ('ac300000-0000-4000-8000-000000000002','ac100000-0000-4000-8000-000000000002','Parent B');

create temporary table matrix(table_name text,payload jsonb,edit_column text);
insert into matrix values
 ('companies','{"name":"CRUD company"}','name'),
 ('contacts','{"name":"CRUD contact"}','name'),
 ('sla_policies','{"name":"CRUD SLA"}','name'),
 ('tickets','{"subject":"CRUD ticket"}','subject'),
 ('stickers','{"name":"CRUD sticker","storage_path":"synthetic-gallery-fixture"}','name');
grant select on matrix to authenticated;

-- Build a real foreign row while the fixture bootstrap can see both tenants.
do $$declare r record; payload jsonb; columns text; expressions text;
begin
 for r in select * from matrix loop
  payload:=r.payload||jsonb_build_object('id','ac400000-0000-4000-8000-000000000002','tenant_id','ac100000-0000-4000-8000-000000000002');
  select string_agg(format('%I',key),','),string_agg(format('(jsonb_populate_record(null::apticket.%I,%L)).%I',r.table_name,payload::text,key),',')
   into columns,expressions from jsonb_object_keys(payload) key;
  execute format('insert into apticket.%I(%s) select %s',r.table_name,columns,expressions);
 end loop;
end $$;

create function pg_temp.crud_probe(tab text,payload jsonb,edit_column text) returns setof text
language plpgsql security invoker as $$
declare columns text; expressions text; statement text; affected integer; visible bigint;
 own_id uuid:='ac400000-0000-4000-8000-000000000001'; foreign_id uuid:='ac400000-0000-4000-8000-000000000002';
begin
 payload:=payload||jsonb_build_object('id',own_id,'tenant_id','ac100000-0000-4000-8000-000000000001');
 select string_agg(format('%I',key),','),string_agg(format('(jsonb_populate_record(null::apticket.%I,%L)).%I',tab,payload::text,key),',')
  into columns,expressions from jsonb_object_keys(payload) key;
 statement:=format('insert into apticket.%I(%s) select %s',tab,columns,expressions);
 return next lives_ok(statement,tab||': own insert positive control');
 execute format('select count(*) from apticket.%I where id=%L',tab,own_id) into visible;
 return next is(visible,1::bigint,tab||': own select positive control');
 execute format('select count(*) from apticket.%I where id=%L',tab,foreign_id) into visible;
 return next is(visible,0::bigint,tab||': foreign select denied');
 payload:=payload||jsonb_build_object('id',gen_random_uuid(),'tenant_id','ac100000-0000-4000-8000-000000000002');
 select string_agg(format('(jsonb_populate_record(null::apticket.%I,%L)).%I',tab,payload::text,key),',')
  into expressions from jsonb_object_keys(payload) key;
 return next throws_ok(format('insert into apticket.%I(%s) select %s',tab,columns,expressions),'42501',null,tab||': foreign insert denied');
 execute format('update apticket.%I set %I=%L where id=%L',tab,edit_column,'Edited positive control',own_id);
 get diagnostics affected=row_count;
 return next is(affected,1,tab||': own update positive control');
 execute format('update apticket.%I set %I=%L where id=%L',tab,edit_column,'Forbidden',foreign_id);
 get diagnostics affected=row_count;
 return next is(affected,0,tab||': foreign update denied');
 return next throws_ok(format('update apticket.%I set tenant_id=%L where id=%L',tab,'ac100000-0000-4000-8000-000000000002',own_id),'42501',null,tab||': cannot transfer tenant');
 execute format('delete from apticket.%I where id=%L',tab,foreign_id);
 get diagnostics affected=row_count;
 return next is(affected,0,tab||': foreign delete denied');
 if tab='tickets' then
  -- A ticket without a contract creates an avulso ledger. Its retention FK
  -- intentionally prevents physical deletion, even for an authorized admin.
  return next throws_ok(format('delete from apticket.%I where id=%L',tab,own_id),'23503',null,tab||': financial history prevents own physical deletion');
 else
  execute format('delete from apticket.%I where id=%L',tab,own_id);
  get diagnostics affected=row_count;
  return next is(affected,1,tab||': own delete positive control');
 end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ac200000-0000-4000-8000-000000000001","tenant_id":"ac100000-0000-4000-8000-000000000001","app":"apticket","role":"authenticated"}',true);
select pg_temp.crud_probe(table_name,payload,edit_column) from matrix;
reset role;
-- Independent catalog controls are not a substitute for row-level CRUD tests.
select ok(c.relrowsecurity,c.relname||': RLS enabled')
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='apticket' and c.relkind='r' order by c.relname;
select ok(exists(select 1 from pg_policy p where p.polrelid=c.oid and not p.polpermissive
 and pg_get_expr(p.polqual,p.polrelid) like '%session_is_current%'),c.relname||': restrictive session gate')
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='apticket' and c.relkind='r' order by c.relname;
select ok(c.reloptions @> array['security_invoker=true'],c.relname||': view respects invoker')
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='apticket' and c.relkind='v' order by c.relname;
select * from finish();
rollback;
