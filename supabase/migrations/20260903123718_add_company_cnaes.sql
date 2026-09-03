alter table apticket.companies
  add column cnaes jsonb not null default '[]'::jsonb;

alter table apticket.companies
  add constraint companies_cnaes_must_be_array_check
  check (jsonb_typeof(cnaes) = 'array');

comment on column apticket.companies.cnaes is
  'Atividades econômicas retornadas pela consulta do CNPJ, incluindo o CNAE principal e os secundários.';
