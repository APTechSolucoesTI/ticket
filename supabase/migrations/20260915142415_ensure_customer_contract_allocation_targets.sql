-- Todo contrato de cliente deve poder receber rateios de custos de fornecedor,
-- mesmo quando a cobranca recorrente financeira ainda nao foi habilitada.
insert into apticket.contract_financial_terms(
  contract_id,tenant_id,operating_company_id,billing_interval_months,cutoff_day,
  adjustment_index,adjustment_interval_months,adjustment_base_date,
  adjustment_notice_days,billing_enabled,required_metrics
)
select contract.id,contract.tenant_id,contract.operating_company_id,1,
  greatest(1,least(31,coalesce(contract.dia_vencimento,1))),
  'fixed',12,contract.starts_at,30,false,'{}'::text[]
from apticket.contracts contract
where contract.operating_company_id is not null
  and not exists(
    select 1 from apticket.contract_financial_terms terms
    where terms.contract_id=contract.id
  );

create function apticket_finance_private.ensure_contract_allocation_target()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog
as $$
begin
  if new.operating_company_id is not null then
    insert into apticket.contract_financial_terms(
      contract_id,tenant_id,operating_company_id,billing_interval_months,cutoff_day,
      adjustment_index,adjustment_interval_months,adjustment_base_date,
      adjustment_notice_days,billing_enabled,required_metrics
    ) values(
      new.id,new.tenant_id,new.operating_company_id,1,
      greatest(1,least(31,coalesce(new.dia_vencimento,1))),
      'fixed',12,new.starts_at,30,false,'{}'::text[]
    ) on conflict (contract_id) do nothing;
  end if;
  return new;
end
$$;

revoke all on function apticket_finance_private.ensure_contract_allocation_target()
  from public,anon,authenticated,service_role;

create trigger ensure_contract_allocation_target
after insert on apticket.contracts
for each row execute function apticket_finance_private.ensure_contract_allocation_target();

comment on function apticket_finance_private.ensure_contract_allocation_target() is
  'Provisiona os termos financeiros minimos para permitir rateio de custos por contrato de cliente.';

notify pgrst,'reload schema';
