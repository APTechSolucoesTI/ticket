begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();

insert into apticket.tenants(id,name,slug) values
 ('fe100000-0000-0000-0000-000000000001','Classificacao A','classificacao-a'),
 ('fe100000-0000-0000-0000-000000000002','Classificacao B','classificacao-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fe200000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','Financeiro Escrita','classificacao-write@example.test',true),
 ('fe200000-0000-0000-0000-000000000002','fe100000-0000-0000-0000-000000000001','Financeiro Leitura','classificacao-read@example.test',true),
 ('fe200000-0000-0000-0000-000000000003','fe100000-0000-0000-0000-000000000002','Financeiro B','classificacao-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'fe200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fe300000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','Operadora A'),
 ('fe300000-0000-0000-0000-000000000003','fe100000-0000-0000-0000-000000000001','Operadora A2'),
 ('fe300000-0000-0000-0000-000000000002','fe100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fe100000-0000-0000-0000-000000000001','fe200000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001',true),
 ('fe100000-0000-0000-0000-000000000001','fe200000-0000-0000-0000-000000000002','fe300000-0000-0000-0000-000000000001',false),
 ('fe100000-0000-0000-0000-000000000002','fe200000-0000-0000-0000-000000000003','fe300000-0000-0000-0000-000000000002',true);

select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fe400000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','Cliente A');
-- Contratos novos exigem classificações analíticas, herdadas pelos movimentos.
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('feb00000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','99.01.0001','Categoria inicial','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('fec00000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','99.01.0001','Centro inicial');
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('fe500000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10,'feb00000-0000-0000-0000-000000000001','fec00000-0000-0000-0000-000000000001');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fe600000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe500000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em) values
 ('fe700000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe600000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe500000-0000-0000-0000-000000000001','fe400000-0000-0000-0000-000000000001','Cliente A','REC-CLASS-001','Mensalidade','2026-01-01',100,100,'2026-02-10','faturado',now());
insert into apticket.suppliers(id,tenant_id,legal_name,category) values
 ('fe800000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','Fornecedor A','datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at,financial_category_id,cost_center_id) values
 ('fe900000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe800000-0000-0000-0000-000000000001','Cloud','fixed',1,80,0,15,'2026-01-01','feb00000-0000-0000-0000-000000000001','fec00000-0000-0000-0000-000000000001');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('fea00000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe800000-0000-0000-0000-000000000001','fe900000-0000-0000-0000-000000000001','PAG-CLASS-001','Cloud janeiro','2026-01-01','2026-02-01','2026-02-15','fixed',1,80,80,'complete','scheduled','{"supplier_name":"Fornecedor A"}'),
 ('fea00000-0000-0000-0000-000000000002','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe800000-0000-0000-0000-000000000001','fe900000-0000-0000-0000-000000000001','PAG-CLASS-002','Cloud fevereiro','2026-02-01','2026-03-01','2026-03-15','fixed',1,80,80,'complete','scheduled','{"supplier_name":"Fornecedor A"}');


insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id in ('fe200000-0000-0000-0000-000000000001','fe200000-0000-0000-0000-000000000003') on conflict(user_id) do update set role_id=excluded.role_id;
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fe200000-0000-0000-0000-000000000004','fe100000-0000-0000-0000-000000000001','Sem acesso','settings-none@example.test',true);
insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,holder_name,holder_tax_id,pix_key_type,pix_key,is_default) values
 ('fef00000-0000-0000-0000-000000000001','fe100000-0000-0000-0000-000000000001','fe300000-0000-0000-0000-000000000001','fe800000-0000-0000-0000-000000000001','Principal','Fornecedor A','12345678000190','email','pagamento@example.test',true);
update apticket.contas_receber set status_cobranca='vencido' where id='fe700000-0000-0000-0000-000000000001';
update apticket.financial_access set can_write=true where user_id='fe200000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is(apticket.get_financial_settings(),' {"use_payable_approvals":true,"use_collection_rules":true}'::jsonb,'padrão mantém ambas as funcionalidades habilitadas');
select throws_ok($$select apticket.save_financial_settings(null,false)$$,'22023',null,'rejeita opção nula');
select throws_ok($$insert into apticket.financial_settings(tenant_id) values('fe100000-0000-0000-0000-000000000001')$$,'42501',null,'não permite gravação direta');
select throws_ok($$update apticket.financial_settings set use_payable_approvals=false$$,'42501',null,'não permite alteração direta');
select throws_ok($$delete from apticket.financial_settings$$,'42501',null,'não permite exclusão direta');
select throws_ok($$select apticket.schedule_supplier_payment('fea00000-0000-0000-0000-000000000001','fef00000-0000-0000-0000-000000000001',current_date,'pix')$$,'23514',null,'Sim exige aprovação antes de programar pagamento');
select lives_ok($$select apticket.save_supplier_approval_policy(null,'fe300000-0000-0000-0000-000000000001','Alçada de teste',0,null,'["fe200000-0000-0000-0000-000000000002"]')$$,'configura alçada por empresa');
select lives_ok($$select apticket.submit_supplier_payable_for_approval('fea00000-0000-0000-0000-000000000002')$$,'inicia aprovação antes de desativar');
select lives_ok($$select apticket.save_financial_settings(false,false)$$,'administrador desativa as duas funcionalidades');
select is(apticket.get_financial_settings(),' {"use_payable_approvals":false,"use_collection_rules":false}'::jsonb,'consulta reflete configuração persistida');
select throws_ok($$select apticket.submit_supplier_payable_for_approval('fea00000-0000-0000-0000-000000000001')$$,'23514',null,'Não bloqueia novos envios para alçada');
select throws_ok($$select apticket.schedule_supplier_payment('fea00000-0000-0000-0000-000000000001','fef00000-0000-0000-0000-000000000001',null,'pix')$$,'23514',null,'dispensar alçada mantém validação do pagamento');
select is((select status from apticket.supplier_payables where id='fea00000-0000-0000-0000-000000000001'),'scheduled','erro de pagamento reverte liberação automática');
select throws_ok($$select apticket.schedule_supplier_payment('fea00000-0000-0000-0000-000000000002','fef00000-0000-0000-0000-000000000001',current_date,'pix')$$,'23514',null,'não dispensa solicitação de aprovação já iniciada');
select lives_ok($$select apticket.schedule_supplier_payment('fea00000-0000-0000-0000-000000000001','fef00000-0000-0000-0000-000000000001',current_date,'pix')$$,'Não permite pagamento sem alçada');
select is((select status from apticket.supplier_payables where id='fea00000-0000-0000-0000-000000000001'),'approved','libera lançamento junto com programação');
select is((select count(*) from apticket.supplier_payable_approval_requests where supplier_payable_id='fea00000-0000-0000-0000-000000000001'),0::bigint,'não cria aprovação fictícia');
select is((select status from apticket.supplier_payable_approval_requests where supplier_payable_id='fea00000-0000-0000-0000-000000000002'),'pending','preserva aprovação em andamento');
select lives_ok($$select apticket.save_collection_policy('fe300000-0000-0000-0000-000000000001',true,1,'[{"days_after_due":0,"channel":"email","message_template":"Lembrete {{documento}}"}]')$$,'preserva configuração da régua por empresa');
select is(apticket.evaluate_collection_policy('fe300000-0000-0000-0000-000000000001',current_date)->>'enabled','false','Não impede processamento manual da régua');
select is((select count(*) from apticket.collection_actions),0::bigint,'Não não cria novas ações');
select is((select count(*) from apticket.financial_domain_events),0::bigint,'Não não cria suspensões');

select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is(apticket.get_financial_settings()->>'use_collection_rules','false','financeiro consulta as opções');
select throws_ok($$select apticket.save_financial_settings(true,true)$$,'42501',null,'financeiro sem permissão administrativa não altera configurações');
select lives_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where status='pending'))$$,'aprovação já iniciada pode ser concluída com opção Não');
select is((select status from apticket.supplier_payables where id='fea00000-0000-0000-0000-000000000002'),'approved','fluxo iniciado preserva resultado da aprovação');

