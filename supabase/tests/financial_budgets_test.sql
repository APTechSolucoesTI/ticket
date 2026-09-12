begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(28);

insert into apticket.tenants(id,name,slug) values
 ('fc100000-0000-0000-0000-000000000001','Orcamento A','orcamento-a'),
 ('fc100000-0000-0000-0000-000000000002','Orcamento B','orcamento-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fc200000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Financeiro Escrita','budget-write@example.test',true),
 ('fc200000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000001','Financeiro Leitura','budget-read@example.test',true),
 ('fc200000-0000-0000-0000-000000000003','fc100000-0000-0000-0000-000000000002','Financeiro B','budget-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'fc200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fc300000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Operadora A'),
 ('fc300000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fc100000-0000-0000-0000-000000000001','fc200000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001',true),
 ('fc100000-0000-0000-0000-000000000001','fc200000-0000-0000-0000-000000000002','fc300000-0000-0000-0000-000000000001',false),
 ('fc100000-0000-0000-0000-000000000002','fc200000-0000-0000-0000-000000000003','fc300000-0000-0000-0000-000000000002',true);
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('fc400000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','REC','Receita recorrente','inflow'),
 ('fc400000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','DESP','Despesa operacional','outflow');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fc500000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','ADM','Administrativo');

select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fc600000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fc700000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fc700000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fc800000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-01-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em,updated_at) values
 ('fc900000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc800000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','fc600000-0000-0000-0000-000000000001','Cliente A','REC-BUDGET-001','Mensalidade','2026-01-01',100,40,'2026-01-10','faturado',now(),'2026-01-20');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fc900000-0000-0000-0000-000000000001','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',null)$$,'prepara recebivel classificado');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',50,'Meta inicial')$$,'cadastra orcamento de entrada');
select is((select budgeted_amount from apticket.financial_budget_variance where direction='inflow'),50.00::numeric,'expoe valor orcado');
select is((select planned_amount from apticket.financial_budget_variance where direction='inflow'),100.00::numeric,'agrega valor previsto');
select is((select realized_amount from apticket.financial_budget_variance where direction='inflow'),60.00::numeric,'agrega valor realizado');
select is((select variance_amount from apticket.financial_budget_variance where direction='inflow'),10.00::numeric,'calcula desvio absoluto');
select is((select variance_percent from apticket.financial_budget_variance where direction='inflow'),20.00::numeric,'calcula desvio percentual');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','outflow','fc400000-0000-0000-0000-000000000002','fc500000-0000-0000-0000-000000000001',80,null)$$,'cadastra orcamento de saida');
select is((select count(*) from apticket.financial_budget_variance),2::bigint,'consolida entradas e saidas');
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-15','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',50,null)$$,'23514','Informe uma competencia mensal valida.','rejeita data fora do primeiro dia');
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','other','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',50,null)$$,'23514','Informe uma natureza valida para o orcamento.','rejeita natureza invalida');
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',0,null)$$,'23514','Informe um valor orcado maior que zero.','rejeita valor zerado');
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-02-01','inflow','fc400000-0000-0000-0000-000000000002','fc500000-0000-0000-0000-000000000001',50,null)$$,'23514','Selecione uma categoria ativa compativel com a natureza.','rejeita categoria incompativel');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',70,'Meta revisada')$$,'revisa orcamento');
select is((select count(*) from apticket.financial_budget_entries where direction='inflow'),2::bigint,'preserva historico de revisoes');
select is((select count(*) from apticket.financial_budget_entries where direction='inflow' and replaced_at is null),1::bigint,'mantem uma versao vigente');
select is((select revision from apticket.financial_budget_entries where direction='inflow' and replaced_at is null),2,'incrementa numero da revisao');
select is((select budgeted_amount from apticket.financial_budget_variance where direction='inflow'),70.00::numeric,'comparativo usa versao vigente');
select is((select variance_amount from apticket.financial_budget_variance where direction='inflow'),(-10.00)::numeric,'recalcula desvio apos revisao');
select throws_ok($$update apticket.financial_budget_entries set budgeted_amount=1 where direction='inflow' and replaced_at is null$$,'42501',null,'cliente nao altera historico diretamente');
select lives_ok($$select apticket.clear_financial_budget_entry((select budget_entry_id from apticket.financial_budget_variance where direction='outflow'))$$,'remove item vigente');
select is((select count(*) from apticket.financial_budget_variance),1::bigint,'item sem movimento deixa o comparativo');

select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-02-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',50,null)$$,'42501','Sem permissao financeira para alterar o orcamento.','acesso somente leitura nao altera orcamento');
select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.financial_budget_entries),0::bigint,'RLS isola orcamento de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.financial_budget_entries$$,'42501',null,'anonimo nao consulta orcamento');
select throws_ok($$select * from apticket.financial_budget_variance$$,'42501',null,'anonimo nao consulta comparativo');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.financial_budget_variance'::regclass),'comparativo respeita RLS das fontes');
select ok(not has_table_privilege('authenticated','apticket.financial_budget_entries','INSERT'),'cliente nao insere orcamento diretamente');

select * from finish();
rollback;
