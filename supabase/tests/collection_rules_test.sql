begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(40);

insert into apticket.tenants(id,name,slug) values
 ('f1000000-0000-0000-0000-000000000001','Collection A','collection-a'),
 ('f1000000-0000-0000-0000-000000000002','Collection B','collection-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Collector A','collector-a@example.test',true),
 ('f2000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','Collector B','collector-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'f2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('f3000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Operator A'),
 ('f3000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','Operator B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',true),
 ('f1000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('f4000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Customer A'),
 ('f4000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','Customer B');
insert into apticket.contacts(id,tenant_id,company_id,name,email,phone,is_active,can_open_tickets) values
 ('f4100000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','Billing A','billing-a@example.test','+55 (19) 99999-0001',true,true),
 ('f4100000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000002','Billing B','billing-b@example.test','+55 (19) 99999-0002',true,true);
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value) values
 ('f5000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','active','2026-01-01','2027-01-01','hours_package',100),
 ('f5000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000002','active','2026-01-01','2027-01-01','hours_package',100);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,billing_enabled,billing_anchor_month) values
 ('f5000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','2026-01-01',true,'2026-01-01'),
 ('f5000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002','2026-01-01',true,'2026-01-01');
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason) values
 ('f6000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001','f5000000-0000-0000-0000-000000000001','2026-01-01',100,'Initial'),
 ('f6000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002','f5000000-0000-0000-0000-000000000002','2026-01-01',100,'Initial');
set local role service_role;
select apticket.close_billing_cycles('f5000000-0000-0000-0000-000000000001','2026-02-01',5);
select apticket.close_billing_cycles('f5000000-0000-0000-0000-000000000002','2026-02-01',5);
update apticket.contas_receber set status_cobranca='vencido',vencimento_em='2026-02-10'
 where contrato_id::text like 'f5000000-%';
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.save_collection_policy('f3000000-0000-0000-0000-000000000001',true,30,
 '[{"days_after_due":1,"channel":"email","subject":"Reminder","message_template":"Pay {{documento}}","enabled":true},{"days_after_due":5,"channel":"whatsapp","message_template":"Open {{valor}}","enabled":true}]')$$,'financeiro configura a régua');
select is(apticket.get_collection_policy('f3000000-0000-0000-0000-000000000001')->>'configured','true','consulta retorna configuração');
select is(jsonb_array_length(apticket.get_collection_policy('f3000000-0000-0000-0000-000000000001')->'steps'),2,'consulta retorna etapas ordenadas');
select throws_ok($$select apticket.get_collection_policy('f3000000-0000-0000-0000-000000000002')$$,'42501',null,'não consulta empresa de outro tenant');
select throws_ok($$select apticket.save_collection_policy('f3000000-0000-0000-0000-000000000001',true,0,'[]')$$,'22023',null,'prazo de suspensão inválido é rejeitado');
select is(apticket.evaluate_collection_policy('f3000000-0000-0000-0000-000000000001','2026-03-15')->>'actions','2','gera as duas ações vencidas');
select is((select count(*) from apticket.collection_actions),2::bigint,'ações persistidas');
select is((select count(*) from apticket.financial_domain_events),1::bigint,'gera evento de suspensão');
select is((select status::text from apticket.contracts where id='f5000000-0000-0000-0000-000000000001'),'active','evento não suspende contrato diretamente');
select is(apticket.evaluate_collection_policy('f3000000-0000-0000-0000-000000000001','2026-03-15')->>'actions','0','reprocessamento é idempotente');
select is((select count(*) from apticket.financial_domain_events),1::bigint,'evento também é idempotente');
select is((select count(*) from apticket.collection_actions where tenant_id='f1000000-0000-0000-0000-000000000002'),0::bigint,'processamento não atravessa tenant');
select is((select count(*) from apticket.collection_actions where status='pending'),2::bigint,'ações aguardam processador externo');
select is((select recipient_snapshot->>'email' from apticket.collection_actions where channel='email'),'billing-a@example.test','snapshot preserva e-mail do destinatário');
select is((select recipient_snapshot->>'phone' from apticket.collection_actions where channel='whatsapp'),'+55 (19) 99999-0001','snapshot preserva telefone do destinatário');
select throws_ok($$delete from apticket.collection_actions$$,'42501',null,'fila financeira não aceita exclusão física');
select throws_ok($$select apticket.schedule_collection_policies('2026-03-15',10)$$,'42501',null,'usuário não executa rotina automática');
select throws_ok($$select apticket_finance_private.claim_collection_actions(10)$$,'42501',null,'usuário não reivindica ações da fila');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select is(apticket.schedule_collection_policies('2026-03-15',10)->>'policies','1','rotina de serviço processa políticas ativas');
create temporary table claimed_collection_actions(payload jsonb);
insert into claimed_collection_actions select apticket_finance_private.claim_collection_actions(10);
select is(jsonb_array_length((select payload from claimed_collection_actions)),2,'serviço reivindica lote de ações');
select is((select count(*) from apticket.collection_actions where status='processing'),2::bigint,'lote fica em processamento');
select is(apticket_finance_private.finish_collection_action((select id from apticket.collection_actions where channel='email'),true,'mail-1',null,true)->>'status','sent','confirma envio com sucesso');
select is(apticket_finance_private.finish_collection_action((select id from apticket.collection_actions where channel='whatsapp'),false,null,'provider unavailable',false)->>'status','failed','registra falha terminal');
select ok((select next_attempt_at is null from apticket.collection_actions where channel='whatsapp'),'falha não retentável não volta à fila');
select is(apticket.process_contract_financial_events(10,'2026-03-15')->>'suspended_contracts','1','worker suspende contrato elegivel');
select is((select status::text from apticket.contracts where id='f5000000-0000-0000-0000-000000000001'),'suspended','status operacional recebe a suspensao financeira');
select is((select status from apticket.financial_domain_events where event_type='contract.suspended_for_delinquency' and source_id in (select id from apticket.contas_receber where contrato_id='f5000000-0000-0000-0000-000000000001')),'processed','evento de suspensao e concluido');
select is((select count(*) from apticket.contract_financial_holds where contract_id='f5000000-0000-0000-0000-000000000001' and status='active'),1::bigint,'bloqueio financeiro ativo fica registrado');
select ok((select changed_contract_status from apticket.contract_financial_holds where contract_id='f5000000-0000-0000-0000-000000000001'),'bloqueio registra que o status pertence ao fluxo financeiro');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($$select apticket.process_contract_financial_events(10,'2026-03-15')$$,'42501',null,'usuario autenticado nao executa transicao automatica');
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
update apticket.contas_receber set status_cobranca='recebido',valor_aberto=0
 where contrato_id='f5000000-0000-0000-0000-000000000001';