select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is(apticket.get_financial_settings()->>'use_collection_rules','true','outro tenant mantém padrão Sim');
select is((select count(*) from apticket.financial_settings),0::bigint,'RLS oculta configuração de outro tenant');
select lives_ok($$select apticket.save_financial_settings(true,false)$$,'outro tenant pode salvar configuração própria');
select is((select count(*) from apticket.financial_settings),1::bigint,'RLS mostra apenas configuração própria');

select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.get_financial_settings()$$,'42501',null,'usuário sem acesso não consulta RPC');
select is((select count(*) from apticket.financial_settings),0::bigint,'usuário sem acesso não consulta tabela');
select throws_ok($$select apticket.save_financial_settings(true,true)$$,'42501',null,'usuário sem acesso não salva');
select throws_ok($$select apticket.prepare_collection_action_dispatch(gen_random_uuid(),1)$$,'42501',null,'usuário não acessa despacho de serviço');

select set_config('request.jwt.claims','{"sub":"fe200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.save_financial_settings(true,true)$$,'reativa funcionalidades sem perder políticas');
select is(apticket.evaluate_collection_policy('fe300000-0000-0000-0000-000000000001',current_date)->>'actions','1','Sim volta a gerar lembrete');
select is((select count(*) from apticket.financial_domain_events),1::bigint,'Sim volta a gerar evento de suspensão');
reset role;
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='financial_settings' and before_data->>'use_collection_rules'='false' and after_data->>'use_collection_rules'='true'),'auditoria preserva alteração das opções');
insert into storage.objects(bucket_id,name)
 select 'supplier-payment-receipts',tenant_id::text||'/'||operating_company_id::text||'/'||id::text||'/settings-proof.pdf'
 from apticket.supplier_payments where supplier_payable_id='fea00000-0000-0000-0000-000000000001';
