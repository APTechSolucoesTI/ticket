alter table apticket.contracts
  drop constraint if exists contracts_billing_model_check;

alter table apticket.contracts
  add constraint contracts_billing_model_check
  check (billing_model in ('hours_package', 'per_equipment', 'per_service'));
