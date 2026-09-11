begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(43);

insert into apticket.tenants(id,name,slug) values
 ('d1000000-0000-0000-0000-000000000001','Approval A','approval-a'),
 ('d1000000-0000-0000-0000-000000000002','Approval B','approval-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Solicitante','requester@example.test',true),
 ('d2000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','Aprovador Um','approver1@example.test',true),
 ('d2000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-000000000001','Aprovador Dois','approver2@example.test',true),
 ('d2000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-000000000001','Outro Financeiro','other@example.test',true),
 ('d2000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-000000000001','Somente Leitura','reader@example.test',true),
 ('d2000000-0000-0000-0000-000000000006','d1000000-0000-0000-0000-000000000002','Financeiro B','writer-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'd2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('d3000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Operadora A'),
 ('d3000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',true),
 ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000001',true),
 ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000003','d3000000-0000-0000-0000-000000000001',true),
 ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000004','d3000000-0000-0000-0000-000000000001',true),
 ('d1000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000005','d3000000-0000-0000-0000-000000000001',false),
 ('d1000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000006','d3000000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('d4000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Cliente Rateio');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values('d5000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
 'd4000000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date)
values('d5000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
 'd3000000-0000-0000-0000-000000000001','2026-01-01');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category)
values('d6000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001',
 'd3000000-0000-0000-0000-000000000001','Fornecedor Aprovacao','datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,
 billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at) values
 ('d7000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',
  'd6000000-0000-0000-0000-000000000001','Contrato completo','fixed',1,500,0,10,'2026-01-01','2026-12-31'),
 ('d7000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001',
  'd6000000-0000-0000-0000-000000000001','Contrato sem rateio','fixed',1,50,0,10,'2026-01-01','2026-12-31');
select apticket.generate_supplier_payable('d7000000-0000-0000-0000-000000000001','2026-02-01');
select apticket.save_supplier_allocation_rules('d7000000-0000-0000-0000-000000000001','2026-01-01',
 '[{"customer_contract_id":"d5000000-0000-0000-0000-000000000001","percentage":100}]');

select throws_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Invalida',100,50,'["d2000000-0000-0000-0000-000000000002"]')$$,'23514',null,'rejeita faixa invertida');
select throws_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Duplicada',0,999.99,'["d2000000-0000-0000-0000-000000000002","d2000000-0000-0000-0000-000000000002"]')$$,'23514',null,'rejeita aprovador duplicado');
select throws_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Sem acesso',0,999.99,'["d2000000-0000-0000-0000-000000000005"]')$$,'23514',null,'rejeita aprovador sem escrita financeira');
select lives_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Ate mil',0,999.99,'["d2000000-0000-0000-0000-000000000002","d2000000-0000-0000-0000-000000000003"]')$$,'salva alcada inferior');
select is((select count(*) from apticket.supplier_approval_policy_steps),2::bigint,'salva duas etapas sequenciais');
select is((select string_agg(approver_id::text,',' order by step_order) from apticket.supplier_approval_policy_steps),
 'd2000000-0000-0000-0000-000000000002,d2000000-0000-0000-0000-000000000003','preserva ordem dos aprovadores');
select throws_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Sobreposta',500,1500,'["d2000000-0000-0000-0000-000000000002"]')$$,'23514',null,'rejeita faixa sobreposta');
select lives_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Acima de mil',1000,null,'["d2000000-0000-0000-0000-000000000003"]')$$,'salva alcada sem limite superior');
select is((select count(*) from apticket.supplier_approval_policies),2::bigint,'mantem duas alcadas ativas');
select is((select count(*) from apticket.list_supplier_approval_approvers('d3000000-0000-0000-0000-000000000001')),4::bigint,'lista somente aprovadores elegiveis');

select lives_ok($$select apticket.submit_supplier_payable_for_approval((select id from apticket.supplier_payables where supplier_contract_id='d7000000-0000-0000-0000-000000000001' and cycle_start='2026-02-01'))$$,'envia lancamento rateado');
select is((select status from apticket.supplier_payables where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'),'awaiting_approval','lancamento aguarda aprovacao');
select is((select policy_name from apticket.supplier_payable_approval_requests where status='pending'),'Ate mil','seleciona alcada pelo valor');
select is((select count(*) from apticket.supplier_payable_approval_steps),2::bigint,'congela etapas da solicitacao');
select is((select string_agg(approver_name,',' order by step_order) from apticket.supplier_payable_approval_steps),'Aprovador Um,Aprovador Dois','congela nomes dos responsaveis');
select throws_ok($$update apticket.supplier_payables set status='paid' where cycle_start='2026-02-01'$$,'42501',null,'cliente nao altera pagamento diretamente');

select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'))$$,'42501',null,'usuario fora da etapa nao aprova');
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'),'Primeira etapa conferida')$$,'primeiro responsavel aprova');
select is((select status from apticket.supplier_payables where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'),'awaiting_approval','primeira etapa nao libera pagamento');
select is((select min(step_order) from apticket.supplier_payable_approval_steps where status='pending'),2::smallint,'segunda etapa passa a ser atual');
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'))$$,'segundo responsavel aprova');
select is((select status from apticket.supplier_payables where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'),'approved','ultima etapa aprova lancamento');
select is((select status from apticket.supplier_payable_approval_requests order by submitted_at limit 1),'approved','solicitacao fica aprovada');
select throws_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests order by submitted_at limit 1))$$,'23514',null,'solicitacao concluida nao e decidida novamente');

reset role;
select lives_ok($$update apticket.supplier_payables set status='paid' where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'$$,'pagamento e permitido depois da aprovacao');
select is((select status from apticket.supplier_payables where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'),'paid','lancamento aprovado pode ser pago');
select throws_ok($$update apticket.supplier_payables set status='scheduled' where cycle_start='2026-02-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'$$,'23514',null,'pagamento nao retrocede');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select apticket.generate_supplier_payable('d7000000-0000-0000-0000-000000000002','2026-02-01');
select throws_ok($$select apticket.submit_supplier_payable_for_approval((select id from apticket.supplier_payables where supplier_contract_id='d7000000-0000-0000-0000-000000000002'))$$,'23514',null,'rateio pendente bloqueia envio');
select apticket.generate_supplier_payable('d7000000-0000-0000-0000-000000000001','2026-03-01');
select apticket.submit_supplier_payable_for_approval((select id from apticket.supplier_payables where supplier_contract_id='d7000000-0000-0000-0000-000000000001' and cycle_start='2026-03-01'));
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.reject_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'),'x')$$,'23514',null,'rejeicao exige justificativa');
select lives_ok($$select apticket.reject_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'),'Documento fiscal divergente')$$,'responsavel rejeita com motivo');
select is((select status from apticket.supplier_payables where cycle_start='2026-03-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001'),'scheduled','rejeicao devolve lancamento para revisao');
select is((select rejection_reason from apticket.supplier_payable_approval_requests where status='rejected'),'Documento fiscal divergente','preserva motivo da rejeicao');
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.submit_supplier_payable_for_approval((select id from apticket.supplier_payables where supplier_contract_id='d7000000-0000-0000-0000-000000000001' and cycle_start='2026-03-01'))$$,'permite novo envio apos rejeicao');
select is((select count(*) from apticket.supplier_payable_approval_requests where supplier_payable_id=(select id from apticket.supplier_payables where cycle_start='2026-03-01' and supplier_contract_id='d7000000-0000-0000-0000-000000000001')),2::bigint,'mantem historico das tentativas');
select throws_ok($$select apticket.save_supplier_approval_policy((select id from apticket.supplier_approval_policies where name='Ate mil'),'d3000000-0000-0000-0000-000000000001','Ate mil',0,999.99,'["d2000000-0000-0000-0000-000000000002"]')$$,'23514',null,'alcada utilizada e imutavel');
select throws_ok($$select apticket.archive_supplier_approval_policy((select id from apticket.supplier_approval_policies where name='Ate mil'))$$,'23514',null,'alcada pendente nao e arquivada');

select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000005","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_approval_policies),2::bigint,'leitor financeiro consulta alcadas');
select throws_ok($$select apticket.save_supplier_approval_policy(null,'d3000000-0000-0000-0000-000000000001','Leitor',2000,3000,'["d2000000-0000-0000-0000-000000000002"]')$$,'42501',null,'leitor nao configura alcada');
select set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-000000000006","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_approval_policies),0::bigint,'outro tenant nao consulta alcadas');
select throws_ok($$select apticket.submit_supplier_payable_for_approval((select id from apticket.supplier_payables limit 1))$$,'P0002',null,'outro tenant nao acessa lancamento');
select throws_ok($$insert into apticket.supplier_approval_policies(tenant_id,operating_company_id,name,minimum_amount) values('d1000000-0000-0000-0000-000000000002','d3000000-0000-0000-0000-000000000002','Direta',0)$$,'42501',null,'cliente nao inclui alcada diretamente');
reset role;
select ok((select count(*)>=19 from apticket.financial_audit_log where entity_table in ('supplier_approval_policies','supplier_approval_policy_steps','supplier_payable_approval_requests','supplier_payable_approval_steps') and tenant_id='d1000000-0000-0000-0000-000000000001'),'configuracao e decisoes entram na auditoria');
set local role anon;
select throws_ok($$select count(*) from apticket.supplier_payable_approval_requests$$,'42501',null,'anonimo nao consulta aprovacoes');
select * from finish();
rollback;
