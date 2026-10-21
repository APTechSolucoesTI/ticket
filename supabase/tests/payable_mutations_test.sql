begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();

insert into apticket.tenants(id,name,slug) values
 ('ed100000-0000-0000-0000-000000000001','Classificacao A','classificacao-a'),
 ('ed100000-0000-0000-0000-000000000002','Classificacao B','classificacao-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ed200000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','Financeiro Escrita','classificacao-write@example.test',true),
 ('ed200000-0000-0000-0000-000000000002','ed100000-0000-0000-0000-000000000001','Financeiro Leitura','classificacao-read@example.test',true),
 ('ed200000-0000-0000-0000-000000000003','ed100000-0000-0000-0000-000000000002','Financeiro B','classificacao-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r
  on r.tenant_id=p.tenant_id and r.name='Financeiro' where p.id::text like 'ed200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('ed300000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','Operadora A'),
 ('ed300000-0000-0000-0000-000000000003','ed100000-0000-0000-0000-000000000001','Operadora A2'),
 ('ed300000-0000-0000-0000-000000000002','ed100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('ed100000-0000-0000-0000-000000000001','ed200000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001',true),
 ('ed100000-0000-0000-0000-000000000001','ed200000-0000-0000-0000-000000000002','ed300000-0000-0000-0000-000000000001',false),
 ('ed100000-0000-0000-0000-000000000002','ed200000-0000-0000-0000-000000000003','ed300000-0000-0000-0000-000000000002',true);

select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
insert into apticket.companies(id,tenant_id,name) values
 ('ed400000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','Cliente A');
-- Contratos novos exigem classificações analíticas, herdadas pelos movimentos.
insert into apticket.financial_categories(id,tenant_id,operating_company_id,code,name,direction) values
 ('edb00000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','99.01.0001','Categoria inicial','both');
insert into apticket.financial_cost_centers(id,tenant_id,operating_company_id,code,name) values
 ('edc00000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','99.01.0001','Centro inicial');
insert into apticket.contracts(id,tenant_id,operating_company_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento,financial_category_id,cost_center_id) values
 ('ed500000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',100,10,'edb00000-0000-0000-0000-000000000001','edc00000-0000-0000-0000-000000000001');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('ed600000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed500000-0000-0000-0000-000000000001','2026-01-01','2026-02-01','2026-01-01','2026-02-01',100,'2026-02-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,
 status_cobranca,aprovado_em) values
 ('ed700000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed600000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed500000-0000-0000-0000-000000000001','ed400000-0000-0000-0000-000000000001','Cliente A','REC-CLASS-001','Mensalidade','2026-01-01',100,100,'2026-02-10','faturado',now());
insert into apticket.suppliers(id, tenant_id, legal_name, category) values
 ('ed800000-0000-0000-0000-000000000001', apticket_appsec.fixture_actor('ed100000-0000-0000-0000-000000000001'), 'Fornecedor A', 'datacenter');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at,financial_category_id,cost_center_id) values
 ('ed900000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed800000-0000-0000-0000-000000000001','Cloud','fixed',1,80,0,15,'2026-01-01','edb00000-0000-0000-0000-000000000001','edc00000-0000-0000-0000-000000000001');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,
 total_amount,allocation_status,status,terms_snapshot) values
 ('eda00000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed800000-0000-0000-0000-000000000001','ed900000-0000-0000-0000-000000000001','PAG-CLASS-001','Cloud janeiro','2026-01-01','2026-02-01','2026-02-15','fixed',1,80,80,'complete','scheduled','{"supplier_name":"Fornecedor A"}'),
 ('eda00000-0000-0000-0000-000000000002','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed800000-0000-0000-0000-000000000001','ed900000-0000-0000-0000-000000000001','PAG-CLASS-002','Cloud fevereiro','2026-02-01','2026-03-01','2026-03-15','fixed',1,80,80,'complete','scheduled','{"supplier_name":"Fornecedor A"}');


insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id in ('ed200000-0000-0000-0000-000000000001','ed200000-0000-0000-0000-000000000003') on conflict(user_id) do update set role_id=excluded.role_id;
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('ed200000-0000-0000-0000-000000000004','ed100000-0000-0000-0000-000000000001','Sem acesso','settings-none@example.test',true);
insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,holder_name,holder_tax_id,pix_key_type,pix_key,is_default) values
 ('edf00000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','ed800000-0000-0000-0000-000000000001','Principal','Fornecedor A','12345678000190','email','pagamento@example.test',true);