select is(apticket.process_contract_financial_events(10,'2026-03-15')->>'released_contracts','1','baixa libera suspensao pertencente ao financeiro');
select is((select status::text from apticket.contracts where id='f5000000-0000-0000-0000-000000000001'),'active','contrato volta a ativo apos a baixa');
select is((select status from apticket.contract_financial_holds where contract_id='f5000000-0000-0000-0000-000000000001'),'released','bloqueio e encerrado');
select ok((select restored_at is not null from apticket.contract_financial_holds where contract_id='f5000000-0000-0000-0000-000000000001'),'restauracao do contrato e auditavel');
select is((select count(*) from apticket.financial_domain_events where event_type='contract.financial_suspension_released' and aggregate_id='f5000000-0000-0000-0000-000000000001'),1::bigint,'liberacao publica evento de dominio');
select is(apticket.process_contract_financial_events(10,'2026-03-15')->>'released_contracts','0','reprocessamento da baixa e idempotente');
select set_config('apticket.financial_event_processing','off',true);
update apticket.contracts set status='suspended' where id='f5000000-0000-0000-0000-000000000002';
insert into apticket.financial_domain_events(tenant_id,operating_company_id,aggregate_type,aggregate_id,event_type,source_id,payload)
select tenant_id,operating_company_id,'contract',contrato_id,'contract.suspended_for_delinquency',id,'{}'::jsonb
 from apticket.contas_receber where contrato_id='f5000000-0000-0000-0000-000000000002';
select is(apticket.process_contract_financial_events(10,'2026-03-15')->>'ignored_events','1','suspensao manual preexistente nao e assumida pelo financeiro');
select is((select status from apticket.contract_financial_holds where contract_id='f5000000-0000-0000-0000-000000000002'),'ignored','motivo financeiro ignorado fica registrado');
update apticket.contas_receber set status_cobranca='recebido',valor_aberto=0
 where contrato_id='f5000000-0000-0000-0000-000000000002';
select is((with processed as (
  select apticket.process_contract_financial_events(10,'2026-03-15')
) select c.status::text from apticket.contracts c cross join processed
  where c.id='f5000000-0000-0000-0000-000000000002'),'suspended','baixa nao remove suspensao manual');
set local role anon;
select throws_ok($$select apticket.get_collection_policy('f3000000-0000-0000-0000-000000000001')$$,'42501',null,'anônimo não consulta a régua');
select * from finish();
rollback;
