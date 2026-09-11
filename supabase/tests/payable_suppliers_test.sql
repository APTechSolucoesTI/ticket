begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(24);

insert into apticket.tenants(id,name,slug) values
 ('a1000000-0000-0000-0000-000000000001','Payables A','payables-a'),
 ('a1000000-0000-0000-0000-000000000002','Payables B','payables-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Writer A','writer-a@example.test',true),
 ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','Writer B','writer-b@example.test',true),
 ('a2000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','Reader A','reader-a@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro'
where p.id::text like 'a2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Operator A'),
 ('a3000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000002','Operator B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',true),
 ('a1000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000002',true),
 ('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000001',false);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,trade_name,tax_id,category,email,phone)
 values('a4000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','  Software Vendor SA  ',' Vendor ','12.345.678/0001-90','software_licensing','BILLING@EXAMPLE.TEST','(19) 3333-4444')$$,'financeiro inclui fornecedor');
select is((select legal_name from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'),'Software Vendor SA','razao social e normalizada');
select is((select tax_id from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'),'12345678000190','documento e normalizado');
select is((select email from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'),'billing@example.test','email e normalizado');
select is((select created_by from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'),'a2000000-0000-0000-0000-000000000001'::uuid,'autor vem da sessao');
select lives_ok($$insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at)
 values('a5000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Licenca base','fixed',1,1200,0,10,'2026-01-01')$$,'inclui contrato fixo');
select lives_ok($$insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at)
 values('a5000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Agentes RMM','devices',1,0,12.3456,10,'2026-01-01')$$,'inclui contrato por dispositivo');
select is((select unit_price from apticket.supplier_contracts where id='a5000000-0000-0000-0000-000000000002'),12.3456::numeric,'preco unitario preserva precisao');
select throws_ok($$insert into apticket.supplier_contracts(tenant_id,operating_company_id,supplier_id,description,billing_unit,base_amount,unit_price,due_day,starts_at)
 values('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Invalido','fixed',0,10,10,'2026-01-01')$$,'23514',null,'modelo fixo exige somente valor base');
select throws_ok($$insert into apticket.supplier_contracts(tenant_id,operating_company_id,supplier_id,description,billing_unit,base_amount,unit_price,due_day,starts_at,ends_at)
 values('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','Datas invalidas','fixed',10,0,10,'2026-02-01','2026-01-01')$$,'23514',null,'fim nao antecede inicio');
select throws_ok($$update apticket.suppliers set deleted_at=clock_timestamp() where id='a4000000-0000-0000-0000-000000000001'$$,'23514',null,'fornecedor com contrato ativo nao e arquivado');
select throws_ok($$delete from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'$$,'42501',null,'exclusao fisica e bloqueada');
select throws_ok($$update apticket.supplier_contracts set supplier_id=gen_random_uuid() where id='a5000000-0000-0000-0000-000000000001'$$,'23514',null,'vinculo do contrato e imutavel');

select set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.suppliers),0::bigint,'outro tenant nao enxerga fornecedores');
select throws_ok($$insert into apticket.suppliers(tenant_id,operating_company_id,legal_name,category)
 values('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Cross tenant','other')$$,'42501',null,'outro tenant nao inclui fornecedor');

select set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.suppliers),1::bigint,'acesso financeiro de leitura consulta fornecedor');
update apticket.suppliers set trade_name='Blocked' where id='a4000000-0000-0000-0000-000000000001';
select is((select trade_name from apticket.suppliers where id='a4000000-0000-0000-0000-000000000001'),'Vendor','acesso somente leitura nao altera fornecedor');
select throws_ok($$insert into apticket.suppliers(tenant_id,operating_company_id,legal_name,category)
 values('a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','Blocked supplier','other')$$,'42501',null,'acesso somente leitura nao inclui fornecedor');

select set_config('request.jwt.claims','{"sub":"a2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$update apticket.suppliers set trade_name='Vendor Atualizado' where id='a4000000-0000-0000-0000-000000000001'$$,'financeiro edita fornecedor');
select lives_ok($$update apticket.supplier_contracts set is_active=false,deleted_at=clock_timestamp() where supplier_id='a4000000-0000-0000-0000-000000000001'$$,'contratos aceitam arquivamento logico');
select lives_ok($$update apticket.suppliers set is_active=false,deleted_at=clock_timestamp() where id='a4000000-0000-0000-0000-000000000001'$$,'fornecedor sem contrato ativo e arquivado');
select is((select count(*) from apticket.suppliers where deleted_at is null),0::bigint,'arquivado deixa a listagem ativa');
reset role;
select ok((select count(*)>=7 from apticket.financial_audit_log where entity_table in ('suppliers','supplier_contracts') and tenant_id='a1000000-0000-0000-0000-000000000001'),'mudancas entram na auditoria financeira');
set local role anon;
select throws_ok($$select count(*) from apticket.suppliers$$,'42501',null,'anonimo nao consulta fornecedores');
select * from finish();
rollback;