update apticket.contas_receber set status_cobranca='vencido' where id='ed700000-0000-0000-0000-000000000001';
update apticket.financial_access set can_write=true where user_id='ed200000-0000-0000-0000-000000000002';

insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,billing_enabled,billing_anchor_month)
values('ed500000-0000-0000-0000-000000000001','ed100000-0000-0000-0000-000000000001','ed300000-0000-0000-0000-000000000001','2026-01-01',true,'2026-01-01') on conflict(contract_id) do nothing;
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,total_amount,allocation_status,status,terms_snapshot)
select 'eda00000-0000-0000-0000-000000000003',tenant_id,operating_company_id,supplier_id,supplier_contract_id,'PAG-PAID','Conta já paga','2026-03-01','2026-04-01','2026-03-15',billing_unit,measured_quantity,unit_price,total_amount,'complete','paid',terms_snapshot
from apticket.supplier_payables where id='eda00000-0000-0000-0000-000000000002';

create function pg_temp.manual_id(p_number integer) returns uuid language sql stable as $$
 select id from apticket.supplier_payables where document_base_number='PARCELAS' and installment_number=p_number;
$$;
create function pg_temp.change(p_id uuid,p_description text default 'Descrição corrigida',p_amount numeric default null,p_revision integer default null,p_competence date default null)
returns boolean language plpgsql as $$
declare p apticket.supplier_payables;
begin
 select * into p from apticket.supplier_payables where id=p_id;
 return apticket.update_supplier_payable(p.id,coalesce(p_revision,p.revision),p.document_number,p_description,
   coalesce(p_competence,p.cycle_start),coalesce(p_competence+29,p.due_date),coalesce(p_amount,p.total_amount),'Correção solicitada no teste');
end $$;
create function pg_temp.remove(p_id uuid) returns boolean language sql as $$
 select apticket.delete_supplier_payable(p_id,(select revision from apticket.supplier_payables where id=p_id),'Documento lançado indevidamente');
$$;

