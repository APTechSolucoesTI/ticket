begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(21);

insert into apticket.tenants(id,name,slug) values
 ('fd100000-0000-0000-0000-000000000001','Resultado A','resultado-a'),
 ('fd100000-0000-0000-0000-000000000002','Resultado B','resultado-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fd200000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','Financeiro A','result-a@example.test',true),
 ('fd200000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000002','Financeiro B','result-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'fd200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fd300000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','Operadora A'),
 ('fd300000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fd100000-0000-0000-0000-000000000001','fd200000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001',true),
 ('fd100000-0000-0000-0000-000000000002','fd200000-0000-0000-0000-000000000002','fd300000-0000-0000-0000-000000000002',true);
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('fd400000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','REC','Receita recorrente','inflow'),
 ('fd400000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','DESP','Despesa operacional','outflow');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fd500000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','ADM','Administrativo');

select set_config('request.jwt.claims','{"sub":"fd200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fd600000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fd700000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',170,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fd700000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fd800000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','fd700000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',120,'2026-01-10','{}'),
 ('fd800000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','fd700000-0000-0000-0000-000000000001','2026-02-01','2026-03-01','2026-02-01','2026-03-01',50,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em,updated_at) values
 ('fd900000-0000-0000-0000-000000000001','fd100000-0000-0000-0000-000000000001','fd800000-0000-0000-0000-000000000001','fd300000-0000-0000-0000-000000000001','fd700000-0000-0000-0000-000000000001','fd600000-0000-0000-0000-000000000001','Cliente A','REC-DRE-001','Mensalidade classificada','2026-01-01',120,0,'2026-01-10','recebido',now(),'2026-01-20'),
 ('fd900000-0000-0000-0000-000000000002','fd100000-0000-0000-0000-000000000001','fd800000-0000-0000-0000-000000000002','fd300000-0000-0000-0000-000000000001','fd700000-0000-0000-0000-000000000001','fd600000-0000-0000-0000-000000000001','Cliente A','REC-DRE-002','Mensalidade sem classificacao','2026-02-01',50,0,'2026-02-10','recebido',now(),'2026-02-20');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fd200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fd900000-0000-0000-0000-000000000001','fd400000-0000-0000-0000-000000000001','fd500000-0000-0000-0000-000000000001',null)$$,'classifica receita do demonstrativo');
select lives_ok($$select apticket.save_financial_budget_entry('fd300000-0000-0000-0000-000000000001','2026-01-01','inflow','fd400000-0000-0000-0000-000000000001','fd500000-0000-0000-0000-000000000001',100,null)$$,'orcamento de receita');
select lives_ok($$select apticket.save_financial_budget_entry('fd300000-0000-0000-0000-000000000001','2026-01-01','outflow','fd400000-0000-0000-0000-000000000002','fd500000-0000-0000-0000-000000000001',80,null)$$,'orcamento de despesa');
select is((select count(*) from apticket.financial_management_statement),3::bigint,'lista receitas, despesas e movimento sem classificacao');
select is((select fiscal_year from apticket.financial_management_statement where financial_category_code='REC'),2026,'expoe exercicio');
select is((select fiscal_month from apticket.financial_management_statement where financial_category_code='REC'),1,'expoe mes fiscal');
select is((select result_group from apticket.financial_management_statement where financial_category_code='REC'),'revenue','identifica grupo de receita');
select is((select budgeted_result_amount from apticket.financial_management_statement where financial_category_code='REC'),100.00::numeric,'receita orcada e positiva');
select is((select planned_result_amount from apticket.financial_management_statement where financial_category_code='REC'),120.00::numeric,'receita prevista e positiva');
select is((select realized_result_amount from apticket.financial_management_statement where financial_category_code='REC'),120.00::numeric,'receita realizada e positiva');
select is((select favorable_variance_amount from apticket.financial_management_statement where financial_category_code='REC'),20.00::numeric,'calcula desvio favoravel da receita');
select is((select favorable_variance_percent from apticket.financial_management_statement where financial_category_code='REC'),20.00::numeric,'calcula percentual favoravel da receita');
select is((select budgeted_result_amount from apticket.financial_management_statement where financial_category_code='DESP'),(-80.00)::numeric,'despesa orcada e negativa');
select is((select realized_result_amount from apticket.financial_management_statement where financial_category_code='DESP'),0.00::numeric,'despesa sem baixa permanece zerada');
select is((select favorable_variance_amount from apticket.financial_management_statement where financial_category_code='DESP'),80.00::numeric,'economia de despesa e favoravel');
select is((select count(*) from apticket.financial_management_statement where financial_category_id is null),1::bigint,'evidencia movimento sem classificacao');
select is((select sum(budgeted_result_amount) from apticket.financial_management_statement),20.00::numeric,'totaliza resultado orcado');
select is((select sum(realized_result_amount) from apticket.financial_management_statement),170.00::numeric,'totaliza resultado realizado');

select set_config('request.jwt.claims','{"sub":"fd200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.financial_management_statement),0::bigint,'RLS isola demonstrativo de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.financial_management_statement$$,'42501',null,'anonimo nao consulta demonstrativo');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.financial_management_statement'::regclass),'demonstrativo respeita RLS das fontes');

select * from finish();
rollback;
