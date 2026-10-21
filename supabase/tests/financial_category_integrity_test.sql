begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
select ok(not exists(select 1 from apticket.financial_categories where tenant_id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and deleted_at is null and ((left(code,2)='01' and direction<>'inflow') or (left(code,2) in ('02','03','04') and direction<>'outflow'))),'APTech nature corrections are consistent');
select ok(not exists(select 1 from apticket.financial_categories where tenant_id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and deleted_at is null and nullif(btrim(description),'') is null),'APTech categories have usage guidance');
select ok(case when exists(select 1 from apticket.tenants where id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e') then (select count(*)=11 from apticket.financial_categories where tenant_id='80e28baa-41d8-4a50-9fb1-f5d8ac51a93e' and deleted_at is null and is_global and (code='01.04' or code like '01.04.%' or code='03.02' or code like '03.02.%')) else true end,'MSP additions are global and complete');
select ok(not has_function_privilege('anon','apticket.create_financial_category(uuid,uuid,text,text,text,boolean,boolean,text)','EXECUTE'),'anonymous cannot invoke new creation RPC');
select ok(not has_function_privilege('anon','apticket.get_financial_category_dependencies(uuid)','EXECUTE'),'anonymous cannot inspect dependencies');

insert into apticket.tenants(id,name,slug) values
 ('fc100000-0000-4000-8000-000000000001','Category validation A','category-validation-a'),
 ('fc100000-0000-4000-8000-000000000002','Category validation B','category-validation-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','Editor','category-editor@example.test',true),
 ('fc200000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','Reader','category-reader@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
 select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id='fc200000-0000-4000-8000-000000000001';
insert into apticket.roles(id,tenant_id,name) values ('fc600000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','Category read only');
insert into apticket.role_permissions(role_id,permission_id) select 'fc600000-0000-4000-8000-000000000001',id from apticket.permissions where module in ('financeiro','financeiro_fluxo_caixa') and action='view';
insert into apticket.user_roles(user_id,tenant_id,role_id) values ('fc200000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','fc600000-0000-4000-8000-000000000001');
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fc300000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','Category company A'),
 ('fc300000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000002','Category company B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001',true),
 ('fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001',false);
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction,classification_type,is_global) values
 ('fc400000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','01','Income','inflow','synthetic',true),
 ('fc400000-0000-4000-8000-000000000002','fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','01.01','Services','inflow','synthetic',true),
 ('fc400000-0000-4000-8000-000000000003','fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','01.01.0001','Existing service','inflow','analytic',true),
 ('fc400000-0000-4000-8000-000000000004','fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','02','Local expense','outflow','synthetic',false),
 ('fc400000-0000-4000-8000-000000000005','fc100000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000002','01','Other tenant','inflow','synthetic',true);
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fc500000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','01.01.0001','Operations');
insert into apticket.financial_budget_entries(tenant_id,operating_company_id,period_month,direction,financial_category_id,financial_category_code,financial_category_name,cost_center_id,cost_center_code,cost_center_name,budgeted_amount,revision,created_by_name)
 values('fc100000-0000-4000-8000-000000000001','fc300000-0000-4000-8000-000000000001','2026-10-01','inflow','fc400000-0000-4000-8000-000000000003','01.01.0001','Existing service','fc500000-0000-4000-8000-000000000001','01.01.0001','Operations',100,1,'Editor');

set local role authenticated;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fc200000-0000-4000-8000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000002','  New   service  ','inflow','Useful guidance',true,true,'analytic')$$,'creates a child and normalizes whitespace');
select is((select code from apticket.financial_categories where name='New service'),'01.01.0002','reserves next code on server');
select lives_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000002','Detailed grouping','inflow',null,true,true,'synthetic')$$,'third-level synthetic remains supported');
select is((select code from apticket.financial_categories where name='Detailed grouping'),'01.01.0003','consecutive creations use distinct codes');
select lives_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001',null,'New root','both',null,true,true,'synthetic')$$,'creates root automatically');
select is((select code from apticket.financial_categories where name='New root'),'03','root allocation preserves existing local groups');
select throws_ok($$select apticket.save_financial_category(null,'fc300000-0000-4000-8000-000000000001','99.01.0001','Orphan','inflow',null,true,true,'analytic')$$,'23514',null,'rejects missing parent');
select throws_ok($$select apticket.save_financial_category(null,'fc300000-0000-4000-8000-000000000001','01.01.0004','Wrong nature','outflow',null,true,true,'analytic')$$,'23514',null,'rejects nature inconsistent with parent');
select throws_ok($$select apticket.save_financial_category(null,'fc300000-0000-4000-8000-000000000001','02.01','Global child','outflow',null,true,true,'synthetic')$$,'23514',null,'rejects global child of local parent');
select throws_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000003','Invalid child','inflow',null,true,true,'analytic')$$,'23514',null,'analytic cannot be parent');
select throws_ok($$select apticket.save_financial_category(null,'fc300000-0000-4000-8000-000000000001','01.01.0001','Duplicate','inflow',null,true,true,'analytic')$$,'23505',null,'rejects overlapping code');
select throws_ok($$select apticket.save_financial_category('fc400000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001','01.02','Services','inflow',null,true,true,'synthetic')$$,'23514',null,'cannot recode group with children');
select throws_ok($$select apticket.save_financial_category('fc400000-0000-4000-8000-000000000002','fc300000-0000-4000-8000-000000000001','01.01','Services','inflow',null,true,false,'synthetic')$$,'23514',null,'cannot deactivate group with active children');
select throws_ok($$select apticket.archive_financial_dimension('category','fc400000-0000-4000-8000-000000000002')$$,'23514',null,'cannot archive group with children');
select is((apticket.get_financial_category_dependencies('fc400000-0000-4000-8000-000000000002')->>'children')::int,3,'reports children for confirmation');
select is((apticket.get_financial_category_dependencies('fc400000-0000-4000-8000-000000000003')->>'active_links')::int,1,'detects budget dependency');
select throws_ok($$select apticket.archive_financial_dimension('category','fc400000-0000-4000-8000-000000000003')$$,'23514',null,'cannot archive category with active budget');
select throws_ok($$select apticket.save_financial_category('fc400000-0000-4000-8000-000000000003','fc300000-0000-4000-8000-000000000001','01.01.0001','Existing service','inflow',null,true,false,'analytic')$$,'23514',null,'cannot inactivate category with active budget');
select lives_ok($$select apticket.save_financial_category('fc400000-0000-4000-8000-000000000003','fc300000-0000-4000-8000-000000000001','01.01.0001','Existing service','inflow','Updated instructions',true,true,'analytic')$$,'description can be improved without rewriting linked identities');
select throws_ok($$select apticket.get_financial_category_dependencies('fc400000-0000-4000-8000-000000000005')$$,'42501',null,'dependency lookup is tenant scoped');
select throws_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000002',null,'Foreign','inflow',null,true,true,'synthetic')$$,'42501',null,'cannot create for another tenant');
select lives_ok($$select apticket.archive_financial_dimension('category',(select id from apticket.financial_categories where name='New service'))$$,'unlinked leaf can be archived');
select is((select count(*) from apticket.financial_categories where name='New service' and deleted_at is null),0::bigint,'archived leaf disappears from active catalog');
select lives_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001','fc400000-0000-4000-8000-000000000002','After archive','inflow',null,true,true,'analytic')$$,'creation continues after archival');
select is((select code from apticket.financial_categories where name='After archive'),'01.01.0004','archived code is not reused');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fc200000-0000-4000-8000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001',null,'Read only','inflow',null,true,true,'synthetic')$$,'42501',null,'read-only user cannot create');
select throws_ok($$select apticket.get_financial_category_dependencies('fc400000-0000-4000-8000-000000000001')$$,'42501',null,'read-only user cannot inspect maintenance dependencies');
select throws_ok($$select apticket_finance_private.category_dependencies('fc100000-0000-4000-8000-000000000002','fc400000-0000-4000-8000-000000000005')$$,'42501',null,'private helper is not callable');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select apticket.create_financial_category('fc300000-0000-4000-8000-000000000001',null,'Anonymous','inflow',null,true,true,'synthetic')$$,'42501',null,'requires authenticated user');
select * from finish();
rollback;