set local role authenticated;
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.create_manual_supplier_payable('ed300000-0000-0000-0000-000000000001','ed800000-0000-0000-0000-000000000001',(select id from apticket.financial_document_types where code='OUT'),'PARCELAS','Compra parcelada','2026-10-01',200,'[{"number":1,"due_date":"2026-10-30","amount":100},{"number":2,"due_date":"2026-11-30","amount":100}]',30,null)$$,'cria conta manual parcelada');
select is((select revision from apticket.supplier_payables where id=pg_temp.manual_id(1)),0,'conta nova inicia revisão zero');
select throws_ok($$select pg_temp.change(pg_temp.manual_id(1),'Descrição inválida',0)$$,'22023',null,'rejeita valor manual zero');
select throws_ok($$select pg_temp.change(pg_temp.manual_id(1),'Compra parcelada')$$,'22023',null,'rejeita gravação sem alteração');
select lives_ok($$select pg_temp.change(pg_temp.manual_id(1),'Compra corrigida',125.55,null,'2026-11-01')$$,'altera valor e competência de uma parcela manual');
select is((select total_amount from apticket.supplier_payables where id=pg_temp.manual_id(1)),125.55::numeric,'valor alterado persistido');
select is((select total_amount from apticket.supplier_payables where id=pg_temp.manual_id(2)),100::numeric,'outra parcela preservada');
select is((select cycle_start from apticket.supplier_payables where id=pg_temp.manual_id(1)),'2026-11-01'::date,'atualiza competência');
select is((select cycle_end from apticket.supplier_payables where id=pg_temp.manual_id(1)),'2026-12-01'::date,'atualiza término do período manual');
select is((select revision from apticket.supplier_payables where id=pg_temp.manual_id(1)),1,'incrementa revisão da alteração');
select is((select planned_amount from apticket.cash_flow_entries where source_id=pg_temp.manual_id(1)),125.55::numeric,'fluxo de caixa reflete novo valor');
select is((select updated_at from apticket.cash_flow_entries where source_id=pg_temp.manual_id(1)),(select updated_at from apticket.supplier_payables where id=pg_temp.manual_id(1)),'fluxo de caixa reflete data da alteração');
select throws_ok($$select pg_temp.change(pg_temp.manual_id(1),'Alteração concorrente',130,0)$$,'40001',null,'rejeita formulário desatualizado');
select lives_ok($$select apticket.save_supplier_approval_policy(null,'ed300000-0000-0000-0000-000000000001','Alçada de edição',0,null,'["ed200000-0000-0000-0000-000000000002"]')$$,'configura alçada de aprovação');
select lives_ok($$select apticket.submit_supplier_payable_for_approval(pg_temp.manual_id(1))$$,'envia manual para aprovação');
select throws_ok($$select apticket.update_supplier_payable(pg_temp.manual_id(1),(select revision from apticket.supplier_payables where id=pg_temp.manual_id(1)),(select document_number from apticket.supplier_payables where id=pg_temp.manual_id(2)),'Duplicado','2026-11-01','2026-11-30',125.55,'Tentativa duplicada')$$,'23505',null,'rejeita documento duplicado');
select is((select count(*) from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1) and status='pending'),1::bigint,'erro de alteração preserva aprovação pendente');
select lives_ok($$select pg_temp.change(pg_temp.manual_id(1),'Corrigida durante aprovação',126)$$,'altera conta em aprovação');
select is((select status from apticket.supplier_payables where id=pg_temp.manual_id(1)),'scheduled','alteração volta lançamento para revisão');
select is((select status from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1)),'cancelled','encerra aprovação anterior');
select is((select status from apticket.supplier_payable_approval_steps where request_id in(select id from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1))),'cancelled','encerra etapa pendente');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1)))$$,'23514',null,'aprovação antiga não pode liberar nova versão');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.submit_supplier_payable_for_approval(pg_temp.manual_id(1))$$,'permite novo envio para alçada');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select apticket.approve_supplier_payable((select id from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1) and status='pending'))$$,'aprova a versão revisada');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select lives_ok($$select pg_temp.change(pg_temp.manual_id(1),'Corrigida após aprovação',127)$$,'altera conta aprovada sem pagamento');
select is((select status from apticket.supplier_payables where id=pg_temp.manual_id(1)),'scheduled','conta aprovada volta para revisão');
select is((select count(*) from apticket.supplier_payable_approval_requests where supplier_payable_id=pg_temp.manual_id(1) and status='cancelled'),2::bigint,'histórico das duas versões preservado');
select is((select count(*) from apticket.supplier_payable_approval_steps where status='approved'),1::bigint,'decisão histórica permanece registrada');
select lives_ok($$select apticket.save_financial_settings(false,true)$$,'desativa alçada para testar pagamento direto');
select lives_ok($$select apticket.schedule_supplier_payment(pg_temp.manual_id(1),'edf00000-0000-0000-0000-000000000001',current_date,'pix')$$,'programa pagamento da versão corrigida');
select throws_ok($$select pg_temp.change(pg_temp.manual_id(1))$$,'P0001',null,'pagamento programado bloqueia alteração');
select throws_ok($$select pg_temp.remove(pg_temp.manual_id(1))$$,'P0001',null,'pagamento programado bloqueia exclusão');
select lives_ok($$select apticket.cancel_supplier_payment((select id from apticket.supplier_payments where supplier_payable_id=pg_temp.manual_id(1)),'Cancelar para corrigir a conta')$$,'cancela programação antes da exclusão');
select lives_ok($$select pg_temp.remove(pg_temp.manual_id(1))$$,'exclui logicamente uma parcela');
select ok((select deleted_at is not null and status='cancelled' from apticket.supplier_payables where id=pg_temp.manual_id(1)),'registro excluído permanece no banco');
select is((select count(*) from apticket.supplier_payables where document_base_number='PARCELAS' and deleted_at is null),1::bigint,'outra parcela continua visível');
select is((select count(*) from apticket.cash_flow_entries where source_id=pg_temp.manual_id(1)),0::bigint,'exclusão retira conta do fluxo de caixa');
select is((select count(*) from apticket.supplier_payments where supplier_payable_id=pg_temp.manual_id(1)),1::bigint,'histórico de pagamento cancelado preservado');
select throws_ok($$select pg_temp.remove(pg_temp.manual_id(1))$$,'P0002',null,'não exclui duas vezes');

select lives_ok($$select pg_temp.change('eda00000-0000-0000-0000-000000000001','Documento contratual corrigido')$$,'permite corrigir descrição contratual');
select throws_ok($$select pg_temp.change('eda00000-0000-0000-0000-000000000001','Valor contratual alterado',81)$$,'P0001',null,'preserva valor calculado por contrato');
select throws_ok($$select pg_temp.change('eda00000-0000-0000-0000-000000000001','Período contratual alterado',null,null,'2026-02-01')$$,'P0001',null,'preserva ciclo do contrato');
select lives_ok($$select pg_temp.remove('eda00000-0000-0000-0000-000000000001')$$,'permite excluir lançamento contratual');
select lives_ok($$select apticket.generate_supplier_payable('ed900000-0000-0000-0000-000000000001','2026-01-01')$$,'permite gerar novamente ciclo excluído');
select is((select count(*) from apticket.supplier_payables where supplier_contract_id='ed900000-0000-0000-0000-000000000001' and cycle_start='2026-01-01' and deleted_at is null),1::bigint,'mantém somente um ciclo ativo');

