-- Fatia 22: visao consolidada e somente leitura do fluxo de caixa.
create view apticket.cash_flow_entries
with (security_invoker=true)
as
select
  receivable.tenant_id,
  receivable.operating_company_id,
  'inflow'::text as direction,
  case when receivable.medicao_id is not null then 'measurement_receivable'
       else 'recurring_receivable' end as source_type,
  receivable.id as source_id,
  receivable.documento_referencia as document_number,
  receivable.cliente_nome as counterparty_name,
  receivable.descricao as description,
  receivable.competencia as competence,
  receivable.vencimento_em as planned_date,
  case when receivable.valor_aberto<receivable.valor_original
       then receivable.updated_at::date end as realized_date,
  receivable.valor_original::numeric(14,2) as planned_amount,
  receivable.valor_aberto::numeric(14,2) as open_amount,
  (receivable.valor_original-receivable.valor_aberto)::numeric(14,2) as realized_amount,
  case
    when receivable.status_cobranca='cancelado' then 'cancelled'
    when receivable.valor_aberto=0 or receivable.status_cobranca='recebido' then 'realized'
    when receivable.vencimento_em<current_date then 'overdue'
    else 'pending'
  end as cash_status,
  receivable.status_cobranca::text as source_status,
  null::text as reconciliation_status,
  null::numeric(14,2) as difference_amount,
  receivable.created_at,
  receivable.updated_at
from apticket.contas_receber receivable
where receivable.deleted_at is null
  and receivable.operating_company_id is not null

union all

select
  payable.tenant_id,
  payable.operating_company_id,
  'outflow'::text as direction,
  'supplier_payable'::text as source_type,
  payable.id as source_id,
  payable.document_number,
  coalesce(payable.terms_snapshot->>'supplier_name','Fornecedor') as counterparty_name,
  payable.description,
  payable.cycle_start as competence,
  coalesce(payment.scheduled_date,payable.due_date) as planned_date,
  payment.paid_at::date as realized_date,
  payable.total_amount::numeric(14,2) as planned_amount,
  case when payable.status='paid' then 0 else payable.total_amount end::numeric(14,2) as open_amount,
  coalesce(payment.paid_amount,0)::numeric(14,2) as realized_amount,
  case
    when payable.status='cancelled' then 'cancelled'
    when payable.status='paid' then 'realized'
    when coalesce(payment.scheduled_date,payable.due_date)<current_date then 'overdue'
    else 'pending'
  end as cash_status,
  payable.status as source_status,
  payment.reconciliation_status,
  payment.difference_amount,
  payable.created_at,
  coalesce(payment.updated_at,payable.created_at) as updated_at
from apticket.supplier_payables payable
left join lateral (
  select p.scheduled_date,p.paid_at,p.paid_amount,p.reconciliation_status,
    p.difference_amount,p.updated_at
  from apticket.supplier_payments p
  where p.supplier_payable_id=payable.id and p.status in ('scheduled','paid')
  limit 1
) payment on true
where payable.deleted_at is null;

revoke all on apticket.cash_flow_entries from public,anon,authenticated,service_role;
grant select on apticket.cash_flow_entries to authenticated,service_role;

comment on view apticket.cash_flow_entries is
  'Fluxo de caixa consolidado de recebiveis contratuais e pagamentos de fornecedores.';
notify pgrst,'reload schema';
