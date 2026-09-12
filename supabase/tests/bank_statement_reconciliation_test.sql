begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(24);

insert into apticket.tenants(id,name,slug) values
 ('fb100000-0000-0000-0000-000000000001','Banco A','banco-a'),
 ('fb100000-0000-0000-0000-000000000002','Banco B','banco-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fb200000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Financeiro A','bank-a@example.test',true),
 ('fb200000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000002','Financeiro B','bank-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select profile.id,profile.tenant_id,role.id from apticket.profiles profile
join apticket.roles role on role.tenant_id=profile.tenant_id and role.name='Financeiro'
where profile.id::text like 'fb200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fb300000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Operadora A'),
 ('fb300000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000002','Operadora B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fb100000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001',true),
 ('fb100000-0000-0000-0000-000000000002','fb200000-0000-0000-0000-000000000002','fb300000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fb400000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','Cliente A');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento) values
 ('fb500000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','active','2026-01-01','2026-12-31','hours_package',200,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date) values
 ('fb500000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','2026-01-01');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot) values
 ('fb600000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','2026-03-01','2026-04-01','2026-03-01','2026-04-01',120,'2026-03-10','{}'),
 ('fb600000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','2026-04-01','2026-05-01','2026-04-01','2026-05-01',80,'2026-04-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,status_cobranca,aprovado_em) values
 ('fb700000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','Cliente A','REC-120','Receita de março','2026-03-01',120,120,'2026-03-10','faturado',now()),
 ('fb700000-0000-0000-0000-000000000002','fb100000-0000-0000-0000-000000000001','fb600000-0000-0000-0000-000000000002','fb300000-0000-0000-0000-000000000001','fb500000-0000-0000-0000-000000000001','fb400000-0000-0000-0000-000000000001','Cliente A','REC-080','Receita de abril','2026-04-01',80,80,'2026-04-10','faturado',now());

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select lives_ok($$select apticket.save_operating_bank_account(null,'fb300000-0000-0000-0000-000000000001','Conta principal','077','Banco Inter','0001','123456-7','checking',1000,true)$$,'cadastra conta operacional');
select is((select count(*) from apticket.operating_bank_accounts),1::bigint,'grava a conta no escopo');
select ok((select is_default from apticket.operating_bank_accounts),'primeira conta fica principal');
select throws_ok($$select apticket.save_operating_bank_account(null,'fb300000-0000-0000-0000-000000000001','Conta repetida','077','Banco Inter','0001','123456-7','checking',0,false)$$,'23505','Esta conta bancária já está cadastrada.','impede conta duplicada');
select lives_ok($$
  select apticket.import_bank_statement(
    (select id from apticket.operating_bank_accounts),'ofx','marco.ofx',repeat('a',64),
    '2026-03-01','2026-03-31',jsonb_build_array(
      jsonb_build_object('fit_id','FIT-001','posted_at','2026-03-10','amount',120,'transaction_type','CREDIT','memo','Recebimento Cliente A'),
      jsonb_build_object('fit_id','FIT-002','posted_at','2026-03-11','amount',75,'transaction_type','CREDIT','memo','Recebimento com diferença'),
      jsonb_build_object('fit_id','FIT-003','posted_at','2026-03-12','amount',-10,'transaction_type','DEBIT','memo','Tarifa bancária')
    )
  )
$$,'importa extrato OFX normalizado');
select is((select count(*) from apticket.bank_statement_imports),1::bigint,'grava um lote de importação');
select is((select count(*) from apticket.bank_statement_transactions),3::bigint,'grava todos os movimentos');
select is((select reconciliation_status from apticket.bank_statement_transactions where fit_id='FIT-001'),'matched_auto','concilia correspondência única e exata');
select is((select match_source_id from apticket.bank_statement_transactions where fit_id='FIT-001'),'fb700000-0000-0000-0000-000000000001'::uuid,'vincula o recebível correto');
select is((select review_count from apticket.bank_statement_imports),2,'mantém exceções na fila');
select lives_ok($$
  select apticket.import_bank_statement(
    (select id from apticket.operating_bank_accounts),'ofx','marco.ofx',repeat('a',64),
    '2026-03-01','2026-03-31','[{"fit_id":"IGNORED","posted_at":"2026-03-01","amount":1,"memo":"Idempotente"}]'::jsonb
  )
$$,'reprocessamento do mesmo arquivo é idempotente');
select is((select count(*) from apticket.bank_statement_transactions),3::bigint,'reprocessamento não duplica movimentos');
select lives_ok(format($$select apticket.reconcile_bank_transaction('%s','recurring_receivable','fb700000-0000-0000-0000-000000000002','Conferido no extrato')$$,(select id from apticket.bank_statement_transactions where fit_id='FIT-002')),'permite conciliação manual com diferença');
select is((select reconciliation_status from apticket.bank_statement_transactions where fit_id='FIT-002'),'matched_manual','marca conciliação manual');
select is((select difference_amount from apticket.bank_statement_transactions where fit_id='FIT-002'),(-5.00)::numeric,'preserva a diferença encontrada');
select is((select review_count from apticket.bank_statement_imports),1,'atualiza a fila após conciliação');
select lives_ok(format($$select apticket.ignore_bank_transaction('%s','Tarifa bancária sem lançamento interno')$$,(select id from apticket.bank_statement_transactions where fit_id='FIT-003')),'ignora exceção com justificativa');
select is((select status from apticket.bank_statement_imports),'processed','conclui lote sem pendências');
select throws_ok($$update apticket.bank_statement_transactions set amount=999 where fit_id='FIT-001'$$,'42501','permission denied for table bank_statement_transactions','usuário autenticado não altera movimento importado diretamente');

select set_config('request.jwt.claims','{"sub":"fb200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.operating_bank_accounts),0::bigint,'RLS isola contas de outra tenant');
select is((select count(*) from apticket.bank_statement_transactions),0::bigint,'RLS isola movimentos de outra tenant');
reset role;
set local role anon;
select throws_ok($$select * from apticket.bank_statement_imports$$,'42501',null,'anônimo não consulta importações');
reset role;
select ok(not has_function_privilege('anon','apticket.import_bank_statement(uuid,text,text,text,date,date,jsonb)','EXECUTE'),'anônimo não importa extratos');
select cmp_ok((select count(*) from apticket.financial_audit_log where entity_table in ('operating_bank_accounts','bank_statement_imports','bank_statement_transactions')), '>=', 8::bigint,'audita cadastros, importação e conciliação');

select * from finish();
rollback;
