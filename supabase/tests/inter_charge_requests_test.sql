begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('e1000000-0000-0000-0000-000000000001','Request A','request-test-a'),
 ('e1000000-0000-0000-0000-000000000002','Request B','request-test-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active)
select ('e2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 'e1000000-0000-0000-0000-000000000001','Request user','request-'||n||'@example.test',true from generate_series(1,2) n;
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'e2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name)
select ('e3000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'e1000000-0000-0000-0000-000000000002'::uuid else 'e1000000-0000-0000-0000-000000000001'::uuid end,
 'Request operator '||n from generate_series(1,3) n;
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write)
values('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',true);
insert into apticket.companies(id,tenant_id,name)
select ('e4000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'e1000000-0000-0000-0000-000000000002'::uuid else 'e1000000-0000-0000-0000-000000000001'::uuid end,
 'Request client '||n from generate_series(1,3) n;
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
select ('e5000000-0000-0000-0000-'||right(id::text,12))::uuid,tenant_id,id,'active','2026-01-01','2026-12-31','hours_package',100,15
from apticket.companies where id::text like 'e4000000-%';
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,billing_enabled,billing_anchor_month)
select id,tenant_id,('e3000000-0000-0000-0000-'||right(id::text,12))::uuid,'2027-01-01',true,'2026-01-01'
from apticket.contracts where id::text like 'e5000000-%';
insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
select tenant_id,operating_company_id,contract_id,'2026-01-01',100,'Test value' from apticket.contract_financial_terms where contract_id::text like 'e5000000-%';
select apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000001','2026-02-01',1);
select apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000002','2026-02-01',1);
select apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000003','2026-02-01',1);
-- IDs held in GUCs avoid accessing other-company rows through user RLS in tests.
select set_config('test.receivable_a',(select id::text from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000001'),true);
select set_config('test.receivable_b',(select id::text from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000002'),true);
select set_config('test.receivable_c',(select id::text from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000003'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'sandbox')->>'status','blocked_homologation','blocked by default');
select is(apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'sandbox')->>'reused','true','retry reuses request');
select is((select count(*) from apticket.inter_charge_requests),1::bigint,'retry does not duplicate');
select is(apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'production')->>'reused','false','separate production request');
select is((select amount from apticket.inter_charge_requests where environment='sandbox'),100::numeric,'amount from source');
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_b')::uuid,'sandbox')$$,'42501',null,'sister company denied');
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_c')::uuid,'sandbox')$$,'42501',null,'other tenant denied');
select throws_ok($$update apticket.inter_charge_requests set status='sent'$$,'42501',null,'cannot unlock dispatch');
select throws_ok($$delete from apticket.inter_charge_requests$$,'42501',null,'cannot physically delete');
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'invalid')$$,'22023',null,'invalid environment rejected');
select is((select count(*) from apticket.financial_audit_log where entity_table='inter_charge_requests' and actor_id=auth.uid()),2::bigint,'actor audited, no retry audit duplicates');
update apticket.contas_receber set vencimento_em='2026-02-20' where id=current_setting('test.receivable_a')::uuid;
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'sandbox')$$,'40001',null,'changed source requires review');
update apticket.contas_receber set status_cobranca='recebido',valor_aberto=0 where id=current_setting('test.receivable_a')::uuid;
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'sandbox')$$,'23514',null,'paid source rejected');
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.inter_charge_requests),0::bigint,'admin without grant cannot read');
select throws_ok($$select apticket.prepare_inter_charge(current_setting('test.receivable_a')::uuid,'sandbox')$$,'42501',null,'admin without grant cannot prepare');
set local role anon;
select throws_ok($$select apticket.prepare_inter_charge(null,'sandbox')$$,'42501',null,'anon cannot invoke');
reset role;
select is((select count(*) from apticket.inter_charge_requests where status<>'blocked_homologation'),0::bigint,'no executable bank requests');
select * from finish();
rollback;
