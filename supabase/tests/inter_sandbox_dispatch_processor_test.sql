begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();

insert into apticket.tenants(id,name,slug,cnpj) values
 ('fa100000-0000-0000-0000-000000000001','Dispatch tenant','dispatch-test','12.345.678/0001-95');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Dispatch admin','dispatch-admin@example.test',true),
 ('fa200000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000001','Dispatch no scope','dispatch-no-scope@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Admin' where p.id::text like 'fa200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name,tax_id) values
 ('fa300000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Dispatch operator','12345678000195');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fa100000-0000-0000-0000-000000000001','fa200000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001',true);
insert into apticket.companies(id,tenant_id,name,cnpj,phone,address_street,address_number,address_neighborhood,address_city,address_state,address_zip) values
 ('fa400000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Cliente Emissao Ltda','45.723.174/0001-10','(11) 98765-4321','Rua das Flores','123','Centro','Sao Paulo','SP','01001-000');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
 'fa400000-0000-0000-0000-000000000001','active',(date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date,
 '2099-12-31','hours_package',150,28);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,billing_enabled,billing_anchor_month)
values('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
 'fa300000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,true,(date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date);
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
values('fa600000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
 'fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001',
 (date_trunc('month',(now() at time zone 'America/Sao_Paulo')::date)-interval '1 month')::date,150,'Dispatch test');
select apticket.close_billing_cycles('fa500000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1);
select set_config('test.receivable',(select id::text from apticket.contas_receber where contrato_id='fa500000-0000-0000-0000-000000000001'),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select set_config('test.request',(apticket.prepare_inter_charge(current_setting('test.receivable')::uuid,'sandbox')->>'id'),true);
reset role;

insert into apticket.tenant_inter_configurations(tenant_id,environment,account,secret_id,certificate_expires_at,certificate_fingerprint,is_active,version,updated_by)
values('fa100000-0000-0000-0000-000000000001','sandbox','12345678',
 vault.create_secret('{"client_id":"test-client","client_secret":"test-secret","certificate":"test-certificate","private_key":"test-key"}'),
 now()+interval '1 year','dispatch-fixture',true,1,'fa200000-0000-0000-0000-000000000001');
insert into apticket.operating_company_inter_bindings(id,tenant_id,operating_company_id,environment,configuration_version,company_tax_id,account_last_four,created_by)
values('fa700000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
 'fa300000-0000-0000-0000-000000000001','sandbox',1,'12345678000195','5678','fa200000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select set_config('test.fingerprint',apticket.review_inter_payer(current_setting('test.request')::uuid)->>'source_fingerprint',true);
select apticket.confirm_inter_payer(current_setting('test.request')::uuid,current_setting('test.fingerprint'),
 'fa700000-0000-0000-0000-000000000001',null,true);
select is(apticket.review_inter_payer(current_setting('test.request')::uuid)->>'state','confirmed','payer snapshot confirmed');
select set_config('test.prepared',apticket.prepare_inter_charge_dispatch(current_setting('test.request')::uuid,true,false)::text,true);
select is(current_setting('test.prepared')::jsonb->>'state','dispatching','first dispatch claimed');
select is(current_setting('test.prepared')::jsonb->>'reused','false','first dispatch is new');
select set_config('test.attempt',current_setting('test.prepared')::jsonb->>'attempt_id',true);
select is(apticket.prepare_inter_charge_dispatch(current_setting('test.request')::uuid,true,false)->>'reused','true','concurrent retry reuses claim');
select is((select count(*) from apticket.inter_charge_dispatch_attempts where request_id=current_setting('test.request')::uuid),1::bigint,'retry does not duplicate bank attempt');
select throws_ok($$update apticket.inter_charge_dispatch_attempts set error_code='tampered'$$,'42501',null,'authenticated user cannot mutate attempt');
select throws_ok(format($$select apticket.load_inter_charge_dispatch(%L,%L)$$,current_setting('test.attempt'),'fa200000-0000-0000-0000-000000000001'),'42501',null,'authenticated user cannot load secrets');
reset role;

set local role service_role;
select set_config('test.dispatch',apticket.load_inter_charge_dispatch(current_setting('test.attempt')::uuid,'fa200000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('test.dispatch')::jsonb->>'environment','sandbox','service loads sandbox only');
select is(current_setting('test.dispatch')::jsonb#>>'{charge,formasRecebimento,0}','BOLETO','payload requests boleto');
select is(current_setting('test.dispatch')::jsonb#>>'{charge,formasRecebimento,1}','PIX','payload requests pix');
select is(current_setting('test.dispatch')::jsonb#>>'{charge,pagador,cpfCnpj}','45723174000110','payer comes from immutable snapshot');
select set_config('test.finished',apticket.finish_inter_charge_dispatch(current_setting('test.attempt')::uuid,'submitted',
 'fa800000-0000-4000-8000-000000000001',200,null,null)::text,true);
select is(current_setting('test.finished')::jsonb->>'state','submitted','service finalizes accepted request');
select is(apticket.finish_inter_charge_dispatch(current_setting('test.attempt')::uuid,'submitted',
 'fa800000-0000-4000-8000-000000000001',200,null,null)->>'reused','true','finalization is idempotent');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.prepare_inter_charge_dispatch(current_setting('test.request')::uuid,true,false)->>'state','submitted','accepted request never posts twice');
select is((select bank_status from apticket.inter_charge_requests where id=current_setting('test.request')::uuid),'EM_PROCESSAMENTO','asynchronous bank state recorded');
select ok((select bank_accepted_at is not null from apticket.inter_charge_requests where id=current_setting('test.request')::uuid),'bank acceptance timestamp recorded');
select set_config('test.sync_prepared',apticket.prepare_inter_charge_sync(current_setting('test.request')::uuid)::text,true);
select is(current_setting('test.sync_prepared')::jsonb->>'state','syncing','active reconciliation claimed');
select set_config('test.sync_attempt',current_setting('test.sync_prepared')::jsonb->>'attempt_id',true);
select is(apticket.prepare_inter_charge_sync(current_setting('test.request')::uuid)->>'reused','true','concurrent reconciliation reuses claim');
select throws_ok(format($$select apticket.load_inter_charge_sync(%L,%L)$$,current_setting('test.sync_attempt'),'fa200000-0000-0000-0000-000000000001'),'42501',null,'authenticated user cannot load reconciliation secrets');
reset role;

set local role service_role;
select set_config('test.sync_dispatch',apticket.load_inter_charge_sync(current_setting('test.sync_attempt')::uuid,'fa200000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('test.sync_dispatch')::jsonb->>'bank_request_id','fa800000-0000-4000-8000-000000000001','service loads accepted bank identifier');
select set_config('test.sync_finished',apticket.finish_inter_charge_sync(
  current_setting('test.sync_attempt')::uuid,'synced',200,null,null,
  jsonb_build_object(
    'codigo_solicitacao','fa800000-0000-4000-8000-000000000001',
    'situacao','A_RECEBER','data_situacao',current_date::text,
    'nosso_numero','123456','linha_digitavel','00190000090000000000100000000123456780000015000'
  )
)::text,true);
select is(current_setting('test.sync_finished')::jsonb->>'state','synced','service finalizes active reconciliation');
select is((select bank_status from apticket.inter_charge_requests where id=current_setting('test.request')::uuid),'A_RECEBER','bank situation reconciled');
select is((select bank_our_number from apticket.inter_charge_requests where id=current_setting('test.request')::uuid),'123456','known bank details persisted');
select is((select status_cobranca::text from apticket.contas_receber where id=current_setting('test.receivable')::uuid),'faturado','receivable follows open bank charge');
select ok((select bank_synced_at is not null from apticket.inter_charge_requests where id=current_setting('test.request')::uuid),'synchronization timestamp recorded');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.prepare_inter_charge_sync(current_setting('test.request')::uuid)->>'state','synced','recent result is reused without bank call');
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select throws_ok(format($$select apticket.prepare_inter_charge_dispatch(%L,true,false)$$,current_setting('test.request')),'42501',null,'admin without financial scope denied');
select throws_ok(format($$select apticket.prepare_inter_charge_sync(%L)$$,current_setting('test.request')),'42501',null,'reconciliation without financial scope denied');
select is((select count(*) from apticket.inter_charge_dispatch_attempts),0::bigint,'RLS hides attempts outside scope');
select is((select count(*) from apticket.inter_charge_sync_attempts),0::bigint,'RLS hides reconciliation attempts outside scope');
set local role anon;
select throws_ok(format($$select apticket.prepare_inter_charge_dispatch(%L,true,false)$$,current_setting('test.request')),'42501',null,'anonymous dispatch denied');
reset role;

insert into apticket.inter_charge_requests(tenant_id,operating_company_id,receivable_id,environment,amount,due_date,created_by)
select tenant_id,operating_company_id,receivable_id,'production',amount,due_date,created_by
from apticket.inter_charge_requests where id=current_setting('test.request')::uuid;
select set_config('test.production_request',(select id::text from apticket.inter_charge_requests where receivable_id=current_setting('test.receivable')::uuid and environment='production'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select throws_ok(format($$select apticket.prepare_inter_charge_dispatch(%L,true,false)$$,current_setting('test.production_request')),'22023',null,'production requires a specific confirmation');
select throws_ok(format($$select apticket.prepare_inter_charge_dispatch(%L,true,true)$$,current_setting('test.production_request')),'P0001',null,'production remains blocked without active configuration and webhook');
reset role;

set local role service_role;
select set_config('test.webhook_prepared',apticket.prepare_inter_webhook_registration(
  'fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
  'sandbox',1,'https://apticket.example.test/backend/webhooks/inter/sandbox'
)::text,true);
select set_config('test.webhook_attempt',current_setting('test.webhook_prepared')::jsonb->>'attempt_id',true);
select set_config('test.webhook_token',current_setting('test.webhook_prepared')::jsonb->>'candidate_token',true);
select set_config('test.webhook_hash',encode(extensions.digest(current_setting('test.webhook_token'),'sha256'),'hex'),true);
select is(length(current_setting('test.webhook_token')),64,'registration creates a strong callback token');
select ok(current_setting('test.webhook_prepared')::jsonb->>'callback_url' like 'https://%?token=%','Inter receives an HTTPS callback URL with token');
select is(apticket.finish_inter_webhook_registration(
  current_setting('test.webhook_attempt')::uuid,'registered',204,null,null,current_setting('test.webhook_token')
)->>'state','registered','webhook registration is finalized');
select is((select webhook_status from apticket.tenant_inter_configurations where tenant_id='fa100000-0000-0000-0000-000000000001' and environment='sandbox'),'active','webhook becomes active');
select is((select webhook_secret_hash from apticket.tenant_inter_configurations where tenant_id='fa100000-0000-0000-0000-000000000001' and environment='sandbox'),current_setting('test.webhook_hash'),'only callback token hash is indexed');
select ok(not exists(select 1 from apticket.inter_webhook_registration_attempts where to_jsonb(inter_webhook_registration_attempts)::text like '%'||current_setting('test.webhook_token')||'%'),'raw callback token is absent from audit table');
select throws_ok($$select apticket.accept_inter_charge_webhook('sandbox',repeat('0',64),'[{"codigo_solicitacao":"fa800000-0000-4000-8000-000000000001"}]')$$,'42501',null,'wrong callback token is denied');
select set_config('test.webhook_accepted',apticket.accept_inter_charge_webhook(
  'sandbox',current_setting('test.webhook_hash'),jsonb_build_array(jsonb_build_object(
    'codigo_solicitacao','fa800000-0000-4000-8000-000000000001',
    'situacao','RECEBIDO','data_hora_situacao','2026-09-10T12:00:00Z',
    'valor_total_recebido','999999.00','pagador',jsonb_build_object('cpfCnpj','secret')
  ))
)::text,true);
select set_config('test.webhook_event',current_setting('test.webhook_accepted')::jsonb#>>'{events,0,event_id}',true);
select is((select status_cobranca::text from apticket.contas_receber where id=current_setting('test.receivable')::uuid),'faturado','untrusted callback does not change receivable');
select is((select count(*) from apticket.inter_charge_webhook_events where id=current_setting('test.webhook_event')::uuid),1::bigint,'normalized callback event is recorded');
select is((select count(*) from apticket.inter_charge_webhook_events where notified_status='RECEBIDO'),1::bigint,'only safe notification metadata is stored');
select apticket.accept_inter_charge_webhook(
  'sandbox',current_setting('test.webhook_hash'),jsonb_build_array(jsonb_build_object(
    'codigo_solicitacao','fa800000-0000-4000-8000-000000000001',
    'situacao','RECEBIDO','data_hora_situacao','2026-09-10T12:00:00Z'
  ))
);
select is((select count(*) from apticket.inter_charge_webhook_events where request_id=current_setting('test.request')::uuid),1::bigint,'duplicate callback is idempotent');
reset role;
update apticket.inter_charge_requests set bank_synced_at=clock_timestamp()-interval '1 minute'
  where id=current_setting('test.request')::uuid;
set local role service_role;
select set_config('test.webhook_sync',apticket.prepare_inter_charge_sync_from_webhook(
  current_setting('test.request')::uuid,current_setting('test.webhook_event')::uuid
)::text,true);
select is(current_setting('test.webhook_sync')::jsonb->>'state','syncing','callback claims active verification');
select set_config('test.webhook_sync_attempt',current_setting('test.webhook_sync')::jsonb->>'attempt_id',true);
select is((select initiation_source from apticket.inter_charge_sync_attempts where id=current_setting('test.webhook_sync_attempt')::uuid),'webhook','system reconciliation source is explicit');
select apticket.load_inter_charge_sync(current_setting('test.webhook_sync_attempt')::uuid,'fa200000-0000-0000-0000-000000000001');
select apticket.finish_inter_charge_sync(
  current_setting('test.webhook_sync_attempt')::uuid,'synced',200,null,null,
  jsonb_build_object(
    'codigo_solicitacao','fa800000-0000-4000-8000-000000000001','situacao','RECEBIDO',
    'data_situacao',current_date::text,'valor_total_recebido','150.00','origem_recebimento','PIX'
  )
);
select is((select status from apticket.inter_charge_webhook_events where id=current_setting('test.webhook_event')::uuid),'verified','event is verified only after active bank query');
select is((select status_cobranca::text from apticket.contas_receber where id=current_setting('test.receivable')::uuid),'recebido','verified bank state updates receivable');
select is((select valor_aberto from apticket.contas_receber where id=current_setting('test.receivable')::uuid),0::numeric,'verified receipt closes balance');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select throws_ok(format($$select apticket.accept_inter_charge_webhook('sandbox',%L,'[]')$$,current_setting('test.webhook_hash')),'42501',null,'browser cannot accept bank callbacks');
select ok(not has_table_privilege('authenticated','apticket.inter_charge_webhook_events','select'),'callback audit is hidden from browser');
reset role;

update apticket.contas_receber set status_cobranca='a_faturar',valor_aberto=valor_original
  where id=current_setting('test.receivable')::uuid;
update apticket.tenant_inter_configurations set is_active=false
  where tenant_id='fa100000-0000-0000-0000-000000000001' and environment='sandbox';
insert into apticket.tenant_inter_configurations(
  tenant_id,environment,account,secret_id,certificate_expires_at,certificate_fingerprint,is_active,version,updated_by
) values(
  'fa100000-0000-0000-0000-000000000001','production','87654321',
  vault.create_secret('{"client_id":"prod-client","client_secret":"prod-secret","certificate":"prod-certificate","private_key":"prod-key"}'),
  now()+interval '1 year','production-dispatch-fixture',true,1,'fa200000-0000-0000-0000-000000000001'
);
insert into apticket.operating_company_inter_bindings(
  id,tenant_id,operating_company_id,environment,configuration_version,company_tax_id,account_last_four,created_by
) values(
  'fa700000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000001',
  'fa300000-0000-0000-0000-000000000001','production',1,'12345678000195','4321',
  'fa200000-0000-0000-0000-000000000001'
);
set local role service_role;
select set_config('test.production_webhook',apticket.prepare_inter_webhook_registration(
  'fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',
  'production',1,'https://apticket.example.test/backend/webhooks/inter/production'
)::text,true);
select apticket.finish_inter_webhook_registration(
  (current_setting('test.production_webhook')::jsonb->>'attempt_id')::uuid,'registered',204,null,null,
  current_setting('test.production_webhook')::jsonb->>'candidate_token'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select set_config('test.production_fingerprint',apticket.review_inter_payer(current_setting('test.production_request')::uuid)->>'source_fingerprint',true);
select apticket.confirm_inter_payer(
  current_setting('test.production_request')::uuid,current_setting('test.production_fingerprint'),
  'fa700000-0000-0000-0000-000000000002',null,true
);
select set_config('test.production_prepared',apticket.prepare_inter_charge_dispatch(
  current_setting('test.production_request')::uuid,true,true
)::text,true);
select is(current_setting('test.production_prepared')::jsonb->>'state','dispatching','official dispatch is claimed after all safeguards');
select set_config('test.production_attempt',current_setting('test.production_prepared')::jsonb->>'attempt_id',true);
select ok((select production_confirmed_at is not null from apticket.inter_charge_dispatch_attempts where id=current_setting('test.production_attempt')::uuid),'official confirmation is audited on the attempt');
select throws_ok(format($$select apticket.load_inter_charge_dispatch(%L,%L)$$,current_setting('test.production_attempt'),'fa200000-0000-0000-0000-000000000001'),'42501',null,'browser cannot load official credentials');
reset role;
set local role service_role;
select set_config('test.production_dispatch',apticket.load_inter_charge_dispatch(
  current_setting('test.production_attempt')::uuid,'fa200000-0000-0000-0000-000000000001'
)::text,true);
select is(current_setting('test.production_dispatch')::jsonb->>'environment','production','service loads the official environment');
select is(current_setting('test.production_dispatch')::jsonb->>'account','87654321','official account is selected');
select apticket.finish_inter_charge_dispatch(
  current_setting('test.production_attempt')::uuid,'failed',null,422,'TEST_ONLY','No bank request in transaction test'
);
reset role;

select ok(not has_function_privilege('authenticated','apticket.load_inter_charge_dispatch(uuid,uuid)','execute'),'authenticated cannot load dispatch secrets');
select ok(not has_function_privilege('authenticated','apticket.finish_inter_charge_dispatch(uuid,text,uuid,integer,text,text)','execute'),'authenticated cannot finalize attempts');
select ok(has_function_privilege('service_role','apticket.load_inter_charge_dispatch(uuid,uuid)','execute'),'service role can load claimed dispatch');
select ok(not has_function_privilege('authenticated','apticket.load_inter_charge_sync(uuid,uuid)','execute'),'authenticated cannot load reconciliation secrets');
select ok(not has_function_privilege('authenticated','apticket.finish_inter_charge_sync(uuid,text,integer,text,text,jsonb)','execute'),'authenticated cannot finalize reconciliation');
select ok(has_function_privilege('service_role','apticket.load_inter_charge_sync(uuid,uuid)','execute'),'service role can load claimed reconciliation');
select ok(not has_function_privilege('authenticated','apticket.accept_inter_charge_webhook(text,text,jsonb)','execute'),'authenticated cannot accept callbacks');
select ok(has_function_privilege('service_role','apticket.accept_inter_charge_webhook(text,text,jsonb)','execute'),'service role can accept callbacks');
select throws_ok($$delete from apticket.inter_charge_dispatch_attempts$$,'23514',null,'physical attempt deletion blocked');
select throws_ok($$delete from apticket.inter_charge_sync_attempts$$,'23514',null,'physical reconciliation deletion blocked');
select throws_ok($$delete from apticket.inter_charge_webhook_events$$,'23514',null,'physical webhook event deletion blocked');
select ok((select count(*)>=2 from apticket.financial_audit_log where entity_table='inter_charge_dispatch_attempts'),'attempt lifecycle audited');
select ok((select count(*)>=2 from apticket.financial_audit_log where entity_table='inter_charge_sync_attempts'),'reconciliation lifecycle audited');
select ok((select count(*)>=2 from apticket.financial_audit_log where entity_table='inter_charge_webhook_events'),'webhook lifecycle audited');
select * from finish();
rollback;
