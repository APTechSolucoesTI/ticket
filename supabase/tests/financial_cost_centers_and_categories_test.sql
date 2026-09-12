begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(29);

insert into apticket.tenants(id,name,slug) values
 ('fb100000-0000-0000-0000-000000000001','Classificacao A','classificacao-a'),
 ('fb100000-0000-0000-0000-000000000002','Classificacao B','classificacao-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fb200000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Financeiro Escrita','classificacao-write@example.test',true),
 ('fb200000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000001','Financeiro Leitura','classificacao-read@example.test',true),
 ('fb200000-0000-0000-0000-000000000003','fb100000-0000-0000-0000-000000000002','Financeiro B','classificacao-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'fb200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fb300000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Operadora A'),
 ('fb300000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fb100000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001',true),
 ('fb100000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000002','fb300000-0000-0000-0000-000000000001',false),
 ('fb100000-0000-0000-0000-000000000002','fb200000-0000-0000-0000-000000000003','fb300000-0000-0000-0000-000000000002',true);

select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fb400000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fb500000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fb500000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fb600000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em) values
 ('fb700000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','Cliente A','REC-CLASS-001','Mensalidade','2026-01-01',100,100,'2026-02-10','faturado',now());
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category) values
 ('fb800000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','Fornecedor A','datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at) values
 ('fb900000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','Cloud','fixed',1,80,0,15,'2026-01-01');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('fba00000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','fb900000-0000-0000-0000-000000000001','PAG-CLASS-001','Cloud janeiro','2026-01-01','2026-02-01','2026-02-15','fixed',1,80,80,'complete','approved','{"supplier_name":"Fornecedor A"}'),
 ('fba00000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','fb900000-0000-0000-0000-000000000001','PAG-CLASS-002','Cloud fevereiro','2026-02-01','2026-03-01','2026-03-15','fixed',1,80,80,'complete','approved','{"supplier_name":"Fornecedor A"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','adm','Administrativo','Custos administrativos')$$,'cadastra centro de custo');
select is((select code from apticket.financial_cost_centers),'ADM','normaliza codigo do centro de custo');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','rec','Receitas recorrentes','inflow',null)$$,'cadastra categoria de entrada');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','desp','Despesas operacionais','outflow',null)$$,'cadastra categoria de saida');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','geral','Classificacao geral','both',null)$$,'cadastra categoria de ambas naturezas');
select is((select code from apticket.financial_categories where name='Receitas recorrentes'),'REC','normaliza codigo da categoria');
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','ADM','Outro administrativo',null)$$,'23505','Ja existe um centro de custo com este codigo.','impede codigo duplicado');
select throws_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','INV','Invalida','invalid',null)$$,'23514','Informe codigo, nome e natureza validos para a categoria.','valida natureza da categoria');
select throws_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='DESP'),(select id from apticket.financial_cost_centers where code='ADM'),null)$$,'23514','Selecione uma categoria ativa compativel com o movimento.','rejeita categoria de saida para recebivel');
select throws_ok($$select apticket.classify_financial_entry('measurement_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='REC'),(select id from apticket.financial_cost_centers where code='ADM'),null)$$,'P0002','Movimento financeiro nao encontrado nesta origem.','rejeita origem divergente');
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='REC'),(select id from apticket.financial_cost_centers where code='ADM'),'Contrato mensal')$$,'classifica recebivel');
select is((select financial_category_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'REC','fluxo expoe categoria atual');
select is((select cost_center_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'ADM','fluxo expoe centro de custo atual');
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='GERAL'),(select id from apticket.financial_cost_centers where code='ADM'),'Reclassificacao')$$,'reclassifica sem perder historico');
select is((select count(*) from apticket.financial_entry_classifications where source_id='fb700000-0000-0000-0000-000000000001'),2::bigint,'mantem duas versoes da classificacao');
select is((select count(*) from apticket.financial_entry_classifications where source_id='fb700000-0000-0000-0000-000000000001' and replaced_at is null),1::bigint,'mantem somente uma classificacao atual');
select is((select financial_category_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'GERAL','fluxo usa classificacao mais recente');
select lives_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='DESP'),(select id from apticket.financial_cost_centers where code='ADM'),null)$$,'classifica conta a pagar');
select throws_ok($$select apticket.save_financial_category((select id from apticket.financial_categories where code='GERAL'),'fb300000-0000-0000-0000-000000000001','GERAL','Geral alterada','both',null)$$,'23514','Esta categoria ja foi utilizada e nao pode ser alterada. Crie um novo cadastro.','impede alteracao de categoria utilizada');
select lives_ok($$select apticket.archive_financial_dimension('cost_center',(select id from apticket.financial_cost_centers where code='ADM'))$$,'arquiva dimensao utilizada preservando historico');
select is((select cost_center_code from apticket.cash_flow_entries where source_id='fba00000-0000-0000-0000-000000000001'),'ADM','snapshot arquivado permanece no fluxo');
select throws_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000002',(select id from apticket.financial_categories where code='DESP'),(select id from apticket.financial_cost_centers where code='ADM'),null)$$,'23514','Selecione um centro de custo ativo desta empresa.','nao reutiliza centro de custo arquivado');
select lives_ok($$select apticket.clear_financial_entry_classification('recurring_receivable','fb700000-0000-0000-0000-000000000001')$$,'remove classificacao atual');
select ok((select classification_id is null from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'fluxo volta a exibir movimento sem classificacao');

select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','LEIT','Somente leitura',null)$$,'42501','Sem permissao financeira para configurar centros de custo.','acesso somente leitura nao configura dimensoes');
select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.financial_categories),0::bigint,'RLS isola categorias de outra tenant');
select is((select count(*) from apticket.financial_entry_classifications),0::bigint,'RLS isola historico de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.financial_cost_centers$$,'42501',null,'anonimo nao consulta dimensoes');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.cash_flow_entries'::regclass),'visao consolidada continua respeitando RLS');

select * from finish();
rollback;
