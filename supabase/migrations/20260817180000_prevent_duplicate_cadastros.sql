-- Impede cadastro duplicado (por tenant) de:
--   - cliente com mesmo CNPJ (comparado só por dígitos)
--   - contato com mesmo telefone (comparado só por dígitos)
--   - equipamento com mesmo patrimônio (asset_tag, sem diferenciar maiúsc./espaço)
-- Índices únicos parciais: linhas com o campo vazio/nulo não entram na
-- restrição (nem todo cadastro tem CNPJ/telefone/patrimônio preenchido).
-- Isto é o backstop real - a tela também checa antes de salvar, mas o
-- índice é quem garante de verdade (concorrência, import em massa, etc).

create unique index companies_tenant_cnpj_uidx
  on public.companies (tenant_id, regexp_replace(cnpj, '\D', '', 'g'))
  where cnpj is not null and cnpj <> '';

create unique index contacts_tenant_phone_uidx
  on public.contacts (tenant_id, regexp_replace(phone, '\D', '', 'g'))
  where phone is not null and phone <> '';

create unique index equipments_tenant_asset_tag_uidx
  on public.equipments (tenant_id, upper(trim(asset_tag)))
  where asset_tag is not null and asset_tag <> '';