set local role authenticated;
select lives_ok($$select apticket.settle_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id='fea00000-0000-0000-0000-000000000001'),clock_timestamp(),80,'SETTINGS-TEST',(select tenant_id::text||'/'||operating_company_id::text||'/'||id::text||'/settings-proof.pdf' from apticket.supplier_payments where supplier_payable_id='fea00000-0000-0000-0000-000000000001'),'settings-proof.pdf','application/pdf',100)$$,'pagamento dispensado segue com baixa e comprovante mesmo após reativar alçada');
select is((select status from apticket.supplier_payables where id='fea00000-0000-0000-0000-000000000001'),'paid','baixa conclui pagamento sem aprovação fictícia');
select lives_ok($$select apticket.save_financial_settings(true,false)$$,'pausa régua com ação e evento já existentes');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select ok(not exists(select 1 from jsonb_array_elements(apticket.claim_collection_actions(500)) item where item->>'tenant_id'='fe100000-0000-0000-0000-000000000001'),'Não impede claim das ações pendentes');
select apticket.process_contract_financial_events(500,current_date);
reset role;
select is((select status::text from apticket.contracts where id='fe500000-0000-0000-0000-000000000001'),'active','Não pausa evento já criado antes da suspensão');
select is((select status from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),'pending','ação pausada permanece disponível para retomada');
select is((select attempt_count::integer from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),0,'pausa não consome tentativas da fila');

-- Simula trabalho obtido pelo worker antes de a configuração ser desativada.
update apticket.collection_actions set status='processing',attempt_count=1 where tenant_id='fe100000-0000-0000-0000-000000000001';
set local role service_role;
select is(apticket.prepare_collection_action_dispatch((select id from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),1),false,'revalida configuração antes do envio externo');
reset role;
select is((select status from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),'pending','trabalho já enfileirado volta para pendente');
select is((select attempt_count::integer from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),0,'devolve tentativa do trabalho pausado');
set local role authenticated;
select lives_ok($$select apticket.save_financial_settings(true,true)$$,'reativa régua para retomar fila');
reset role;
set local role service_role;
select ok(exists(select 1 from jsonb_array_elements(apticket.claim_collection_actions(500)) item where item->>'tenant_id'='fe100000-0000-0000-0000-000000000001'),'Sim retoma ação pendente');
select is(apticket.prepare_collection_action_dispatch((select id from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),1),true,'Sim libera despacho da tentativa atual');
select is(apticket.prepare_collection_action_dispatch((select id from apticket.collection_actions where tenant_id='fe100000-0000-0000-0000-000000000001'),2),false,'tentativa divergente não envia');
reset role;
set local role anon;
select throws_ok($$select apticket.get_financial_settings()$$,'42501',null,'anônimo não consulta configurações');
select throws_ok($$select apticket.save_financial_settings(false,false)$$,'42501',null,'anônimo não altera configurações');
select throws_ok($$select * from apticket.financial_settings$$,'42501',null,'anônimo não consulta tabela');
reset role;
select * from finish();
rollback;
