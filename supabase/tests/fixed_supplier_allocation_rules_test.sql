begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(29);

insert into apticket.tenants(id,name,slug) values
 ('c1000000-0000-0000-0000-000000000001','Fixed allocation A','fixed-allocation-a'),
 ('c1000000-0000-0000-0000-000000000002','Fixed allocation B','fixed-allocation-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Writer A','fixed-writer-a@example.test',true),
 ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','Reader A','fixed-reader-a@example.test',true),
 ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000002','Writer B','fixed-writer-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'c2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('c3000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Operator A'),
 ('c3000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','Operator B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',true),
 ('c1000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000001',false),
 ('c1000000-0000-0000-0000-000000000002','c2000000-0000-0000-0000-000000000003','c3000000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('c4000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','Cliente Alfa'),
 ('c4000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','Cliente Beta'),
 ('c4000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','Cliente Gama'),
 ('c4000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000002','Cliente Externo');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values
 ('c5000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10),
 ('c5000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000002','active','2026-01-01','2026-12-31','hours_package',100,10),
 ('c5000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','c4000000-0000-0000-0000-000000000003','active','2026-01-01','2026-12-31','hours_package',100,10),
 ('c5000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000002','c4000000-0000-0000-0000-000000000004','active','2026-01-01','2026-12-31','hours_package',100,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date)
values
 ('c5000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','2026-01-01'),
 ('c5000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','2026-01-01'),
 ('c5000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','2026-01-01'),
 ('c5000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000002','2026-01-01');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category)
values('c6000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','Fornecedor Fixo','datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,
 billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at)
values('c7000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001','Cloud fixo','fixed',1,100,0,10,'2026-01-01','2026-12-31');

select lives_ok($$select apticket.generate_supplier_payable('c7000000-0000-0000-0000-000000000001','2026-02-01')$$,'gera conta fixa antes das regras');
select is((select allocation_status from apticket.supplier_payables where supplier_contract_id='c7000000-0000-0000-0000-000000000001'),'pending_rule','conta fica pendente sem regra');
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":90}]')$$,'23514',null,'percentuais devem somar cem');
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":50},{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":50}]')$$,'23514',null,'contrato duplicado e rejeitado');
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":50},{"customer_contract_id":"c5000000-0000-0000-0000-000000000004","percentage":50}]')$$,'23514',null,'contrato de outro tenant e rejeitado');
select lives_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":33.333333},{"customer_contract_id":"c5000000-0000-0000-0000-000000000002","percentage":33.333333},{"customer_contract_id":"c5000000-0000-0000-0000-000000000003","percentage":33.333334}]')$$,'salva regra versionada');
select is((select allocation_status from apticket.supplier_payables where supplier_contract_id='c7000000-0000-0000-0000-000000000001'),'complete','regra aplica conta pendente');
select is((select count(*) from apticket.supplier_payable_allocations),3::bigint,'cria tres parcelas de rateio');
select is((select sum(amount) from apticket.supplier_payable_allocations),100::numeric,'residuo de arredondamento preserva o total');
select is((select sum(percentage) from apticket.supplier_payable_allocations),100::numeric,'percentuais congelados somam cem');
select is((select max(amount) from apticket.supplier_payable_allocations),33.34::numeric,'centavo residual fica em uma parcela');
select ok((select bool_and(customer_name like 'Cliente %' and length(contract_number)>0) from apticket.supplier_payable_allocations),'cliente e contrato ficam congelados');
select lives_ok($$select apticket.generate_supplier_payable('c7000000-0000-0000-0000-000000000001','2026-03-01')$$,'gera competencia posterior');
select is((select allocation_status from apticket.supplier_payables where cycle_start='2026-03-01' and supplier_contract_id='c7000000-0000-0000-0000-000000000001'),'complete','regra vigente aplica automaticamente');
select is((select count(*) from apticket.supplier_payable_allocations a join apticket.supplier_payables p on p.id=a.supplier_payable_id where p.cycle_start='2026-03-01'),3::bigint,'nova conta recebe os tres rateios');
select ok(apticket.apply_supplier_payable_allocation((select id from apticket.supplier_payables where cycle_start='2026-03-01' and supplier_contract_id='c7000000-0000-0000-0000-000000000001')),'reaplicar conta concluida e idempotente');
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":50},{"customer_contract_id":"c5000000-0000-0000-0000-000000000002","percentage":50}]')$$,'23514',null,'regra utilizada nao pode ser reescrita');
select lives_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-06-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":60},{"customer_contract_id":"c5000000-0000-0000-0000-000000000002","percentage":40}]')$$,'cria regra futura');
select lives_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-06-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":70},{"customer_contract_id":"c5000000-0000-0000-0000-000000000002","percentage":30}]')$$,'regra futura sem uso pode ser corrigida');
select is((select count(*) from apticket.supplier_allocation_rules r join apticket.supplier_allocation_rule_sets s on s.id=r.rule_set_id where s.effective_from='2026-06-01' and r.deleted_at is null),2::bigint,'substituicao mantem apenas regras ativas');
select is((select sum(r.percentage) from apticket.supplier_allocation_rules r join apticket.supplier_allocation_rule_sets s on s.id=r.rule_set_id where s.effective_from='2026-06-01' and r.deleted_at is null),100::numeric,'regra futura corrigida soma cem');

select set_config('request.jwt.claims','{"sub":"c2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-07-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":100}]')$$,'42501',null,'leitor nao configura rateio');
select is((select count(*) from apticket.supplier_allocation_rule_sets),2::bigint,'leitor autorizado consulta regras');
select set_config('request.jwt.claims','{"sub":"c2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.supplier_allocation_rule_sets),0::bigint,'outro tenant nao consulta regras');
select throws_ok($$select apticket.save_supplier_allocation_rules('c7000000-0000-0000-0000-000000000001','2026-07-01','[{"customer_contract_id":"c5000000-0000-0000-0000-000000000001","percentage":100}]')$$,'42501',null,'outro tenant nao configura rateio');
select throws_ok($$insert into apticket.supplier_allocation_rule_sets(tenant_id,operating_company_id,supplier_contract_id,effective_from) values('c1000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001','2026-08-01')$$,'42501',null,'cliente nao inclui regra diretamente');
select throws_ok($$delete from apticket.supplier_allocation_rule_sets$$,'42501',null,'exclusao fisica nao e concedida');
reset role;
select ok((select count(*)>=15 from apticket.financial_audit_log where entity_table in ('supplier_allocation_rule_sets','supplier_allocation_rules','supplier_payable_allocations','supplier_payables') and tenant_id='c1000000-0000-0000-0000-000000000001'),'regras e aplicacoes entram na auditoria');
set local role anon;
select throws_ok($$select count(*) from apticket.supplier_allocation_rule_sets$$,'42501',null,'anonimo nao consulta regras');
select * from finish();
rollback;
