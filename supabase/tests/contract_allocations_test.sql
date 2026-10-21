begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('ca100000-0000-0000-0000-000000000001','Rateios A','allocation-tests-a'),
 ('ca100000-0000-0000-0000-000000000002','Rateios B','allocation-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ca200000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios Admin','allocations-admin@example.test',true),
 ('ca200000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000002','Rateios B','allocations-other@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'ca200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('ca300000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios operadora A'),
 ('ca300000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000002','Rateios operadora B'),
 ('ca300000-0000-0000-0000-000000000003','ca100000-0000-0000-0000-000000000001','Rateios outra operadora');
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('ca400000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','10.01.0001','Categoria A','both'),
 ('ca400000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','10.01.0002','Categoria B','both'),
 ('ca400000-0000-0000-0000-000000000003','ca100000-0000-0000-0000-000000000002','ca300000-0000-0000-0000-000000000002','10.01.0001','Categoria outra tenant','both'),
 ('ca400000-0000-0000-0000-000000000004','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000003','10.01.0001','Categoria outra operadora','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('ca500000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','20.01.0001','Centro A'),
 ('ca500000-0000-0000-0000-000000000002','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','20.01.0002','Centro B');
insert into apticket.companies(id,tenant_id,name) values
 ('ca600000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','Rateios cliente');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ca200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('ca700000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100.01,10,'ca400000-0000-0000-0000-000000000001','ca500000-0000-0000-0000-000000000001');
insert into apticket.suppliers(id, tenant_id, legal_name, category) values
 ('ca800000-0000-0000-0000-000000000001', apticket_appsec.fixture_actor('ca100000-0000-0000-0000-000000000001'), 'Rateios fornecedor', 'software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,financial_category_id,cost_center_id) values
 ('ca900000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca800000-0000-0000-0000-000000000001','Rateios fornecedor fixo','fixed',1,100.01,0,10,'2026-01-01','2026-12-31','ca400000-0000-0000-0000-000000000001','ca500000-0000-0000-0000-000000000001');

-- MIGRATION CHECKPOINT: pre-deploy runner inserts the migration twice here.

select is((select percentage from apticket.contracts_category_allocations where contract_id='ca700000-0000-0000-0000-000000000001'),100::numeric,'cliente legado migrado com 100%');
select is((select percentage from apticket.contracts_cost_center_allocations where contract_id='ca700000-0000-0000-0000-000000000001'),100::numeric,'centro cliente legado migrado com 100%');
select is((select percentage from apticket.supplier_contracts_category_allocations where contract_id='ca900000-0000-0000-0000-000000000001'),100::numeric,'fornecedor legado migrado com 100%');
select is((select percentage from apticket.supplier_contracts_cost_center_allocations where contract_id='ca900000-0000-0000-0000-000000000001'),100::numeric,'centro fornecedor legado migrado com 100%');
create function pg_temp.categories(p_a numeric,p_b numeric default null) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item_id','ca400000-0000-0000-0000-000000000001','percentage',p_a))||
 case when p_b is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('item_id','ca400000-0000-0000-0000-000000000002','percentage',p_b)) end;
$$;
create function pg_temp.centers(p_a numeric,p_b numeric default null) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('item_id','ca500000-0000-0000-0000-000000000001','percentage',p_a))||
 case when p_b is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('item_id','ca500000-0000-0000-0000-000000000002','percentage',p_b)) end;
$$;
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction,is_active)
values('ca400000-0000-0000-0000-000000000005','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','10.01.0005','Categoria inativa','both',false);
set local role authenticated;
select lives_ok($$update apticket.contracts set category_allocations=pg_temp.categories(70,30),cost_center_allocations=pg_temp.centers(60,40) where id='ca700000-0000-0000-0000-000000000001'$$,'edita ambos os rateios cliente');
select lives_ok($$update apticket.supplier_contracts set category_allocations=pg_temp.categories(70,30),cost_center_allocations=pg_temp.centers(60,40) where id='ca900000-0000-0000-0000-000000000001'$$,'edita ambos os rateios fornecedor');
select is((select count(*) from apticket.contracts_category_allocations),2::bigint,'sincroniza categorias cliente');
select is((select count(*) from apticket.supplier_contracts_cost_center_allocations),2::bigint,'sincroniza centros fornecedor');
select throws_ok($$update apticket.contracts set monthly_value=999,category_allocations=pg_temp.categories(60,30) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita soma 90% no backend');
select is((select monthly_value from apticket.contracts where id='ca700000-0000-0000-0000-000000000001'),100.01::numeric,'erro reverte também os dados do contrato');
select throws_ok($$update apticket.supplier_contracts set cost_center_allocations=pg_temp.centers(70,40) where id='ca900000-0000-0000-0000-000000000001'$$,'23514',null,'centros exigem soma independente');
select throws_ok($$update apticket.contracts set category_allocations=pg_temp.categories(50)||pg_temp.categories(50) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita item duplicado');
select throws_ok($$update apticket.contracts set category_allocations=pg_temp.categories(0,100) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita zero');
select throws_ok($$update apticket.contracts set category_allocations=pg_temp.categories(-1,101) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita negativo');
select throws_ok($$update apticket.contracts set category_allocations=pg_temp.categories(101) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita acima de 100');
select throws_ok($$update apticket.contracts set category_allocations=pg_temp.categories(33.333,66.667) where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita terceira casa antes de arredondar');
select throws_ok($$update apticket.contracts set category_allocations='[]' where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'exige no mínimo um item');
select throws_ok($$update apticket.contracts set category_allocations='[{"item_id":"ca400000-0000-0000-0000-000000000003","percentage":100}]' where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita categoria de outra tenant');
select throws_ok($$update apticket.contracts set category_allocations='[{"item_id":"ca400000-0000-0000-0000-000000000004","percentage":100}]' where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'rejeita categoria de outra operadora');
select throws_ok($$delete from apticket.contracts_category_allocations$$,'42501',null,'API não altera filhos fora da transação do contrato');
select is((select sum(amount) from apticket.allocate_financial_amount(100.01,pg_temp.categories(70,30),pg_temp.centers(60,40))),100.01::numeric,'preserva total em centavos');
select is((select sum(amount) from apticket.allocate_financial_amount(100.01,pg_temp.categories(70,30),pg_temp.centers(60,40)) where category_id='ca400000-0000-0000-0000-000000000001'),70.01::numeric,'resto na maior categoria');
select is((select sum(amount) from apticket.allocate_financial_amount(100.01,pg_temp.categories(70,30),pg_temp.centers(60,40)) where center_id='ca500000-0000-0000-0000-000000000001'),60.01::numeric,'resto no maior centro independentemente');
select is((select sum(amount) from apticket.allocate_financial_amount(0.01,pg_temp.categories(50,50),pg_temp.centers(50,50))),0.01::numeric,'rateia um centavo com desempate determinístico');
select is((select sum(amount) from apticket.allocate_financial_amount(-100.01,pg_temp.categories(70,30),pg_temp.centers(60,40))),(-100.01)::numeric,'preserva valor negativo');
select lives_ok($$select apticket.generate_supplier_payable('ca900000-0000-0000-0000-000000000001','2026-11-01')$$,'geração real fornecedor aplica snapshot dos rateios');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_type='supplier_payable'),100.01::numeric,'fluxo fornecedor fecha total');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_type='supplier_payable' and financial_category_id='ca400000-0000-0000-0000-000000000001'),70.01::numeric,'fluxo fornecedor usa categoria rateada');
select is((select count(*) from apticket.cash_flow_entries where source_type='supplier_payable'),1::bigint,'API antiga mantém um documento');
reset role;
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('caa00000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca700000-0000-0000-0000-000000000001','2026-11-01','2026-12-01','2026-11-01','2026-12-01',100.01,'2026-11-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,status_cobranca,aprovado_em) values
 ('cab00000-0000-0000-0000-000000000001','ca100000-0000-0000-0000-000000000001','caa00000-0000-0000-0000-000000000001','ca300000-0000-0000-0000-000000000001','ca700000-0000-0000-0000-000000000001','ca600000-0000-0000-0000-000000000001','Rateios cliente','REC-RATEIO-001','Rateio recorrente','2026-11-01',100.01,100.01,'2026-11-10','faturado',now());
set local role authenticated;
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where direction='inflow'),100.01::numeric,'recebível rateado fecha total');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where direction='inflow' and cost_center_id='ca500000-0000-0000-0000-000000000001'),60.01::numeric,'recebível rateia centro independentemente');
select is((select sum(planned_result_amount) from apticket.financial_management_statement where direction='inflow'),100.01::numeric,'DRE mantém total cliente');
select is((select sum(planned_result_amount) from apticket.financial_management_statement where direction='inflow' and financial_category_id='ca400000-0000-0000-0000-000000000001'),70.01::numeric,'DRE respeita categoria cliente');
select lives_ok($$update apticket.contracts set category_allocations=pg_temp.categories(33.33,66.67),cost_center_allocations=pg_temp.centers(25,75) where id='ca700000-0000-0000-0000-000000000001'$$,'aceita percentuais decimais exatos');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where direction='inflow' and financial_category_id='ca400000-0000-0000-0000-000000000001'),70.01::numeric,'edição não muda lançamentos históricos');
select lives_ok($$update apticket.contracts set financial_category_id='ca400000-0000-0000-0000-000000000001',cost_center_id='ca500000-0000-0000-0000-000000000001' where id='ca700000-0000-0000-0000-000000000001'$$,'cliente antigo converte campos individuais em 100%');
select is((select count(*) from apticket.contracts_category_allocations),1::bigint,'edição remove itens antigos atomicamente');
select is((select percentage from apticket.contracts_category_allocations),100::numeric,'compatibilidade antiga mantém 100%');
select throws_ok($$select apticket.archive_financial_dimension('category','ca400000-0000-0000-0000-000000000001')$$,'23514',null,'vínculos ativos impedem arquivar categoria');
select throws_ok($$update apticket.contracts set category_allocations='[{"item_id":"ca400000-0000-0000-0000-000000000005","percentage":100}]' where id='ca700000-0000-0000-0000-000000000001'$$,'23514',null,'edição recusa item inativo');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where direction='inflow'),100.01::numeric,'histórico mantém valor depois da inativação');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ca200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select is((select count(*) from apticket.contracts_category_allocations),0::bigint,'RLS isola filhos cliente');
select is((select count(*) from apticket.supplier_contracts_category_allocations),0::bigint,'RLS isola filhos fornecedor');
select is((select count(*) from apticket.cash_flow_allocation_entries),0::bigint,'RLS isola lançamentos rateados');
select * from finish();
rollback;
