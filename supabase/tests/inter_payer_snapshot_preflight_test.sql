begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();

insert into apticket.tenants(id,name,slug,cnpj) values
 ('f8100000-0000-0000-0000-000000000001','Payer tenant','payer-test','12.345.678/0001-95'),
 ('f8100000-0000-0000-0000-000000000002','Other tenant','payer-other','98.765.432/0001-98');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('f8200000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001','Payer admin','payer-admin@example.test',true),
 ('f8200000-0000-0000-0000-000000000002','f8100000-0000-0000-0000-000000000001','No scope admin','payer-no-scope@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'f8200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name,tax_id) values
 ('f8300000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001','Payer operator','12345678000195');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('f8100000-0000-0000-0000-000000000001','f8200000-0000-0000-0000-000000000001','f8300000-0000-0000-0000-000000000001',true);
insert into apticket.companies(id,tenant_id,name) values
 ('f8400000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001','Cliente Pagador Ltda');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values('f8500000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001',
 'f8400000-0000-0000-0000-000000000001','active',(date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date,
 '2099-12-31','hours_package',100,28);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,
 billing_enabled,billing_anchor_month)
values('f8500000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001',
 'f8300000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,true,(date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date);
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
values('f8600000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001',
 'f8300000-0000-0000-0000-000000000001','f8500000-0000-0000-0000-000000000001',
 (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date,100,'Payer test');
select apticket.close_billing_cycles('f8500000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1);
select set_config('test.receivable',(select id::text from apticket.contas_receber where contrato_id='f8500000-0000-0000-0000-000000000001'),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f8200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select set_config('test.request',(apticket.prepare_inter_charge(current_setting('test.receivable')::uuid,'sandbox')->>'id'),true);
reset role;
insert into apticket.tenant_inter_configurations(tenant_id,environment,account,secret_id,certificate_expires_at,
 certificate_fingerprint,is_active,version,updated_by)
values('f8100000-0000-0000-0000-000000000001','sandbox','12345678',vault.create_secret('{}'),
 now()+interval '1 year','payer-fixture',true,1,'f8200000-0000-0000-0000-000000000001');
insert into apticket.operating_company_inter_bindings(id,tenant_id,operating_company_id,environment,
 configuration_version,company_tax_id,account_last_four,created_by)
values('f8700000-0000-0000-0000-000000000001','f8100000-0000-0000-0000-000000000001',
 'f8300000-0000-0000-0000-000000000001','sandbox',1,'12345678000195','5678',
 'f8200000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f8200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','missing_data','incomplete payer blocked');
select ok((apticket.review_inter_payer(current_setting('test.request')::uuid)->'missing_fields') @> '["tax_id","street","number","district","city","state","zip"]','missing fields identified');
select is(length(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'seu_numero'),15,'bank reference limited to 15 chars');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'dispatch_enabled','false','review never enables dispatch');
select throws_ok(format($$select apticket.confirm_inter_payer(%L,%L,%L,null,true)$$,
 current_setting('test.request'),apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',
 'f8700000-0000-0000-0000-000000000001'),'23514',null,'cannot confirm incomplete payer');
reset role;

update apticket.companies set cnpj='11.111.111/1111-11' where id='f8400000-0000-0000-0000-000000000001';
set local role authenticated;
select ok((apticket.review_inter_payer(current_setting('test.request')::uuid)->'missing_fields') @> '["tax_id"]','CNPJ checksum validated');
reset role;
update apticket.companies set cnpj='45.723.174/0001-10',phone='+55 (11) 98765-4321',address_street='Rua das Flores',
 address_number='123',address_complement='Sala 4',address_neighborhood='Centro',address_city='São Paulo',
 address_state='sp',address_zip='01001-000' where id='f8400000-0000-0000-0000-000000000001';
set local role authenticated;
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','confirmation_required','complete payer awaits confirmation');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)#>>'{payer,type}','JURIDICA','payer type from company');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)#>>'{payer,ddd}','11','phone area code normalized');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)#>>'{payer,phone}','987654321','country code removed from bank phone');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)#>>'{payer,zip}','01001000','zip normalized');
select set_config('test.fingerprint',apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',true);
select is(apticket.confirm_inter_payer(current_setting('test.request')::uuid,current_setting('test.fingerprint'),
 'f8700000-0000-0000-0000-000000000001',null,true)->>'reused','false','snapshot confirmed');
select is(apticket.confirm_inter_payer(current_setting('test.request')::uuid,current_setting('test.fingerprint'),
 'f8700000-0000-0000-0000-000000000001',null,true)->>'reused','true','retry is idempotent');
select is((select count(*) from apticket.inter_payer_snapshots),1::bigint,'retry does not duplicate');
select is((select payer_ddd||payer_phone from apticket.inter_payer_snapshots),'11987654321','snapshot stores the Inter phone format');
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','confirmed','snapshot current');
select set_config('test.snapshot',(select id::text from apticket.inter_payer_snapshots where request_id=current_setting('test.request')::uuid),true);
select throws_ok($$update apticket.inter_payer_snapshots set payer_name='Changed'$$,'42501',null,'direct update denied');
select throws_ok($$delete from apticket.inter_payer_snapshots$$,'42501',null,'API delete denied');
reset role;

update apticket.tenant_inter_configurations set version=2
 where tenant_id='f8100000-0000-0000-0000-000000000001' and environment='sandbox';
set local role authenticated;
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','binding_required','outdated bank binding blocks payer');
reset role;
update apticket.tenant_inter_configurations set version=1
 where tenant_id='f8100000-0000-0000-0000-000000000001' and environment='sandbox';
update apticket.contas_receber set vencimento_em=vencimento_em+1 where id=current_setting('test.receivable')::uuid;
set local role authenticated;
select ok((apticket.review_inter_payer(current_setting('test.request')::uuid)->'missing_fields') @> '["receivable"]','changed receivable detected');
select throws_ok(format($$select apticket.confirm_inter_payer(%L,%L,%L,%L,true)$$,
 current_setting('test.request'),apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',
 'f8700000-0000-0000-0000-000000000001',current_setting('test.snapshot')),'23514',null,'changed receivable cannot be confirmed');
reset role;
update apticket.contas_receber r set vencimento_em=q.due_date from apticket.inter_charge_requests q
 where r.id=current_setting('test.receivable')::uuid and q.id=current_setting('test.request')::uuid;

update apticket.companies set address_number='124' where id='f8400000-0000-0000-0000-000000000001';
set local role authenticated;
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','confirmation_outdated','source change detected by fingerprint');
select throws_ok(format($$select apticket.confirm_inter_payer(%L,%L,%L,null,true)$$,
 current_setting('test.request'),apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',
 'f8700000-0000-0000-0000-000000000001'),'40001',null,'previous snapshot required');
select is(apticket.confirm_inter_payer(current_setting('test.request')::uuid,
 apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',
 'f8700000-0000-0000-0000-000000000001',current_setting('test.snapshot')::uuid,true)->>'reused','false','reconfirmation creates snapshot');
select is((select count(*) from apticket.inter_payer_snapshots where deleted_at is not null),1::bigint,'old payer snapshot retained');
select is((select count(*) from apticket.financial_audit_log where entity_table='inter_payer_snapshots' and actor_id=auth.uid()),3::bigint,'payer changes audited');
select set_config('request.jwt.claims','{"sub":"f8200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok(format($$select apticket.review_inter_payer(%L)$$,current_setting('test.request')),'42501',null,'admin without scope denied');
select is((select count(*) from apticket.inter_payer_snapshots),0::bigint,'RLS hides snapshots without scope');
set local role anon;
select throws_ok($$select apticket.review_inter_payer(null)$$,'42501',null,'anon cannot review');
select throws_ok($$select apticket.confirm_inter_payer(null,null,null,null,true)$$,'42501',null,'anon cannot confirm');
reset role;
select ok(not has_function_privilege('authenticated','apticket_finance_private.is_valid_cnpj(text)','execute'),'CNPJ helper remains private');
select ok(not has_function_privilege('authenticated','apticket_finance_private.normalize_inter_phone(text)','execute'),'phone helper remains private');
select is(apticket_finance_private.normalize_inter_phone('+1 212 555-0123'),array[null::text,null::text],'explicit foreign country code is rejected');
select throws_ok($$delete from apticket.inter_payer_snapshots$$,'23514',null,'physical history deletion blocked');
select is((select count(*) from apticket.inter_charge_requests where status<>'blocked_homologation'),0::bigint,'requests remain blocked');
select * from finish();
rollback;
