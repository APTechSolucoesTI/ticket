begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(55);

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
 ('fb300000-0000-0000-0000-000000000003','fb100000-0000-0000-0000-000000000001','Operadora A2'),
 ('fb300000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fb100000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001',true),
 ('fb100000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000002','fb300000-0000-0000-0000-000000000001',false),
 ('fb100000-0000-0000-0000-000000000002','fb200000-0000-0000-0000-000000000003','fb300000-0000-0000-0000-000000000002',true);

select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
insert into apticket.companies(id,tenant_id,name) values
 ('fb400000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Cliente A');
-- Contratos novos exigem classificações analíticas, herdadas pelos movimentos.
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('fbb00000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','99.01.0001','Categoria inicial','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fbc00000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','99.01.0001','Centro inicial');
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('fb500000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10,'fbb00000-0000-0000-0000-000000000001','fbc00000-0000-0000-0000-000000000001');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fb600000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em) values
 ('fb700000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','Cliente A','REC-CLASS-001','Mensalidade','2026-01-01',100,100,'2026-02-10','faturado',now());
insert into apticket.suppliers(id, tenant_id, legal_name, category) values
 ('fb800000-0000-0000-0000-000000000001', apticket_appsec.fixture_actor('fb100000-0000-0000-0000-000000000001'), 'Fornecedor A', 'datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at,financial_category_id,cost_center_id) values
 ('fb900000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','Cloud','fixed',1,80,0,15,'2026-01-01','fbb00000-0000-0000-0000-000000000001','fbc00000-0000-0000-0000-000000000001');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('fba00000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','fb900000-0000-0000-0000-000000000001','PAG-CLASS-001','Cloud janeiro','2026-01-01','2026-02-01','2026-02-15','fixed',1,80,80,'complete','approved','{"supplier_name":"Fornecedor A"}'),
 ('fba00000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb800000-0000-0000-0000-000000000001','fb900000-0000-0000-0000-000000000001','PAG-CLASS-002','Cloud fevereiro','2026-02-01','2026-03-01','2026-03-15','fixed',1,80,80,'complete','approved','{"supplier_name":"Fornecedor A"}');

-- Category creation now requires an explicit, compatible hierarchy.
insert into apticket.financial_categories(tenant_id,operating_company_id,code,name,direction,is_global,classification_type)
select 'fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001',v.code,v.name,v.direction,v.is_global,'synthetic'
from (values ('01','Entradas','inflow',false),('01.00','Receitas de serviços','inflow',false),
 ('02','Saídas','outflow',false),('02.00','Despesas','outflow',false),
 ('03','Movimentos gerais','both',false),('03.00','Classificações gerais','both',false),
 ('11','Grupo detalhado','inflow',false),('11.01','Subgrupo detalhado','inflow',false),
 ('07','Saídas globais','outflow',true),('07.00','Despesas globais','outflow',true)) v(code,name,direction,is_global);
set local role authenticated;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','01.01.0001','Administrativo','Custos administrativos')$$,'cadastra centro de custo');
select is((select code from apticket.financial_cost_centers where name='Administrativo'),'01.01.0001','preserva codigo mascarado do centro de custo');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','01.00.0001','Receitas recorrentes','inflow',null)$$,'cadastra categoria de entrada');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','02.00.0001','Despesas operacionais','outflow',null)$$,'cadastra categoria de saida');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','03.00.0001','Classificacao geral','both',null)$$,'cadastra categoria de ambas naturezas');
select is((select code from apticket.financial_categories where name='Receitas recorrentes'),'01.00.0001','preserva codigo mascarado da categoria');
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','01.01.0001','Outro administrativo',null)$$,'23505','Ja existe um centro de custo com este codigo no escopo informado.','impede codigo duplicado');
select throws_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','09.00.0001','Invalida','invalid',null)$$,'23514','Revise código, nome, natureza e tipo da categoria.','valida natureza da categoria');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','10','Receitas','inflow',null,true,true,'synthetic')$$,'cadastra categoria sintetica de primeiro nivel');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','10.01','Servicos','inflow',null,true,true,'synthetic')$$,'cadastra categoria sintetica de segundo nivel');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','10.01.0001','Contratos gerenciados MRR','inflow',null,true,true,'analytic')$$,'cadastra categoria analitica de terceiro nivel');
select throws_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','11','Analitica invalida','inflow',null,false,true,'analytic')$$,'23514','Revise código, nome, natureza e tipo da categoria.','impede categoria analitica fora do terceiro nivel');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','11.01.0001','Sintetica detalhada','inflow',null,false,true,'synthetic')$$,'cadastra categoria sintetica no terceiro nivel');
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','1.1.1','Codigo invalido',null)$$,'23514','Informe codigo no formato 99.99.9999, nome e tipo validos para o centro de custo.','exige mascara completa do codigo');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','10','Administracao','Centro sintetico principal',true,true,'synthetic')$$,'cadastra centro sintetico de primeiro nivel');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','10.01','Tecnologia',null,true,true,'synthetic')$$,'cadastra centro sintetico de segundo nivel');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','10.01.0001','Suporte tecnico',null,true,true,'analytic')$$,'cadastra centro analitico de terceiro nivel');
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','11','Analitico invalido',null,false,true,'analytic')$$,'23514','Use codigos 99, 99.99 ou 99.99.9999 para centros de custo sinteticos e 99.99.9999 para centros de custo analiticos.','impede centro analitico fora do terceiro nivel');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','11.01.0001','Sintetico detalhado',null,false,true,'synthetic')$$,'cadastra centro sintetico no terceiro nivel');
select throws_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','11.01.0001','Duplicada','inflow',null,false,true,'synthetic')$$,'23505',null,'impede categoria sintetica duplicada no terceiro nivel');
select throws_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','11.01.0001','Duplicado',null,false,true,'synthetic')$$,'23505',null,'impede centro sintetico duplicado no terceiro nivel');
select lives_ok($$select apticket.save_financial_category((select id from apticket.financial_categories where code='11.01.0001'),'fb300000-0000-0000-0000-000000000001','11.01.0001','Sintetica editada','inflow',null,false,true,'synthetic')$$,'edita categoria sintetica de terceiro nivel');
select lives_ok($$select apticket.save_financial_cost_center((select id from apticket.financial_cost_centers where code='11.01.0001'),'fb300000-0000-0000-0000-000000000001','11.01.0001','Sintetico editado',null,false,true,'synthetic')$$,'edita centro sintetico de terceiro nivel');
select throws_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='11.01.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'23514','Selecione uma categoria analitica ativa compativel com o movimento.','categoria sintetica de terceiro nivel nao recebe lancamento');
select throws_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='01.00.0001'),(select id from apticket.financial_cost_centers where code='11.01.0001'),null)$$,'23514','Selecione um centro de custo analitico ativo desta empresa.','centro sintetico de terceiro nivel nao recebe lancamento');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000001','05','Grupo sintetico','outflow',null,false,true,'synthetic')$$,'cadastra categoria sintetica');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','05.01','Centro sintetico',null,false,true,'synthetic')$$,'cadastra centro sintetico');
select throws_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000002',(select id from apticket.financial_categories where code='05'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'23514','Selecione uma categoria analitica ativa compativel com o movimento.','categoria sintetica nao recebe lancamento');
select throws_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000002',(select id from apticket.financial_categories where code='02.00.0001'),(select id from apticket.financial_cost_centers where code='05.01'),null)$$,'23514','Selecione um centro de custo analitico ativo desta empresa.','centro sintetico nao recebe lancamento');
select lives_ok($$select apticket.save_financial_category(null,'fb300000-0000-0000-0000-000000000003','07.00.0001','Despesa global','outflow',null,true,true,'analytic')$$,'cadastra categoria global em outra operadora');
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000003','07.01.0001','Centro global',null,true,true,'analytic')$$,'cadastra centro global em outra operadora');
select lives_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000002',(select id from apticket.financial_categories where code='07.00.0001'),(select id from apticket.financial_cost_centers where code='07.01.0001'),null)$$,'classifica movimento com dimensoes globais de outra operadora');
select throws_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='02.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'23514','Selecione uma categoria analitica ativa compativel com o movimento.','rejeita categoria de saida para recebivel');
select throws_ok($$select apticket.classify_financial_entry('measurement_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='01.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'P0002','Movimento financeiro nao encontrado nesta origem.','rejeita origem divergente');
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='01.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),'Contrato mensal')$$,'classifica recebivel');
select is((select financial_category_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'01.00.0001','fluxo expoe categoria atual');
select is((select cost_center_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'01.01.0001','fluxo expoe centro de custo atual');
select lives_ok($$select apticket.classify_financial_entry('recurring_receivable','fb700000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='03.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),'Reclassificacao')$$,'reclassifica sem perder historico');
select is((select count(*) from apticket.financial_entry_classifications where source_id='fb700000-0000-0000-0000-000000000001'),3::bigint,'mantem classificacao herdada e duas versoes manuais');
select is((select count(*) from apticket.financial_entry_classifications where source_id='fb700000-0000-0000-0000-000000000001' and replaced_at is null),1::bigint,'mantem somente uma classificacao atual');
select is((select financial_category_code from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'03.00.0001','fluxo usa classificacao mais recente');
select lives_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000001',(select id from apticket.financial_categories where code='02.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'classifica conta a pagar');
select is((apticket.get_financial_category_dependencies((select id from apticket.financial_categories where code='02.00.0001'))->>'active_links')::int,1,'detecta lançamento a pagar ainda aberto');
select throws_ok($$select apticket.archive_financial_dimension('category',(select id from apticket.financial_categories where code='02.00.0001'))$$,'23514',null,'preserva categoria vinculada a lançamento aberto');
select throws_ok($$select apticket.save_financial_category((select id from apticket.financial_categories where code='03.00.0001'),'fb300000-0000-0000-0000-000000000001','03.00.0001','Geral alterada','both',null)$$,'23514','Categoria com vínculos: preserve código, nome, natureza, abrangência e tipo. A descrição pode ser atualizada.','impede alteracao estrutural de categoria utilizada');
select lives_ok($$select apticket.archive_financial_dimension('cost_center',(select id from apticket.financial_cost_centers where code='01.01.0001'))$$,'arquiva dimensao utilizada preservando historico');
select is((select cost_center_code from apticket.cash_flow_entries where source_id='fba00000-0000-0000-0000-000000000001'),'01.01.0001','snapshot arquivado permanece no fluxo');
select throws_ok($$select apticket.classify_financial_entry('supplier_payable','fba00000-0000-0000-0000-000000000002',(select id from apticket.financial_categories where code='02.00.0001'),(select id from apticket.financial_cost_centers where code='01.01.0001'),null)$$,'23514','Selecione um centro de custo analitico ativo desta empresa.','nao reutiliza centro de custo arquivado');
select lives_ok($$select apticket.clear_financial_entry_classification('recurring_receivable','fb700000-0000-0000-0000-000000000001')$$,'remove classificacao atual');
select ok((select classification_id is null from apticket.cash_flow_entries where source_id='fb700000-0000-0000-0000-000000000001'),'fluxo volta a exibir movimento sem classificacao');

select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fb200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.save_financial_cost_center(null,'fb300000-0000-0000-0000-000000000001','09.09.0001','Financeiro da tenant',null)$$,'papel Financeiro mantem acesso de escrita na tenant');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"fb200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select is((select count(*) from apticket.financial_categories),0::bigint,'RLS isola categorias de outra tenant');
select is((select count(*) from apticket.financial_entry_classifications),0::bigint,'RLS isola historico de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.financial_cost_centers$$,'42501',null,'anonimo nao consulta dimensoes');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.cash_flow_entries'::regclass),'visao consolidada continua respeitando RLS');

select * from finish();
rollback;