select lives_ok($$select apticket.save_financial_settings(true,true)$$,'reativa alçada para testar exclusão em aprovação');
select throws_ok($$select pg_temp.change('eda00000-0000-0000-0000-000000000003')$$,'P0001',null,'conta paga bloqueia alteração');
select throws_ok($$select pg_temp.remove('eda00000-0000-0000-0000-000000000003')$$,'P0001',null,'conta paga bloqueia exclusão');
select lives_ok($$select apticket.save_supplier_allocation_rules('ed900000-0000-0000-0000-000000000001','2026-01-01','[{"customer_contract_id":"ed500000-0000-0000-0000-000000000001","percentage":100}]')$$,'cria rateio no ciclo regenerado');
select is((select count(*) from apticket.supplier_payable_allocations where deleted_at is null),1::bigint,'rateio ativo criado');
select lives_ok($$select pg_temp.remove((select id from apticket.supplier_payables where supplier_contract_id='ed900000-0000-0000-0000-000000000001' and cycle_start='2026-01-01' and deleted_at is null))$$,'exclui lançamento que possui rateio');
select is((select count(*) from apticket.supplier_payable_allocations where deleted_at is null),0::bigint,'exclusão retira rateio ativo');
select is((select sum(amount) from apticket.supplier_payable_allocations),80::numeric,'rateio original permanece no histórico');
select lives_ok($$select apticket.submit_supplier_payable_for_approval('eda00000-0000-0000-0000-000000000002')$$,'envia contrato para aprovação');
select lives_ok($$select pg_temp.remove('eda00000-0000-0000-0000-000000000002')$$,'exclui conta em aprovação');
select is((select status from apticket.supplier_payable_approval_requests where supplier_payable_id='eda00000-0000-0000-0000-000000000002'),'cancelled','exclusão encerra solicitação pendente');
select throws_ok($$update apticket.supplier_payables set description='Alteração direta'$$,'42501',null,'cliente não pode alterar tabela diretamente');
select throws_ok($$delete from apticket.supplier_payables$$,'42501',null,'cliente não apaga registros físicos');
select throws_ok($$select apticket_finance_private.prepare_payable_mutation(pg_temp.manual_id(2),0)$$,'42501',null,'helper privado não é exposto');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000004","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select pg_temp.change(pg_temp.manual_id(2))$$,'42501',null,'usuário sem permissão não altera');
select throws_ok($$select pg_temp.remove(pg_temp.manual_id(2))$$,'42501',null,'usuário sem permissão não exclui');
select set_config('request.jwt.claims',apticket_appsec.claims('{"sub":"ed200000-0000-0000-0000-000000000003","role":"authenticated","app":"apticket"}'::jsonb)::text,true);
select throws_ok($$select pg_temp.change('eda00000-0000-0000-0000-000000000002')$$,'P0002',null,'outro tenant não altera lançamento');
select throws_ok($$select pg_temp.remove('eda00000-0000-0000-0000-000000000002')$$,'P0002',null,'outro tenant não exclui lançamento');
reset role;
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='supplier_payables' and entity_id=pg_temp.manual_id(1) and before_data->>'total_amount'='100.00' and after_data->>'total_amount'='125.55'),'auditoria guarda valor anterior e corrigido');
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='supplier_payables' and entity_id=pg_temp.manual_id(1) and after_data->>'deleted_at' is not null and after_data->>'last_change_reason'='Documento lançado indevidamente'),'auditoria guarda exclusão e motivo');
select is(current_setting('apticket.payable_mutation',true),'','contexto privilegiado é restaurado');
set local role anon;
select throws_ok($$select apticket.update_supplier_payable(gen_random_uuid(),0,'DOC-01','Descrição','2026-10-01','2026-10-30',10,'Correção')$$,'42501',null,'anônimo não altera');
select throws_ok($$select apticket.delete_supplier_payable(gen_random_uuid(),0,'Exclusão')$$,'42501',null,'anônimo não exclui');
reset role;
select * from finish();
rollback;
