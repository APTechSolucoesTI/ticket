alter table apticket.contract_types
  drop constraint if exists contract_types_billing_model_check;

alter table apticket.contract_types
  add constraint contract_types_billing_model_check
  check (billing_model in ('hours_package', 'per_equipment', 'per_service'));
