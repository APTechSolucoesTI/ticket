-- Fatia 25: contrato de dados do demonstrativo gerencial de resultado.
create view apticket.financial_management_statement
with (security_invoker=true)
as
select
  tenant_id,
  operating_company_id,
  extract(year from period_month)::integer as fiscal_year,
  extract(month from period_month)::integer as fiscal_month,
  period_month,
  case when direction='inflow' then 'revenue' else 'expense' end as result_group,
  direction,
  financial_category_id,
  financial_category_code,
  financial_category_name,
  cost_center_id,
  cost_center_code,
  cost_center_name,
  budget_entry_id,
  budgeted_amount,
  planned_amount,
  realized_amount,
  case when direction='inflow' then budgeted_amount else -budgeted_amount end::numeric(14,2)
    as budgeted_result_amount,
  case when direction='inflow' then planned_amount else -planned_amount end::numeric(14,2)
    as planned_result_amount,
  case when direction='inflow' then realized_amount else -realized_amount end::numeric(14,2)
    as realized_result_amount,
  case when direction='inflow' then realized_amount-budgeted_amount
    else budgeted_amount-realized_amount end::numeric(14,2) as favorable_variance_amount,
  case when budgeted_amount=0 then null
    when direction='inflow' then round((realized_amount-budgeted_amount)/budgeted_amount*100,2)
    else round((budgeted_amount-realized_amount)/budgeted_amount*100,2)
  end as favorable_variance_percent,
  revision,
  created_by_name,
  created_at
from apticket.financial_budget_variance;

revoke all on apticket.financial_management_statement from public,anon,authenticated,service_role;
grant select on apticket.financial_management_statement to authenticated,service_role;

comment on view apticket.financial_management_statement is
  'Linhas mensais de receitas e despesas para o demonstrativo gerencial, com valores assinados e desvio favoravel.';
notify pgrst,'reload schema';
