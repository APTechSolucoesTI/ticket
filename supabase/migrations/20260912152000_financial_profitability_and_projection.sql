-- Analise final: rentabilidade por contrato e projecao de receita recorrente.
-- O financeiro pode ler somente os clientes e contratos vinculados a empresas
-- operadoras para as quais recebeu uma concessao explicita.
create policy financial_contract_analytics_read on apticket.contracts
  for select to authenticated using (
    exists(select 1 from apticket.contract_financial_terms terms
      where terms.contract_id=contracts.id and terms.tenant_id=contracts.tenant_id
        and terms.deleted_at is null
        and apticket.has_financial_scope(terms.tenant_id,terms.operating_company_id))
  );
create policy financial_customer_analytics_read on apticket.companies
  for select to authenticated using (
    exists(select 1 from apticket.contracts contract
      join apticket.contract_financial_terms terms on terms.contract_id=contract.id
        and terms.tenant_id=contract.tenant_id and terms.deleted_at is null
      where contract.company_id=companies.id and contract.tenant_id=companies.tenant_id
        and apticket.has_financial_scope(terms.tenant_id,terms.operating_company_id))
  );

create view apticket.contract_profitability
with (security_invoker=true)
as
with revenue as (
  select receivable.tenant_id,receivable.operating_company_id,
    receivable.contrato_id as contract_id,date_trunc('month',receivable.competencia)::date as period_month,
    sum(receivable.valor_original)::numeric(14,2) as gross_revenue,
    sum(receivable.valor_original-receivable.valor_aberto)::numeric(14,2) as realized_revenue
  from apticket.contas_receber receivable
  where receivable.deleted_at is null and receivable.operating_company_id is not null
    and receivable.status_cobranca<>'cancelado'
  group by receivable.tenant_id,receivable.operating_company_id,receivable.contrato_id,
    date_trunc('month',receivable.competencia)::date
), allocated_cost as (
  select allocation.tenant_id,allocation.operating_company_id,
    allocation.customer_contract_id as contract_id,
    date_trunc('month',payable.cycle_start)::date as period_month,
    sum(allocation.amount)::numeric(14,2) as allocated_cost
  from apticket.supplier_payable_allocations allocation
  join apticket.supplier_payables payable on payable.id=allocation.supplier_payable_id
    and payable.tenant_id=allocation.tenant_id
    and payable.operating_company_id=allocation.operating_company_id
  where allocation.deleted_at is null and payable.deleted_at is null
    and payable.status<>'cancelled'
  group by allocation.tenant_id,allocation.operating_company_id,
    allocation.customer_contract_id,date_trunc('month',payable.cycle_start)::date
), keys as (
  select tenant_id,operating_company_id,contract_id,period_month from revenue
  union
  select tenant_id,operating_company_id,contract_id,period_month from allocated_cost
)
select keys.tenant_id,keys.operating_company_id,operator.legal_name as operating_company_name,
  keys.contract_id,contract.company_id as customer_id,company.name as customer_name,
  contract.numero_contrato as contract_number,keys.period_month,
  coalesce(revenue.gross_revenue,0)::numeric(14,2) as gross_revenue,
  coalesce(revenue.realized_revenue,0)::numeric(14,2) as realized_revenue,
  coalesce(allocated_cost.allocated_cost,0)::numeric(14,2) as allocated_cost,
  (coalesce(revenue.gross_revenue,0)-coalesce(allocated_cost.allocated_cost,0))::numeric(14,2)
    as gross_profit,
  case when coalesce(revenue.gross_revenue,0)=0 then null else round(
    (coalesce(revenue.gross_revenue,0)-coalesce(allocated_cost.allocated_cost,0))
      /revenue.gross_revenue*100,2) end as gross_margin_percent
from keys
join apticket.contracts contract on contract.id=keys.contract_id and contract.tenant_id=keys.tenant_id
join apticket.companies company on company.id=contract.company_id and company.tenant_id=contract.tenant_id
join apticket.operating_companies operator on operator.id=keys.operating_company_id
  and operator.tenant_id=keys.tenant_id
left join revenue on row(revenue.tenant_id,revenue.operating_company_id,revenue.contract_id,revenue.period_month)
  =row(keys.tenant_id,keys.operating_company_id,keys.contract_id,keys.period_month)
left join allocated_cost on row(allocated_cost.tenant_id,allocated_cost.operating_company_id,
  allocated_cost.contract_id,allocated_cost.period_month)
  =row(keys.tenant_id,keys.operating_company_id,keys.contract_id,keys.period_month);

create view apticket.contract_mrr_projection
with (security_invoker=true)
as
select terms.tenant_id,terms.operating_company_id,operator.legal_name as operating_company_name,
  terms.contract_id,contract.company_id as customer_id,company.name as customer_name,
  contract.numero_contrato as contract_number,month.period_month,
  round(value.base_amount/terms.billing_interval_months,2)::numeric(14,2) as baseline_mrr,
  terms.billing_interval_months,contract.ends_at,
  case when value.id is null then true else false end as missing_value_version
from apticket.contract_financial_terms terms
join apticket.contracts contract on contract.id=terms.contract_id and contract.tenant_id=terms.tenant_id
join apticket.companies company on company.id=contract.company_id and company.tenant_id=contract.tenant_id
join apticket.operating_companies operator on operator.id=terms.operating_company_id
  and operator.tenant_id=terms.tenant_id
cross join lateral (
  select generate_series(date_trunc('month',current_date)::date,
    (date_trunc('month',current_date)+interval '11 months')::date,interval '1 month')::date period_month
) month
left join lateral (
  select version.id,version.base_amount from apticket.contract_value_versions version
  where version.contract_id=terms.contract_id and version.tenant_id=terms.tenant_id
    and version.operating_company_id=terms.operating_company_id and version.deleted_at is null
    and version.effective_from<=month.period_month
  order by version.effective_from desc limit 1
) value on true
where terms.deleted_at is null and terms.billing_enabled
  and contract.status='active' and contract.starts_at<(month.period_month+interval '1 month')::date
  and contract.ends_at>=month.period_month;

revoke all on apticket.contract_profitability,apticket.contract_mrr_projection
  from public,anon,authenticated,service_role;
grant select on apticket.contract_profitability,apticket.contract_mrr_projection
  to authenticated,service_role;

comment on view apticket.contract_profitability is
  'Rentabilidade por competencia, cliente e contrato com custos de fornecedores rateados.';
comment on view apticket.contract_mrr_projection is
  'MRR contratual normalizado para os proximos doze meses, antes de cenarios de estresse.';
notify pgrst,'reload schema';
