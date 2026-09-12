begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(32);

insert into apticket.tenants(id,name,slug) values
 ('fc100000-0000-0000-0000-000000000001','Fechamento A','fechamento-a'),
 ('fc100000-0000-0000-0000-000000000002','Fechamento B','fechamento-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fc200000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Financeiro A','closure-a@example.test',true),
 ('fc200000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000002','Financeiro B','closure-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select profile.id,profile.tenant_id,role.id
from apticket.profiles profile join apticket.roles role
  on role.tenant_id=profile.tenant_id and role.name='Financeiro'
where profile.id::text like 'fc200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fc300000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Operadora A'),
 ('fc300000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fc100000-0000-0000-0000-000000000001','fc200000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001',true),
 ('fc100000-0000-0000-0000-000000000002','fc200000-0000-0000-0000-000000000002','fc300000-0000-0000-0000-000000000002',true);
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('fc400000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','REC','Receita recorrente','inflow'),
 ('fc400000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','DESP','Despesa operacional','outflow');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fc500000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','ADM','Administrativo');
insert into apticket.companies(id,tenant_id,name) values
 ('fc600000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fc700000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',170,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fc700000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fc800000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',120,'2026-01-10','{}'),
 ('fc800000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','2026-02-01','2026-03-01','2026-02-01','2026-03-01',50,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em,updated_at) values
 ('fc900000-0000-0000-0000-000000000001','fc100000-0000-0000-0000-000000000001','fc800000-0000-0000-0000-000000000001','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','fc600000-0000-0000-0000-000000000001','Cliente A','REC-FEC-001','Mensalidade classificada','2026-01-01',120,0,'2026-01-10','recebido',now(),'2026-01-20'),
 ('fc900000-0000-0000-0000-000000000002','fc100000-0000-0000-0000-000000000001','fc800000-0000-0000-0000-000000000002','fc300000-0000-0000-0000-000000000001','fc700000-0000-0000-0000-000000000001','fc600000-0000-0000-0000-000000000001','Cliente A','REC-FEC-002','Mensalidade sem classificação','2026-02-01',50,0,'2026-02-10','recebido',now(),'2026-02-20');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fc900000-0000-0000-0000-000000000001','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',null)$$,'classifica receita de janeiro');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',100,null)$$,'inclui orçamento de receita');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','outflow','fc400000-0000-0000-0000-000000000002','fc500000-0000-0000-0000-000000000001',40,null)$$,'inclui orçamento de despesa');
select lives_ok($$select apticket.close_financial_period('fc300000-0000-0000-0000-000000000001','2026-01-01','Fechamento mensal conferido')$$,'encerra competência classificada');
select is((select count(*) from apticket.financial_period_closures where status='closed'),1::bigint,'grava um fechamento ativo');
select is((select status from apticket.financial_period_closures),'closed','marca período como encerrado');
select is((select revenue_realized from apticket.financial_period_closures),120.00::numeric,'consolida receita realizada');
select is((select result_budgeted from apticket.financial_period_closures),60.00::numeric,'consolida resultado orçado');
select is((select count(*) from apticket.financial_period_snapshot_lines),2::bigint,'preserva as linhas do demonstrativo');
select is((select count(*) from apticket.financial_management_statement where period_closure_id is not null),2::bigint,'demonstrativo identifica linhas encerradas');
select is((select sum(realized_result_amount) from apticket.financial_management_statement where period_month='2026-01-01'),120.00::numeric,'demonstrativo usa o snapshot');

reset role;
update apticket.contas_receber set valor_aberto=120,updated_at='2026-01-25'
where id='fc900000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is((select sum(realized_result_amount) from apticket.financial_management_statement where period_month='2026-01-01'),120.00::numeric,'alteração posterior não modifica período encerrado');
select throws_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',110,null)$$,'23514','A competência está encerrada. Reabra o período antes de alterar o orçamento.','bloqueia orçamento em período encerrado');
select throws_ok($$select apticket.clear_financial_entry_classification('recurring_receivable','fc900000-0000-0000-0000-000000000001')$$,'23514','A competência está encerrada. Reabra o período antes de alterar a classificação.','bloqueia reclassificação em período encerrado');
select throws_ok($$select apticket.close_financial_period('fc300000-0000-0000-0000-000000000001','2026-01-01',null)$$,'23505','Esta competência já está encerrada.','impede fechamento ativo duplicado');
select throws_ok(format($$select apticket.reopen_financial_period('%s','curta')$$,(select id from apticket.financial_period_closures where status='closed')),'23514','Informe uma justificativa com pelo menos 10 caracteres.','exige justificativa suficiente');
select lives_ok(format($$select apticket.reopen_financial_period('%s','Correção necessária após conciliação')$$,(select id from apticket.financial_period_closures where status='closed')),'reabre competência com justificativa');
select is((select status from apticket.financial_period_closures where revision=1),'reopened','mantém histórico da reabertura');
select is((select sum(realized_result_amount) from apticket.financial_management_statement where period_month='2026-01-01'),0.00::numeric,'período reaberto volta aos valores atuais');
select lives_ok($$select apticket.save_financial_budget_entry('fc300000-0000-0000-0000-000000000001','2026-01-01','inflow','fc400000-0000-0000-0000-000000000001','fc500000-0000-0000-0000-000000000001',110,null)$$,'permite orçamento após reabertura');
select lives_ok($$select apticket.close_financial_period('fc300000-0000-0000-0000-000000000001','2026-01-01','Novo fechamento após correção')$$,'encerra novamente a competência');
select is((select revision from apticket.financial_period_closures where status='closed'),2,'incrementa a revisão do fechamento');
select is((select count(*) from apticket.financial_period_closures where status='reopened'),1::bigint,'preserva a revisão anterior');
select throws_ok($$select apticket.close_financial_period('fc300000-0000-0000-0000-000000000001','2026-02-01',null)$$,'23514','Existem 1 movimento(s) sem classificação completa nesta competência.','impede fechamento com movimento sem classificação');

select set_config('request.jwt.claims','{"sub":"fc200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.financial_period_closures),0::bigint,'RLS isola fechamentos de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.financial_period_closures$$,'42501',null,'anônimo não consulta fechamentos');
reset role;
select ok(not has_function_privilege('anon','apticket.close_financial_period(uuid,date,text)','EXECUTE'),'anônimo não executa fechamento');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.financial_management_statement'::regclass),'demonstrativo continua respeitando RLS');
select ok((select relrowsecurity from pg_class where oid='apticket.financial_period_closures'::regclass),'RLS habilitada nos fechamentos');
select ok((select relrowsecurity from pg_class where oid='apticket.financial_period_snapshot_lines'::regclass),'RLS habilitada no snapshot');
select throws_ok($$update apticket.financial_period_snapshot_lines set realized_amount=999$$,'23514','As linhas do snapshot financeiro são imutáveis.','snapshot não pode ser alterado');
select cmp_ok((select count(*) from apticket.financial_audit_log where entity_table='financial_period_closures'),'>=',3::bigint,'registra fechamento, reabertura e novo fechamento na auditoria');

select * from finish();
rollback;
