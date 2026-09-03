alter table apticket.tenants
  add column cnaes jsonb not null default '[]'::jsonb;

alter table apticket.tenants
  add constraint tenants_cnaes_must_be_array_check
  check (jsonb_typeof(cnaes) = 'array');

comment on column apticket.tenants.cnaes is
  'Atividades econômicas da empresa MSP retornadas pela consulta do CNPJ, incluindo o CNAE principal e os secundários.';
