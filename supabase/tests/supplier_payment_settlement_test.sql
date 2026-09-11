begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(30);

insert into apticket.tenants(id,name,slug) values
 ('e1000000-0000-0000-0000-000000000001','Payments A','payments-a'),
 ('e1000000-0000-0000-0000-000000000002','Payments B','payments-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('e2000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Financeiro A','finance-a@example.test',true),
 ('e2000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','Leitor A','reader-a@example.test',true),
 ('e2000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000002','Financeiro B','finance-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'e2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('e3000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Operadora A'),
 ('e3000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',true),
 ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','e3000000-0000-0000-0000-000000000001',false),
 ('e1000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000003','e3000000-0000-0000-0000-000000000002',true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category) values
 ('e4000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','Fornecedor A','datacenter'),
 ('e4000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','Fornecedor A2','other');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,
 billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at) values
 ('e5000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001','Contrato A','fixed',1,100,0,10,'2026-01-01'),
 ('e5000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000002','Contrato A2','fixed',1,100,0,10,'2026-01-01');

select throws_ok($$select apticket.save_supplier_bank_account(null,'e4000000-0000-0000-0000-000000000001','X','Titular','123',null,null,null,null,null,null,null,null,true)$$,'23514',null,'rejeita dado bancario incompleto');
select lives_ok($$select apticket.save_supplier_bank_account(null,'e4000000-0000-0000-0000-000000000001','PIX principal','Fornecedor A','12.345.678/0001-90',null,null,null,null,null,null,'cnpj','12345678000190',true)$$,'salva conta PIX');
select is((select holder_tax_id from apticket.supplier_bank_accounts where supplier_id='e4000000-0000-0000-0000-000000000001'),'12345678000190','normaliza documento do titular');
select ok((select is_default from apticket.supplier_bank_accounts where supplier_id='e4000000-0000-0000-0000-000000000001'),'primeira conta fica principal');
select lives_ok($$select apticket.save_supplier_bank_account(null,'e4000000-0000-0000-0000-000000000001','Conta corrente','Fornecedor A','12345678000190','077','Banco Inter','0001','12345','6','checking',null,null,true)$$,'salva conta bancaria completa');
select is((select count(*) from apticket.supplier_bank_accounts where supplier_id='e4000000-0000-0000-0000-000000000001' and is_default),1::bigint,'mantem uma conta principal');

reset role;
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('e6000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','PAG-001','Teste aprovado','2026-08-01','2026-09-01','2026-09-10','fixed',1,100,100,'complete','approved','{}'),
 ('e6000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','PAG-002','Teste agendado','2026-09-01','2026-10-01','2026-10-10','fixed',1,100,100,'complete','scheduled','{}'),
 ('e6000000-0000-0000-0000-000000000003','e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e4000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','PAG-003','Teste diferenca','2026-10-01','2026-11-01','2026-11-10','fixed',1,100,100,'complete','approved','{}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);

select throws_ok($$select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000002',(select id from apticket.supplier_bank_accounts limit 1),'2026-09-10','pix')$$,'23514',null,'bloqueia lancamento nao aprovado');
select throws_ok($$select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000001',gen_random_uuid(),'2026-09-10','pix')$$,'23514',null,'rejeita conta bancaria desconhecida');
select lives_ok($$select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000001',(select id from apticket.supplier_bank_accounts where is_default),'2026-09-10','pix','Pagamento mensal')$$,'programa pagamento aprovado');
select is((select scheduled_amount from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),100.00::numeric,'congela valor aprovado');
select is((select bank_snapshot->>'bank_code' from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),'077','congela destino bancario');
select is((select scheduled_by_name from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),'Financeiro A','congela responsavel pela programacao');
select is((select count(*) from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),1::bigint,'programacao e unica por lancamento');

insert into storage.objects(bucket_id,name) select 'supplier-payment-receipts',
 'e1000000-0000-0000-0000-000000000001/e3000000-0000-0000-0000-000000000001/'||id||'/receipt.pdf'
 from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001';
select ok(exists(select 1 from storage.objects where name like '%/receipt.pdf'),'politica permite comprovante no escopo do pagamento');
select throws_ok($$select apticket.settle_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),clock_timestamp(),100,'TRX-1','outro/receipt.pdf','receipt.pdf','application/pdf',100)$$,'23514',null,'rejeita comprovante fora do caminho do pagamento');
select lives_ok($$select apticket.settle_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),clock_timestamp(),100,'TRX-1',(select name from storage.objects where name like '%/receipt.pdf'),'receipt.pdf','application/pdf',100)$$,'baixa pagamento com comprovante');
select is((select status from apticket.supplier_payables where id='e6000000-0000-0000-0000-000000000001'),'paid','baixa atualiza lancamento');
select is((select reconciliation_status from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),'matched','concilia valor exato');
select is((select difference_amount from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),0.00::numeric,'diferenca exata e zero');
select is((select receipt_file_name from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),'receipt.pdf','preserva metadados do comprovante');
select throws_ok($$select apticket.settle_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'),clock_timestamp(),100,'TRX-2',(select name from storage.objects where name like '%/receipt.pdf'),'receipt.pdf','application/pdf',100)$$,'23514',null,'nao repete baixa');

select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000003',(select id from apticket.supplier_bank_accounts where is_default),'2026-11-10','bank_transfer');
select throws_ok($$select apticket.cancel_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000003'),'x')$$,'23514',null,'cancelamento exige motivo');
select lives_ok($$select apticket.cancel_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000003'),'Dados bancarios divergentes')$$,'cancela programacao');
select is((select status from apticket.supplier_payables where id='e6000000-0000-0000-0000-000000000003'),'approved','cancelamento mantem lancamento aprovado');
select lives_ok($$select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000003',(select id from apticket.supplier_bank_accounts where is_default),'2026-11-11','pix')$$,'permite reprogramar depois do cancelamento');

select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.schedule_supplier_payment('e6000000-0000-0000-0000-000000000003',(select id from apticket.supplier_bank_accounts where is_default),'2026-11-12','pix')$$,'42501',null,'leitor nao programa pagamento');
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_payments),0::bigint,'outra tenant nao le pagamentos');
select is((select count(*) from apticket.supplier_bank_accounts),0::bigint,'outra tenant nao le dados bancarios');
reset role;
select ok((select count(*)>=8 from apticket.financial_audit_log where entity_table in ('supplier_bank_accounts','supplier_payments')),'audita dados bancarios e pagamentos');
select throws_ok($$delete from apticket.supplier_payments where supplier_payable_id='e6000000-0000-0000-0000-000000000001'$$,'23514',null,'bloqueia exclusao fisica de pagamento');

select * from finish();
rollback;
