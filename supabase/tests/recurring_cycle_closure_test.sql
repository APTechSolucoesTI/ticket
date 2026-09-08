begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select no_plan();

insert into apticket.tenants(id,name,slug) values
 ('e1000000-0000-0000-0000-000000000001','Cycle test A','cycle-test-a'),
 ('e1000000-0000-0000-0000-000000000002','Cycle test B','cycle-test-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active)
select ('e2000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'e1000000-0000-0000-0000-000000000002'::uuid else 'e1000000-0000-0000-0000-000000000001'::uuid end,
 'Cycle user '||n,'cycle-'||n||'@example.test',true from generate_series(1,3) n;
insert into apticket.user_roles(user_id,tenant_id,role_id)
select p.id,p.tenant_id,r.id from apticket.profiles p join apticket.roles r on r.tenant_id=p.tenant_id and r.name='Admin'
where p.id::text like 'e2000000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name)
select ('e3000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=3 then 'e1000000-0000-0000-0000-000000000002'::uuid else 'e1000000-0000-0000-0000-000000000001'::uuid end,
 'Cycle operator '||n from generate_series(1,3) n;
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',true),
 ('e1000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002',null,true),
 ('e1000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000003','e3000000-0000-0000-0000-000000000003',true);
insert into apticket.companies(id,tenant_id,name) values
 ('e4000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','Cycle client A'),
 ('e4000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000002','Cycle client B');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
select ('e5000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case when n=10 then 'e1000000-0000-0000-0000-000000000002'::uuid else 'e1000000-0000-0000-0000-000000000001'::uuid end,
 case when n=10 then 'e4000000-0000-0000-0000-000000000002'::uuid else 'e4000000-0000-0000-0000-000000000001'::uuid end,
 'active',case when n=2 then '2026-01-16'::date when n=9 then '2024-01-31'::date else '2026-01-01'::date end,
 case when n=3 then '2026-01-15'::date when n=9 then '2024-04-29'::date else '2026-12-31'::date end,
 'hours_package',100,15 from generate_series(1,10) n;

-- Cobrança legada antes de ativar a recorrência do contrato 7.
select set_config('request.jwt.claim.role','service_role',true);
select apticket.gerar_medicoes_contrato('e5000000-0000-0000-0000-000000000007','2026-01-01',true);
insert into apticket.contas_receber(tenant_id,medicao_id,contrato_id,company_id,cliente_nome,documento_referencia,
 descricao,competencia,valor_original,valor_aberto,vencimento_em,aprovado_em)
select tenant_id,id,contrato_id,'e4000000-0000-0000-0000-000000000001','Cycle client A','LEGACY','Legacy test',
 competencia,100,100,'2026-02-15',now() from apticket.medicoes_contrato where contrato_id='e5000000-0000-0000-0000-000000000007';
select set_config('request.jwt.claim.role','',true);

insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,adjustment_base_date,
 billing_enabled,billing_anchor_month,required_metrics,billing_interval_months,cutoff_day)
select c.id,c.tenant_id,
 case when right(c.id::text,2)='10' then 'e3000000-0000-0000-0000-000000000003'::uuid
 when right(c.id::text,2)='02' then 'e3000000-0000-0000-0000-000000000002'::uuid else 'e3000000-0000-0000-0000-000000000001'::uuid end,
 '2027-01-01',right(c.id::text,2)<>'08',case when right(c.id::text,2)='09' then '2024-01-01'::date else '2026-01-01'::date end,
 case when right(c.id::text,2) in ('05','06') then array['devices'] else '{}'::text[] end,
 case when right(c.id::text,2)='09' then 3 else 1 end,case when right(c.id::text,2)='09' then 31 else 1 end
from apticket.contracts c where c.id::text like 'e5000000-%';
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
select ('e6000000-0000-0000-0000-'||right(c.id::text,12))::uuid,c.tenant_id,f.operating_company_id,c.id,c.starts_at,100,'Initial'
from apticket.contracts c join apticket.contract_financial_terms f on f.contract_id=c.id where c.id::text like 'e5000000-%';
insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason,adjustment_index,applied_percentage)
values('e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',
 'e5000000-0000-0000-0000-000000000004','2026-01-16',110,'Reajuste','IPCA',10);
insert into apticket.consumption_snapshots(tenant_id,operating_company_id,contract_id,value_version_id,cycle_start,cycle_end,
 metric,measured_quantity,included_quantity,unit_price,source_type,source_items)
select tenant_id,operating_company_id,contract_id,id,'2026-01-01','2026-02-01','devices',12,2,5.125,'fixture','[{"id":"device-snapshot"}]'
from apticket.contract_value_versions where contract_id in ('e5000000-0000-0000-0000-000000000005','e5000000-0000-0000-0000-000000000006');

set local role service_role;
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000001','2026-01-31',50)->>'generated','0','não fecha antes do corte');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000001','2026-02-01',50)->>'generated','1','fecha ciclo completo');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000001'),100::numeric,'valor mensal integral');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000001','2026-02-01',50)->>'generated','0','retry não duplica ciclo');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000002','2026-02-01',50)->>'generated','1','fecha início parcial');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000002'),51.61::numeric,'pró-rata de início: 16 de 31 dias');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000003','2026-02-01',50)->>'generated','1','fecha término parcial');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000003'),48.39::numeric,'pró-rata de término: 15 de 31 dias');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000004','2026-02-01',50)->>'generated','1','fecha com reajuste intermediário');
select is((select count(*) from apticket.billing_cycle_items where contract_id='e5000000-0000-0000-0000-000000000004'),2::bigint,'uma parcela por versão vigente');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000004'),105.16::numeric,'reajuste proporcional e arredondado por item');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000005','2026-02-01',50)->>'generated','1','fecha fixo e variável');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000005'),151.25::numeric,'100 fixos mais 10 dispositivos a 5,125');
select is((select count(*) from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000005'),1::bigint,'gera recebível no financeiro existente');
select is((select vencimento_em from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000005'),'2026-02-15'::date,'reutiliza cálculo de vencimento');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000006','2026-03-01',50)->>'generated','1','ciclo anterior é mantido se próximo falhar');
select is(jsonb_array_length(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000006','2026-03-01',50)->'errors'),1,'consumo ausente gera erro explícito');
select is((select count(*) from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000006'),1::bigint,'falha não deixa ciclo incompleto');
select is(jsonb_array_length(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000007','2026-02-01',50)->'errors'),1,'bloqueia duplicidade com medição legada');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000008','2026-02-01',50)->>'generated','0','opt-in desativado não gera cobrança');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000009','2024-04-30',50)->>'generated','1','trimestre inclui fevereiro bissexto');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000009'),300::numeric,'trimestre integral multiplica base mensal por três');
select is(apticket_finance_private.cutoff_date('2024-02-01',31),'2024-02-29'::date,'corte 31 limitado ao fim do mês');
select is((select vencimento_em from apticket.contas_receber where contrato_id='e5000000-0000-0000-0000-000000000009'),'2024-05-15'::date,'vencimento não antecede fechamento');
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000010','2026-02-01',50)->>'generated','1','job processa segundo tenant com vínculo correto');
select throws_ok($$select apticket.close_billing_cycles(null,'2999-01-01',50)$$,'22023',null,'data futura rejeitada');
select throws_ok($$update apticket.consumption_snapshots set deleted_at=now() where contract_id='e5000000-0000-0000-0000-000000000005'$$,'23514',null,'fonte faturada não pode ser excluída');

reset role;
insert into apticket.consumption_snapshots(tenant_id,operating_company_id,contract_id,value_version_id,cycle_start,cycle_end,
 metric,measured_quantity,included_quantity,unit_price,source_type,source_items)
values('e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001',
 'e5000000-0000-0000-0000-000000000006','e6000000-0000-0000-0000-000000000006',
 '2026-02-01','2026-03-01','devices',0,2,5.125,'fixture','[]');
set local role service_role;
select is(apticket.close_billing_cycles('e5000000-0000-0000-0000-000000000006','2026-03-01',50)->>'generated','1','retry conclui após apuração faltante chegar');
select is((select total_amount from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000006' and cycle_start='2026-02-01'),100::numeric,'consumo zero explícito mantém somente parcela fixa');
reset role;
select throws_ok($$update apticket.billing_cycles set total_amount=1 where contract_id='e5000000-0000-0000-0000-000000000001'$$,'23514',null,'total fechado imutável');
select throws_ok($$update apticket.billing_cycle_items set quantity=1 where contract_id='e5000000-0000-0000-0000-000000000001'$$,'23514',null,'itens fechados imutáveis');
select throws_ok($$delete from apticket.billing_cycles where contract_id='e5000000-0000-0000-0000-000000000001'$$,'23514',null,'sem exclusão física de ciclo');
select throws_ok($$update apticket.contract_financial_terms set cutoff_day=2 where contract_id='e5000000-0000-0000-0000-000000000001'$$,'23514',null,'calendário faturado protegido');
select throws_ok($$insert into apticket.contract_value_versions(tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
 values('e1000000-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','e5000000-0000-0000-0000-000000000001','2026-01-15',120,'Retroativo')$$,
 '23514',null,'reajuste retroativo bloqueado mesmo em ciclo sem variável');
select is((select count(*) from apticket.billing_cycles b where total_amount<>(select sum(amount) from apticket.billing_cycle_items i where i.billing_cycle_id=b.id)),0::bigint,'todos os totais conferem com os itens');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select throws_ok($$select apticket.close_billing_cycles()$$,'42501',null,'usuário não pode chamar job de serviço');
select is((select count(*) from apticket.billing_cycles where operating_company_id<>'e3000000-0000-0000-0000-000000000001'),0::bigint,'RLS dos ciclos isola empresa');
select is((select count(*) from apticket.billing_cycle_items where operating_company_id<>'e3000000-0000-0000-0000-000000000001'),0::bigint,'RLS dos itens isola empresa');
select is((select count(*) from apticket.contas_receber where billing_cycle_id is not null and operating_company_id<>'e3000000-0000-0000-0000-000000000001'),0::bigint,'política legada não vaza recebível da empresa irmã');
select lives_ok($$update apticket.contas_receber set status_cobranca='faturado' where contrato_id='e5000000-0000-0000-0000-000000000001'$$,'financeiro autorizado atualiza status no fluxo existente');
select ok(exists(select 1 from apticket.financial_audit_log where entity_table='contas_receber' and operation='UPDATE'
 and actor_id='e2000000-0000-0000-0000-000000000001' and after_data->>'status_cobranca'='faturado'),'auditoria da mudança de status financeiro');
select throws_ok($$update apticket.contas_receber set operating_company_id='e3000000-0000-0000-0000-000000000002' where contrato_id='e5000000-0000-0000-0000-000000000001'$$,'23514',null,'empresa do recebível não pode ser trocada');
select set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.billing_cycles where operating_company_id='e3000000-0000-0000-0000-000000000002'),1::bigint,'grupo vê empresa irmã');
select is((select count(*) from apticket.billing_cycles where tenant_id='e1000000-0000-0000-0000-000000000002'),0::bigint,'grupo não atravessa tenant');
set local role anon;
select throws_ok($$select * from apticket.billing_cycles$$,'42501',null,'anônimo não consulta ciclos');
select throws_ok($$select apticket.close_billing_cycles()$$,'42501',null,'anônimo não fecha ciclos');
reset role;
select * from finish();
rollback;
