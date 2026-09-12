begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,apticket,pg_catalog;
select plan(14);

insert into apticket.tenants(id,name,slug) values
 ('fa100000-0000-0000-0000-000000000001','Analytics A','analytics-a'),
 ('fa100000-0000-0000-0000-000000000002','Analytics B','analytics-b');
insert into apticket.profiles(id,tenant_id,name,email,is_active) values
 ('fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Financeiro A','analytics-a@example.test',true),
 ('fa200000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000002','Financeiro B','analytics-b@example.test',true);
insert into apticket.user_roles(user_id,tenant_id,role_id)
select profile.id,profile.tenant_id,role.id from apticket.profiles profile join apticket.roles role
  on role.tenant_id=profile.tenant_id and role.name='Financeiro'
where profile.id::text like 'fa200000-%';
insert into apticket.operating_companies(id,tenant_id,legal_name) values
 ('fa300000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Operadora Analytics A'),
 ('fa300000-0000-0000-0000-000000000002','fa100000-0000-0000-0000-000000000002','Operadora Analytics B');
insert into apticket.financial_access(tenant_id,user_id,operating_company_id,can_write) values
 ('fa100000-0000-0000-0000-000000000001','fa200000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001',true),
 ('fa100000-0000-0000-0000-000000000002','fa200000-0000-0000-0000-000000000002','fa300000-0000-0000-0000-000000000002',true);
insert into apticket.companies(id,tenant_id,name) values
 ('fa400000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','Cliente Rentável');
insert into apticket.contracts(id,tenant_id,company_id,status,starts_at,ends_at,billing_model,monthly_value,dia_vencimento)
values ('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001','active',(date_trunc('month',current_date)-interval '1 year')::date,(date_trunc('month',current_date)+interval '2 years')::date,'hours_package',3000,10);
insert into apticket.contract_financial_terms(contract_id,tenant_id,operating_company_id,
 billing_interval_months,adjustment_base_date,billing_enabled,billing_anchor_month)
values ('fa500000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001',3,(date_trunc('month',current_date)-interval '1 year')::date,true,date_trunc('month',current_date)::date);
insert into apticket.contract_value_versions(id,tenant_id,operating_company_id,contract_id,effective_from,base_amount,reason)
values ('fa600000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001',(date_trunc('month',current_date)-interval '1 year')::date,3000,'Valor inicial');
insert into apticket.consumption_snapshots(id,tenant_id,operating_company_id,contract_id,value_version_id,
 cycle_start,cycle_end,metric,measured_quantity,included_quantity,unit_price,source_type,source_items)
values ('fa700000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','fa600000-0000-0000-0000-000000000001','2026-08-01','2026-09-01','devices',1,0,400,'fixture','[]');
insert into apticket.billing_cycles(id,tenant_id,operating_company_id,contract_id,cycle_start,cycle_end,
 service_start,service_end,total_amount,due_date,terms_snapshot)
values ('fa800000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','2026-08-01','2026-09-01','2026-08-01','2026-09-01',1000,'2026-08-10','{}');
insert into apticket.contas_receber(id,tenant_id,billing_cycle_id,operating_company_id,contrato_id,company_id,
 cliente_nome,documento_referencia,descricao,competencia,valor_original,valor_aberto,vencimento_em,status_cobranca,aprovado_em)
values ('fa900000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa800000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','fa400000-0000-0000-0000-000000000001','Cliente Rentável','REC-ANALYTICS','Receita contratual','2026-08-01',1000,200,'2026-08-10','faturado',now());
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
insert into apticket.suppliers(id,tenant_id,operating_company_id,legal_name,category)
values ('faa00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','Fornecedor Analytics','software_licensing');
insert into apticket.supplier_contracts(id,tenant_id,operating_company_id,supplier_id,description,billing_unit,
 billing_interval_months,base_amount,unit_price,due_day,starts_at,ends_at)
values ('fab00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','faa00000-0000-0000-0000-000000000001','Custo direto','devices',1,0,400,10,'2026-01-01','2026-12-31');
insert into apticket.supplier_payables(id,tenant_id,operating_company_id,supplier_id,supplier_contract_id,
 document_number,description,cycle_start,cycle_end,due_date,billing_unit,measured_quantity,unit_price,total_amount,
 allocation_status,status,terms_snapshot)
values ('fac00000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','faa00000-0000-0000-0000-000000000001','fab00000-0000-0000-0000-000000000001','PAY-ANALYTICS','Custo direto','2026-08-01','2026-09-01','2026-08-10','devices',1,400,400,'complete','approved','{}');
insert into apticket.supplier_payable_allocations(tenant_id,operating_company_id,supplier_payable_id,
 customer_contract_id,consumption_snapshot_id,customer_name,contract_number,metric,quantity,unit_price,source_snapshot)
values ('fa100000-0000-0000-0000-000000000001','fa300000-0000-0000-0000-000000000001','fac00000-0000-0000-0000-000000000001','fa500000-0000-0000-0000-000000000001','fa700000-0000-0000-0000-000000000001','Cliente Rentável',(select numero_contrato from apticket.contracts where id='fa500000-0000-0000-0000-000000000001'),'devices',1,400,'{}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000001","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.contract_profitability),1::bigint,'consolida uma linha de rentabilidade');
select is((select gross_revenue from apticket.contract_profitability),1000::numeric,'totaliza a receita contratual');
select is((select realized_revenue from apticket.contract_profitability),800::numeric,'separa a receita realizada');
select is((select allocated_cost from apticket.contract_profitability),400::numeric,'atribui somente o custo rateado');
select is((select gross_profit from apticket.contract_profitability),600::numeric,'calcula lucro bruto');
select is((select gross_margin_percent from apticket.contract_profitability),60::numeric,'calcula margem percentual');
select is((select customer_name from apticket.contract_profitability),'Cliente Rentável','identifica o cliente');
select is((select count(*) from apticket.contract_mrr_projection),12::bigint,'projeta doze competências');
select is((select min(baseline_mrr) from apticket.contract_mrr_projection),1000::numeric,'normaliza contrato trimestral em MRR');
select ok(not exists(select 1 from apticket.contract_mrr_projection where missing_value_version),'projeção possui versão de valor');
select set_config('request.jwt.claims','{"sub":"fa200000-0000-0000-0000-000000000002","role":"authenticated","app":"apticket"}',true);
select is((select count(*) from apticket.contract_profitability),0::bigint,'RLS isola rentabilidade de outra tenant');
select is((select count(*) from apticket.contract_mrr_projection),0::bigint,'RLS isola projeção de outra tenant');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.contract_profitability'::regclass),'rentabilidade respeita RLS das fontes');
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='apticket.contract_mrr_projection'::regclass),'projeção respeita RLS das fontes');
select * from finish();
rollback;
