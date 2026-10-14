begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();
insert into apticket.tenants(id,name,slug) values
 ('af100000-0000-0000-0000-000000000001','Rateios A','fixed-tests-a'),
 ('af100000-0000-0000-0000-000000000002','Rateios B','fixed-tests-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('af200000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios Admin','allocations-admin@example.test',true),
 ('af200000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000002','Rateios B','allocations-other@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'af200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('af300000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios operadora A'),
 ('af300000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000002','Rateios operadora B'),
 ('af300000-0000-0000-0000-000000000003','af100000-0000-0000-0000-000000000001','Rateios outra operadora');
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('af400000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','10.01.0001','Categoria A','both'),
 ('af400000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','10.01.0002','Categoria B','both'),
 ('af400000-0000-0000-0000-000000000003','af100000-0000-0000-0000-000000000002','af300000-0000-0000-0000-000000000002','10.01.0001','Categoria outra tenant','both'),
 ('af400000-0000-0000-0000-000000000004','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000003','10.01.0001','Categoria outra operadora','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('af500000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','20.01.0001','Centro A'),
 ('af500000-0000-0000-0000-000000000002','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','20.01.0002','Centro B');
insert into apticket.companies(id,tenant_id,name) values
 ('af600000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios cliente');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('af700000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','af600000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100.01,10,'af400000-0000-0000-0000-000000000001','af500000-0000-0000-0000-000000000001');
insert into apticket.suppliers(id,tenant_id,legal_name,category) values
 ('af800000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','Rateios fornecedor','software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at,financial_category_id,cost_center_id) values
 ('af900000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','af800000-0000-0000-0000-000000000001','Rateios fornecedor fixo','fixed',1,100.01,0,10,'2026-01-01','2026-12-31','af400000-0000-0000-0000-000000000001','af500000-0000-0000-0000-000000000001');

create function pg_temp.payload(p_start date default '2028-01-01',p_end date default '2028-03-01',p_amount numeric default 100.01) returns jsonb language sql as $$
select jsonb_build_object('operating_company_id','af300000-0000-0000-0000-000000000001',
'supplier_id','af800000-0000-0000-0000-000000000001','document_type_id',(select id from apticket.financial_document_types where code='OUT'),
'description','Aluguel mensal','total_amount',p_amount,'start_month',p_start,'end_month',p_end,'due_day',31,'notes','Contrato de locação',
'category_allocations',jsonb_build_array(jsonb_build_object('item_id','af400000-0000-0000-0000-000000000001','percentage',70),jsonb_build_object('item_id','af400000-0000-0000-0000-000000000002','percentage',30)),
'cost_center_allocations',jsonb_build_array(jsonb_build_object('item_id','af500000-0000-0000-0000-000000000001','percentage',60),jsonb_build_object('item_id','af500000-0000-0000-0000-000000000002','percentage',40)));
$$;
create function pg_temp.edit(p_patch jsonb default '{}') returns uuid language sql as $$
select apticket.save_fixed_payable(t.id,t.revision,to_jsonb(t)||p_patch,true) from apticket.fixed_payables t where t.id=current_setting('test.fixed_id')::uuid;
$$;
create function pg_temp.confirm(p_patch jsonb default '{}') returns uuid language sql as $$
select apticket.confirmar_previsao_conta_fixa(o.id,o.revision,to_jsonb(o)||jsonb_build_object('document_number','ALUGUEL-2028-01')||p_patch)
from apticket.fixed_payable_occurrences o where o.id=current_setting('test.occurrence_id')::uuid;
$$;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select set_config('test.fixed_id',apticket.save_fixed_payable(null,null,pg_temp.payload(),true)::text,true)$$,'cria conta fixa sem documento');
select is((select count(*) from apticket.fixed_payable_occurrences),3::bigint,'gera todas as competências do limite inclusive');
select is((select due_date from apticket.fixed_payable_occurrences where competence='2028-02-01'),'2028-02-29'::date,'dia 31 usa último dia em fevereiro bissexto');
select is((select due_date from apticket.fixed_payable_occurrences where competence='2028-01-01'),'2028-01-31'::date,'preserva dia 31 em janeiro');
select is((select count(*) from apticket.supplier_payables),0::bigint,'previsões não criam títulos reais');
select is((select count(*) from apticket.cash_flow_entries where source_type='supplier_payable'),0::bigint,'previsões não entram no fluxo de caixa');
select is((select count(*) from apticket.cash_flow_allocation_entries where source_type='supplier_payable'),0::bigint,'previsões não entram nos relatórios de rateios');
select is(apticket.gerar_previsoes_conta_fixa(current_setting('test.fixed_id')::uuid),0,'geração repetida é idempotente');
select ok((select bool_and(jsonb_array_length(category_allocations)=2 and jsonb_array_length(cost_center_allocations)=2) from apticket.fixed_payable_occurrences),'preserva múltiplos rateios nas previsões');
select set_config('test.occurrence_id',(select id::text from apticket.fixed_payable_occurrences where competence='2028-01-01'),true);
select throws_ok($$select pg_temp.confirm('{"document_number":""}')$$,'23514',null,'documento é obrigatório ao confirmar');
select throws_ok($$select pg_temp.confirm('{"due_date":"2027-12-31"}')$$,'23514',null,'vencimento não antecede competência');
select throws_ok($$select pg_temp.confirm('{"category_allocations":[]}')$$,'23514',null,'falha no rateio reverte confirmação inteira');
select is((select count(*) from apticket.supplier_payables),0::bigint,'falhas não deixam títulos parciais');
select lives_ok($$select set_config('test.payable_id',pg_temp.confirm('{"total_amount":123.45,"due_date":"2028-02-05"}')::text,true)$$,'confirma ocorrência com valor e vencimento ajustados');
select is((select status from apticket.fixed_payable_occurrences where id=current_setting('test.occurrence_id')::uuid),'confirmed','ocorrência passa a confirmada');
select is((select total_amount from apticket.supplier_payables where id=current_setting('test.payable_id')::uuid),123.45::numeric,'título recebe valor confirmado');
select is((select status from apticket.supplier_payables where id=current_setting('test.payable_id')::uuid),'scheduled','título tem estado inicial normal');
select is((select confirmed_payable_id from apticket.fixed_payable_occurrences where id=current_setting('test.occurrence_id')::uuid),current_setting('test.payable_id')::uuid,'vínculo confirmado preserva rastreabilidade');
select is((select total_amount from apticket.fixed_payables where id=current_setting('test.fixed_id')::uuid),100.01::numeric,'confirmar não altera valor do modelo');
select is((select total_amount from apticket.fixed_payable_occurrences where competence='2028-02-01'),100.01::numeric,'confirmar não altera outros meses');
select is((select sum(planned_amount) from apticket.cash_flow_allocation_entries where source_id=current_setting('test.payable_id')::uuid),123.45::numeric,'relatório inclui somente valor confirmado, sem perda de centavos');
select throws_ok($$select pg_temp.confirm()$$,'P0001',null,'não confirma duas vezes a mesma ocorrência');
select is((select count(*) from apticket.supplier_payables),1::bigint,'confirmação repetida não duplica título');
select lives_ok($$select pg_temp.edit('{"total_amount":200,"end_month":"2028-04-01"}')$$,'aplica edição apenas às previsões e amplia limite');
select is((select total_amount from apticket.fixed_payable_occurrences where competence='2028-02-01'),200::numeric,'atualiza previsão futura');
select is((select total_amount from apticket.fixed_payable_occurrences where competence='2028-01-01'),123.45::numeric,'edição nunca modifica ocorrência confirmada');
select is((select total_amount from apticket.supplier_payables where id=current_setting('test.payable_id')::uuid),123.45::numeric,'edição nunca modifica título confirmado');
select is((select count(*) from apticket.fixed_payable_occurrences where deleted_at is null),4::bigint,'ampliação gera somente mês faltante');
select is((select due_date from apticket.fixed_payable_occurrences where competence='2028-04-01'),'2028-04-30'::date,'dia 31 usa dia 30 quando necessário');
select lives_ok($$select apticket.skip_fixed_payable_occurrence(id,revision) from apticket.fixed_payable_occurrences where competence='2028-02-01'$$,'permite pular mês individual');
select is(apticket.gerar_previsoes_conta_fixa(current_setting('test.fixed_id')::uuid),0,'geração não recria mês pulado');
select lives_ok($$select pg_temp.edit('{"end_month":"2028-01-01"}')$$,'reduz limite sem atingir confirmadas');
select is((select count(*) from apticket.fixed_payable_occurrences where deleted_at is null),1::bigint,'remove previsões não confirmadas além do limite');
select lives_ok($$select pg_temp.edit('{"end_month":"2028-04-01"}')$$,'reexpande limite');
select is((select count(*) from apticket.fixed_payable_occurrences where deleted_at is null),3::bigint,'regenera meses removidos pelo limite sem recriar mês pulado');
select lives_ok($$select apticket.save_fixed_payable_occurrence(id,revision,to_jsonb(o)||'{"total_amount":255,"description":"Ajuste individual"}'::jsonb) from apticket.fixed_payable_occurrences o where competence='2028-03-01' and deleted_at is null$$,'edita ocorrência individual');
select is((select total_amount from apticket.fixed_payables where id=current_setting('test.fixed_id')::uuid),200::numeric,'edição individual não altera modelo');
select throws_ok($$select apticket.save_fixed_payable_occurrence(id,revision-1,to_jsonb(o)) from apticket.fixed_payable_occurrences o where competence='2028-03-01' and deleted_at is null$$,'40001',null,'revisão antiga não sobrescreve ocorrência');
select throws_ok($$select apticket.save_fixed_payable(id,revision-1,to_jsonb(t)) from apticket.fixed_payables t where id=current_setting('test.fixed_id')::uuid$$,'40001',null,'revisão antiga não sobrescreve modelo');
select throws_ok($$select pg_temp.edit('{"end_month":"2027-12-01"}')$$,'22023',null,'limite não antecede início');
select throws_ok($$select pg_temp.edit('{"due_day":32}')$$,'22023',null,'dia deve estar entre 1 e 31');
select throws_ok($$select pg_temp.edit('{"total_amount":0}')$$,'22023',null,'valor base deve ser positivo');
select throws_ok($$select pg_temp.edit('{"category_allocations":[]}')$$,'23514',null,'validação de rateio também protege o modelo');
select lives_ok($$select apticket.set_fixed_payable_active(id,revision,false) from apticket.fixed_payables where id=current_setting('test.fixed_id')::uuid$$,'inativa conta fixa');
select is(apticket.gerar_previsoes_conta_fixa(current_setting('test.fixed_id')::uuid),0,'inativa não gera novas previsões');
select lives_ok($$select apticket.set_fixed_payable_active(id,revision,true) from apticket.fixed_payables where id=current_setting('test.fixed_id')::uuid$$,'reativa conta fixa');
select lives_ok($$select apticket.delete_fixed_payable(id,revision) from apticket.fixed_payables where id=current_setting('test.fixed_id')::uuid$$,'exclui modelo logicamente');
select is((select count(*) from apticket.fixed_payable_occurrences where deleted_at is null),1::bigint,'exclusão mantém apenas histórico confirmado');
select is((select count(*) from apticket.supplier_payables where deleted_at is null),1::bigint,'exclusão do modelo preserva título confirmado');
select lives_ok($$select set_config('test.unlimited_id',apticket.save_fixed_payable(null,null,pg_temp.payload(date_trunc('month',timezone('America/Sao_Paulo',clock_timestamp()))::date,null),true)::text,true)$$,'cria recorrência sem limite');
select is((select count(*) from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.unlimited_id')::uuid and deleted_at is null),12::bigint,'janela sem limite tem 12 meses');
select is(apticket.gerar_previsoes_conta_fixa(current_setting('test.unlimited_id')::uuid),0,'janela rolante não duplica meses');
select lives_ok($$select apticket.save_fixed_payable(id,revision,to_jsonb(t)||jsonb_build_object('end_month',(start_month+interval '2 months')::date),true) from apticket.fixed_payables t where id=current_setting('test.unlimited_id')::uuid$$,'converte recorrência indeterminada em finita');
select is((select count(*) from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.unlimited_id')::uuid and deleted_at is null),3::bigint,'redução retira somente previsões além do limite');
select lives_ok($$select apticket.save_fixed_payable(id,revision,to_jsonb(t)||'{"end_month":null}'::jsonb,true) from apticket.fixed_payables t where id=current_setting('test.unlimited_id')::uuid$$,'retirar limite recompõe janela de 12 meses');
select is((select count(*) from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.unlimited_id')::uuid and deleted_at is null),12::bigint,'janela restaurada sem duplicação');
select lives_ok($$select apticket.save_fixed_payable(null,null,pg_temp.payload('2025-01-01','2025-03-01'))$$,'permite modelo com início passado');
select lives_ok($$select apticket.save_fixed_payable(id,revision,to_jsonb(t)||'{"total_amount":333}'::jsonb,true) from apticket.fixed_payables t where start_month='2025-01-01'$$,'edita modelo antigo');
select ok((select bool_and(total_amount=100.01) from apticket.fixed_payable_occurrences where competence between '2025-01-01' and '2025-03-01'),'aplicar futuras não altera previsões de competências passadas');
reset role;
update apticket.fixed_payable_occurrences set deleted_at=clock_timestamp(),deletion_reason='range_changed' where fixed_payable_id=current_setting('test.unlimited_id')::uuid and competence=(select max(competence) from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.unlimited_id')::uuid);
select is(apticket_finance_private.maintain_fixed_payable_forecasts(),1,'rotina global completa lacuna na janela');
select ok(exists(select 1 from cron.job where jobname='apticket-fixed-payable-forecasts' and active),'agendamento está configurado');
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='fixed_payable_occurrences' and after_data->>'status'='confirmed'),'confirmação registra auditoria');
set local role authenticated;
select throws_ok($$select apticket_finance_private.maintain_fixed_payable_forecasts()$$,'42501',null,'cliente não executa rotina global multi-tenant');
select throws_ok($$update apticket.fixed_payables set total_amount=1$$,'42501',null,'cliente não escreve diretamente nos modelos');
select throws_ok($$insert into apticket.fixed_payable_occurrences(id) values(gen_random_uuid())$$,'42501',null,'cliente não cria ocorrência fora dos RPCs');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.fixed_payables),0::bigint,'RLS isola modelos de outro tenant');
select is((select count(*) from apticket.fixed_payable_occurrences),0::bigint,'RLS isola ocorrências de outro tenant');
select throws_ok($$select apticket.gerar_previsoes_conta_fixa(current_setting('test.unlimited_id')::uuid)$$,'P0002',null,'outro tenant não gera previsões');
reset role;
insert into apticket.profiles(id,tenant_id,name,email,is_active) values('af200000-0000-0000-0000-000000000003','af100000-0000-0000-0000-000000000001','Sem acesso','fixed-no-access@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.fixed_payables),0::bigint,'usuário sem permissão não consulta modelos');
select throws_ok($$select apticket.save_fixed_payable(null,null,pg_temp.payload())$$,'42501',null,'usuário sem permissão não cadastra conta fixa');
select throws_ok($$select apticket.gerar_previsoes_conta_fixa(current_setting('test.unlimited_id')::uuid)$$,'42501',null,'usuário sem permissão não gera previsões');
reset role;
insert into apticket.profiles(id,tenant_id,name,email,is_active) values('af200000-0000-0000-0000-000000000004','af100000-0000-0000-0000-000000000001','Aprovador','fixed-approver@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id) select 'af200000-0000-0000-0000-000000000004',tenant_id,id from apticket.roles where tenant_id='af100000-0000-0000-0000-000000000001' and name='Financeiro';
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values('af100000-0000-0000-0000-000000000001','af200000-0000-0000-0000-000000000004','af300000-0000-0000-0000-000000000001',true);
insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,holder_name,holder_tax_id,pix_key_type,pix_key,is_default) values
 ('aff00000-0000-0000-0000-000000000001','af100000-0000-0000-0000-000000000001','af300000-0000-0000-0000-000000000001','af800000-0000-0000-0000-000000000001','Principal','Fornecedor','12345678000190','email','fixed-payment@example.test',true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.schedule_supplier_payment(id,'aff00000-0000-0000-0000-000000000001',current_date,'pix') from apticket.fixed_payable_occurrences where fixed_payable_id=current_setting('test.unlimited_id')::uuid and deleted_at is null limit 1$$,'P0002',null,'previsão não pode ser paga diretamente');
select lives_ok($$select apticket.save_financial_settings(true,true)$$,'habilita alçada normal');
select lives_ok($$select apticket.save_supplier_approval_policy(null,'af300000-0000-0000-0000-000000000001','Alçada de fixas',0,null,'["af200000-0000-0000-0000-000000000004"]')$$,'configura alçada para título confirmado');
select lives_ok($$select apticket.submit_supplier_payable_for_approval(current_setting('test.payable_id')::uuid)$$,'título confirmado segue aprovação normal');
select is((select status from apticket.supplier_payables where id=current_setting('test.payable_id')::uuid),'awaiting_approval','título aguarda aprovação');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.approve_supplier_payable(id) from apticket.supplier_payable_approval_requests where supplier_payable_id=current_setting('test.payable_id')::uuid and status='pending'$$,'aprovador aprova título originado da fixa');
select set_config('request.jwt.claims','{"sub":"af200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select set_config('test.payment_id',apticket.schedule_supplier_payment(current_setting('test.payable_id')::uuid,'aff00000-0000-0000-0000-000000000001',current_date,'pix')::text,true)$$,'título confirmado pode ser programado');
insert into storage.objects(bucket_id,name) values('supplier-payment-receipts','af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/'||current_setting('test.payment_id')||'/fixed-receipt.pdf');
select lives_ok($$select apticket.settle_supplier_payment(current_setting('test.payment_id')::uuid,clock_timestamp(),123.45,'FIXED-TRX','af100000-0000-0000-0000-000000000001/af300000-0000-0000-0000-000000000001/'||current_setting('test.payment_id')||'/fixed-receipt.pdf','fixed-receipt.pdf','application/pdf',100)$$,'título confirmado recebe baixa e comprovante normais');
select is((select status from apticket.supplier_payables where id=current_setting('test.payable_id')::uuid),'paid','baixa marca título como pago');
select is((select confirmed_payable_id from apticket.fixed_payable_occurrences where id=current_setting('test.occurrence_id')::uuid),current_setting('test.payable_id')::uuid,'baixa preserva vínculo e histórico da fixa');
reset role;
set local role anon;
select throws_ok($$select apticket.save_fixed_payable(null,null,'{}')$$,'42501',null,'anônimo não cria conta fixa');
select throws_ok($$select apticket.confirmar_previsao_conta_fixa(gen_random_uuid(),0,'{}')$$,'42501',null,'anônimo não confirma previsão');
reset role;
select * from finish();
rollback;
