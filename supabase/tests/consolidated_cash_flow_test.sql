begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(24);

insert into apticket.tenants(id,name,slug) values
 ('fa100000-0000-0000-0000-000000000001','Cash Flow A','cash-flow-a'),
 ('fa100000-0000-0000-0000-000000000002','Cash Flow B','cash-flow-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Financeiro A','cash-a@example.test',true),
 ('fa200000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000002','Financeiro B','cash-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'fa200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fa300000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Operadora A'),
 ('fa300000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fa100000-0000-0000-0000-000000000001','fa200000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001',true),
 ('fa100000-0000-0000-0000-000000000002','fa200000-0000-0000-0000-000000000002','fa300000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fa400000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fa600000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-02-10','{}'),
 ('fa600000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','2026-02-01','2026-03-01','2026-02-01','2026-03-01',200,'2026-03-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em,updated_at) values
 ('fa700000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa600000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001','Cliente A','REC-001','Mensalidade janeiro','2026-01-01',100,100,'2020-02-10','faturado',now(),now()),
 ('fa700000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000001','fa600000-0000-0000-0000-000000000002','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001','Cliente A','REC-002','Mensalidade fevereiro','2026-02-01',200,0,'2026-03-10','recebido',now(),'2026-03-08');

insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category) values
 ('fa800000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','Fornecedor A','datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at) values
 ('fa900000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','Cloud','fixed',1,80,0,15,'2026-01-01');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('faa00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','fa900000-0000-0000-0000-000000000001','PAG-001','Cloud janeiro','2026-01-01','2026-02-01','2026-02-15','fixed',1,80,80,'complete','approved','{"supplier_name":"Fornecedor A"}'),
 ('faa00000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','fa900000-0000-0000-0000-000000000001','PAG-002','Cloud fevereiro','2026-02-01','2026-03-01','2026-03-15','fixed',1,80,80,'complete','paid','{"supplier_name":"Fornecedor A"}');
insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,holder_name,
 holder_tax_id,pix_key_type,pix_key,is_default) values
 ('fab00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','PIX','Fornecedor A','12345678000190','cnpj','12345678000190',true);
insert into apticket.supplier_payments(id,tenant_id,operating_company_id,supplier_id,supplier_payable_id,
 bank_account_id,status,payment_method,scheduled_date,scheduled_amount,bank_snapshot,scheduled_by_name,
 paid_at,paid_amount,reconciliation_status,difference_amount,transaction_reference,receipt_bucket,
 receipt_path,receipt_file_name,receipt_mime_type,receipt_size,settled_by,settled_by_name) values
 ('fac00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','faa00000-0000-0000-0000-000000000002','fab00000-0000-0000-0000-000000000001','paid','pix','2026-03-14',80,'{"label":"PIX"}','Financeiro A','2026-03-14 12:00:00+00',82,'difference',2,'TRX-2','supplier-payment-receipts','test/receipt.pdf','receipt.pdf','application/pdf',100,'fa200000-0000-0000-0000-000000000001','Financeiro A');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.cash_flow_entries),4::bigint,'consolida entradas e saidas');
select is((select count(*) from apticket.cash_flow_entries where direction='inflow'),2::bigint,'lista recebiveis como entradas');
select is((select count(*) from apticket.cash_flow_entries where direction='outflow'),2::bigint,'lista fornecedores como saidas');
select is((select cash_status from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000001'),'overdue','calcula recebivel vencido dinamicamente');
select is((select open_amount from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000001'),100.00::numeric,'preserva saldo aberto');
select is((select cash_status from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000002'),'realized','normaliza recebimento realizado');
select is((select realized_amount from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000002'),200.00::numeric,'calcula valor recebido');
select is((select realized_date from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000002'),'2026-03-08'::date,'usa atualizacao como data do recebimento');
select is((select source_type from apticket.cash_flow_entries where source_id='fa700000-0000-0000-0000-000000000002'),'recurring_receivable','identifica origem recorrente');
select is((select counterparty_name from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000001'),'Fornecedor A','congela nome do fornecedor');
select is((select planned_date from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),'2026-03-14'::date,'prioriza data programada do pagamento');
select is((select cash_status from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),'realized','normaliza pagamento realizado');
select is((select realized_amount from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),82.00::numeric,'usa valor efetivamente pago');
select is((select difference_amount from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),2.00::numeric,'expoe diferenca conciliada');
select is((select reconciliation_status from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),'difference','expoe situacao da conciliacao');
select is((select open_amount from apticket.cash_flow_entries where source_id='faa00000-0000-0000-0000-000000000002'),0.00::numeric,'pagamento realizado nao fica aberto');
select is((select sum(planned_amount) from apticket.cash_flow_entries where direction='inflow'),300.00::numeric,'totaliza entradas previstas');
select is((select sum(planned_amount) from apticket.cash_flow_entries where direction='outflow'),160.00::numeric,'totaliza saidas previstas');
select is((select sum(realized_amount) from apticket.cash_flow_entries where direction='inflow'),200.00::numeric,'totaliza entradas realizadas');
select is((select sum(realized_amount) from apticket.cash_flow_entries where direction='outflow'),82.00::numeric,'totaliza saidas realizadas');

select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.cash_flow_entries),0::bigint,'RLS isola outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.cash_flow_entries$$,'42501',null,'anonimo nao consulta fluxo');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.cash_flow_entries'::regclass),'visao respeita RLS das fontes');
select ok(not has_table_privilege('authenticated','apticket.cash_flow_entries','INSERT'),'visao nao permite escrita');

select * from finish();
rollback;
