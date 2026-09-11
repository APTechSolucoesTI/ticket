begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(25);

insert into apticket.tenants(id,name,slug) values
 ('b1000000-0000-0000-0000-000000000001','Payable cycles A','payable-cycles-a'),
 ('b1000000-0000-0000-0000-000000000002','Payable cycles B','payable-cycles-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Writer A','payable-writer-a@example.test',true),
 ('b2000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','Reader A','payable-reader-a@example.test',true),
 ('b2000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000002','Writer B','payable-writer-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro'
where p.id::text like 'b2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('b3000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Operator A'),
 ('b3000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000002','Operator B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001',true),
 ('b1000000-0000-0000-0000-000000000001','b2000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000001',false),
 ('b1000000-0000-0000-0000-000000000002','b2000000-0000-0000-0000-000000000003','b3000000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('b4000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','Cliente A'),
 ('b4000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','Cliente B');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values
 ('b5000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10),
 ('b5000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000002','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date)
values
 ('b5000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','2026-01-01'),
 ('b5000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
values
 ('b6000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','2026-01-01',100,'Inicial'),
 ('b6000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000002','2026-01-01',100,'Inicial');
insert into apticket.consumption_snapshots(id,tenant_id,operating_company_id,contract_id,value_version_id,
 cycle_start,cycle_end,metric,measured_quantity,included_quantity,unit_price,source_type,source_items)
values
 ('b7000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000001','b6000000-0000-0000-0000-000000000001','2026-02-01','2026-03-01','devices',4,0,5,'fixture','[{"device":"A"}]'),
 ('b7000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b5000000-0000-0000-0000-000000000002','b6000000-0000-0000-0000-000000000002','2026-02-01','2026-03-01','devices',6,0,5,'fixture','[{"device":"B"}]');

set local role authenticated;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category) values
 ('b8000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','Fornecedor A','software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at) values
 ('b9000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','RMM','devices',1,0,12.3456,10,'2026-01-01','2026-12-31'),
 ('b9000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','Licenca fixa','fixed',1,1200,0,31,'2026-01-01','2026-12-31'),
 ('b9000000-0000-0000-0000-000000000003','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','Cloud trimestral','fixed',3,3000,0,15,'2026-01-01','2026-12-31'),
 ('b9000000-0000-0000-0000-000000000004','b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','Usuarios sem consumo','active_users',1,0,8,10,'2026-01-01','2026-12-31');

select lives_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000001','2026-02-01')$$,'gera lancamento por dispositivos');
select is((select measured_quantity from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000001'),10::numeric,'soma o consumo dos clientes');
select is((select total_amount from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000001'),123.45::numeric,'total soma os itens arredondados');
select is((select count(*) from apticket.supplier_payable_allocations),2::bigint,'cria um rateio por snapshot');
select is((select sum(amount) from apticket.supplier_payable_allocations),123.45::numeric,'rateios conferem com o total');
select is((select count(distinct customer_contract_id) from apticket.supplier_payable_allocations),2::bigint,'rateio identifica os contratos dos clientes');
select ok((select source_snapshot->'source_items'='[{"device":"A"}]'::jsonb from apticket.supplier_payable_allocations where consumption_snapshot_id='b7000000-0000-0000-0000-000000000001'),'evidencia da apuracao fica congelada');
select is(apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000001','2026-02-15'),(select id from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000001'),'reprocessamento e idempotente');
select is((select count(*) from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000001'),1::bigint,'reprocessamento nao duplica');
select lives_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000002','2026-02-01')$$,'gera lancamento fixo');
select is((select total_amount from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000002'),1200::numeric,'preserva valor fixo');
select is((select allocation_status from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000002'),'pending_rule','fixo aguarda regra de rateio');
select is((select due_date from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000002'),'2026-02-28'::date,'vencimento limita o dia ao fim do mes');
select throws_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000003','2026-02-01')$$,'23514',null,'periodicidade trimestral rejeita competencia intermediaria');
select throws_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000004','2026-02-01')$$,'23514',null,'consumo ausente impede lancamento incompleto');
select throws_ok($$insert into apticket.supplier_payables(tenant_id,operating_company_id,supplier_id,supplier_contract_id,document_number,description,cycle_start,cycle_end,due_date,billing_unit,total_amount,allocation_status,terms_snapshot)
 values('b1000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000001','b8000000-0000-0000-0000-000000000001','b9000000-0000-0000-0000-000000000001','MANUAL','Manual','2026-03-01','2026-04-01','2026-03-10','devices',1,'complete','{}')$$,'42501',null,'cliente nao inclui lancamento diretamente');
select throws_ok($$delete from apticket.supplier_payables where supplier_contract_id='b9000000-0000-0000-0000-000000000001'$$,'42501',null,'exclusao fisica nao e concedida');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($$update apticket.consumption_snapshots set deleted_at=now() where id='b7000000-0000-0000-0000-000000000001'$$,'23514',null,'snapshot rateado nao pode ser arquivado');
set local role authenticated;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select throws_ok($$update apticket.supplier_contracts set unit_price=13 where id='b9000000-0000-0000-0000-000000000001'$$,'23514',null,'preco utilizado nao pode ser reescrito');

select set_config('request.jwt.claims','{"sub":"b2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000002','2026-03-01')$$,'42501',null,'acesso somente leitura nao gera lancamento');
select is((select count(*) from apticket.supplier_payables),2::bigint,'leitor autorizado consulta os lancamentos');
select set_config('request.jwt.claims','{"sub":"b2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_payables),0::bigint,'outro tenant nao enxerga os lancamentos');
select throws_ok($$select apticket.generate_supplier_payable('b9000000-0000-0000-0000-000000000002','2026-03-01')$$,'42501',null,'outro tenant nao gera lancamento');
reset role;
select ok((select count(*)>=4 from apticket.financial_audit_log where entity_table in ('supplier_payables','supplier_payable_allocations') and tenant_id='b1000000-0000-0000-0000-000000000001'),'lancamento e rateio entram na auditoria');
set local role anon;
select throws_ok($$select count(*) from apticket.supplier_payables$$,'42501',null,'anonimo nao consulta contas a pagar');
select * from finish();
rollback;
