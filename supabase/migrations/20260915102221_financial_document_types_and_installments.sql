-- Tipos de documento compartilhados pela tenant e matriz de parcelamento dos
-- lancamentos manuais de contas a receber e a pagar.

create table apticket.financial_document_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete cascade,
  code text not null check (length(btrim(code)) between 2 and 20),
  name text not null check (length(btrim(name)) between 2 and 100),
  availability text not null default 'both'
    check (availability in ('receivable', 'payable', 'both')),
  is_active boolean not null default true,
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id, tenant_id)
);

create unique index financial_document_types_code_key
  on apticket.financial_document_types(tenant_id, lower(code))
  where deleted_at is null;
create index financial_document_types_tenant_idx
  on apticket.financial_document_types(tenant_id, availability, is_active)
  where deleted_at is null;

create trigger set_financial_document_types_updated_at
before update on apticket.financial_document_types
for each row execute function apticket.set_updated_at();

alter table apticket.financial_document_types enable row level security;
create policy financial_document_types_read on apticket.financial_document_types
for select to authenticated
using (
  tenant_id = apticket.current_tenant_id()
  and (
    apticket.has_permission(auth.uid(), 'financeiro_contas_receber', 'view')
    or apticket.has_permission(auth.uid(), 'financeiro_contas_pagar', 'view')
  )
);

revoke all on apticket.financial_document_types from public, anon, authenticated, service_role;
grant select on apticket.financial_document_types to authenticated;
grant all on apticket.financial_document_types to service_role;

create function apticket.seed_financial_document_types(p_tenant_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  insert into apticket.financial_document_types(tenant_id, code, name, availability)
  values
    (p_tenant_id, 'NFe', 'Nota Fiscal Eletrônica', 'both'),
    (p_tenant_id, 'NFSe', 'Nota Fiscal de Serviço Eletrônica', 'both'),
    (p_tenant_id, 'REC', 'Recibo', 'both'),
    (p_tenant_id, 'FAT', 'Fatura', 'both'),
    (p_tenant_id, 'BOL', 'Boleto', 'both'),
    (p_tenant_id, 'OUT', 'Outro documento', 'both')
  on conflict do nothing
$$;

revoke all on function apticket.seed_financial_document_types(uuid)
  from public, anon, authenticated, service_role;

select apticket.seed_financial_document_types(id) from apticket.tenants;

create function apticket_finance_private.seed_financial_document_types_for_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  perform apticket.seed_financial_document_types(new.id);
  return new;
end
$$;

revoke all on function apticket_finance_private.seed_financial_document_types_for_new_tenant()
  from public, anon, authenticated, service_role;

create trigger tenants_seed_financial_document_types
after insert on apticket.tenants
for each row execute function apticket_finance_private.seed_financial_document_types_for_new_tenant();

create function apticket.save_financial_document_type(
  p_id uuid,
  p_code text,
  p_name text,
  p_availability text,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := apticket.current_tenant_id();
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_actor is null or v_tenant is null or not (
    apticket.has_permission(v_actor, 'financeiro_contas_receber', 'edit')
    or apticket.has_permission(v_actor, 'financeiro_contas_pagar', 'edit')
  ) then
    raise exception using errcode = '42501', message = 'Sem permissao para manter tipos de documento.';
  end if;
  if length(v_code) not between 2 and 20 or v_code !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
    raise exception using errcode = '23514', message = 'O codigo deve ter de 2 a 20 caracteres, usando letras, numeros, ponto, barra, hifen ou sublinhado.';
  end if;
  if length(v_name) not between 2 and 100 then
    raise exception using errcode = '23514', message = 'A descricao deve ter entre 2 e 100 caracteres.';
  end if;
  if p_availability not in ('receivable', 'payable', 'both') then
    raise exception using errcode = '23514', message = 'Selecione onde o tipo de documento ficara disponivel.';
  end if;

  if p_id is null then
    insert into apticket.financial_document_types(
      id, tenant_id, code, name, availability, is_active, created_by
    ) values (
      v_id, v_tenant, v_code, v_name, p_availability, coalesce(p_is_active, true), v_actor
    );
  else
    update apticket.financial_document_types
    set code = v_code,
        name = v_name,
        availability = p_availability,
        is_active = coalesce(p_is_active, true)
    where id = p_id and tenant_id = v_tenant and deleted_at is null;
    if not found then
      raise exception using errcode = 'P0002', message = 'Tipo de documento nao encontrado.';
    end if;
  end if;
  return v_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Ja existe um tipo de documento com este codigo.';
end
$$;

revoke all on function apticket.save_financial_document_type(uuid,text,text,text,boolean)
  from public, anon, service_role;
grant execute on function apticket.save_financial_document_type(uuid,text,text,text,boolean)
  to authenticated;

create table apticket.financial_manual_entry_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references apticket.tenants(id) on delete restrict,
  operating_company_id uuid not null,
  direction text not null check (direction in ('receivable', 'payable')),
  company_id uuid references apticket.companies(id) on delete restrict,
  supplier_id uuid references apticket.suppliers(id) on delete restrict,
  document_type_id uuid not null,
  document_number text not null check (length(btrim(document_number)) between 2 and 80),
  description text not null check (length(btrim(description)) between 2 and 500),
  competence date not null check (competence = date_trunc('month', competence)::date),
  total_amount numeric(14,2) not null check (total_amount > 0),
  installment_count smallint not null check (installment_count between 1 and 120),
  installment_interval_days integer not null default 0
    check (installment_interval_days between 0 and 3650),
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid references apticket.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  constraint manual_entry_group_counterparty_check check (
    (direction = 'receivable' and company_id is not null and supplier_id is null)
    or (direction = 'payable' and company_id is null and supplier_id is not null)
  ),
  constraint manual_entry_group_interval_check check (
    (installment_count = 1 and installment_interval_days = 0)
    or (installment_count > 1 and installment_interval_days > 0)
  ),
  constraint manual_entry_group_operator_fk foreign key(operating_company_id, tenant_id)
    references apticket.operating_companies(id, tenant_id) on delete restrict,
  constraint manual_entry_group_document_type_fk foreign key(document_type_id, tenant_id)
    references apticket.financial_document_types(id, tenant_id) on delete restrict,
  unique (id, tenant_id, operating_company_id)
);

create unique index manual_receivable_group_document_key
  on apticket.financial_manual_entry_groups(
    tenant_id, operating_company_id, company_id, document_type_id, lower(document_number)
  ) where direction = 'receivable' and deleted_at is null;
create unique index manual_payable_group_document_key
  on apticket.financial_manual_entry_groups(
    tenant_id, operating_company_id, supplier_id, document_type_id, lower(document_number)
  ) where direction = 'payable' and deleted_at is null;
create index financial_manual_entry_groups_scope_idx
  on apticket.financial_manual_entry_groups(tenant_id, operating_company_id, direction, competence)
  where deleted_at is null;

alter table apticket.financial_manual_entry_groups enable row level security;
create policy financial_manual_entry_groups_read on apticket.financial_manual_entry_groups
for select to authenticated
using (
  apticket.has_financial_scope(tenant_id, operating_company_id)
  and (
    (direction = 'receivable' and apticket.has_permission(auth.uid(), 'financeiro_contas_receber', 'view'))
    or (direction = 'payable' and apticket.has_permission(auth.uid(), 'financeiro_contas_pagar', 'view'))
  )
);

revoke all on apticket.financial_manual_entry_groups from public, anon, authenticated, service_role;
grant select on apticket.financial_manual_entry_groups to authenticated;
grant all on apticket.financial_manual_entry_groups to service_role;

alter table apticket.contas_receber
  add column document_type_id uuid,
  add column manual_entry_group_id uuid,
  add column installment_number smallint,
  add column installment_count smallint,
  add column document_base_number text;

alter table apticket.contas_receber
  add constraint receivable_document_type_fk foreign key(document_type_id, tenant_id)
    references apticket.financial_document_types(id, tenant_id) on delete restrict,
  add constraint receivable_manual_group_fk foreign key(manual_entry_group_id, tenant_id, operating_company_id)
    references apticket.financial_manual_entry_groups(id, tenant_id, operating_company_id) on delete restrict,
  add constraint receivable_installment_metadata_check check (
    (manual_entry_group_id is null and installment_number is null and installment_count is null and document_base_number is null)
    or (
      manual_entry_group_id is not null
      and installment_number between 1 and installment_count
      and installment_count between 1 and 120
      and length(btrim(document_base_number)) between 2 and 80
      and origin_type = 'manual'
    )
  );

alter table apticket.supplier_payables
  add column document_type_id uuid,
  add column manual_entry_group_id uuid,
  add column installment_number smallint,
  add column installment_count smallint,
  add column document_base_number text;

alter table apticket.supplier_payables
  add constraint supplier_payable_document_type_fk foreign key(document_type_id, tenant_id)
    references apticket.financial_document_types(id, tenant_id) on delete restrict,
  add constraint supplier_payable_manual_group_fk foreign key(manual_entry_group_id, tenant_id, operating_company_id)
    references apticket.financial_manual_entry_groups(id, tenant_id, operating_company_id) on delete restrict,
  add constraint supplier_payable_installment_metadata_check check (
    (manual_entry_group_id is null and installment_number is null and installment_count is null and document_base_number is null)
    or (
      manual_entry_group_id is not null
      and installment_number between 1 and installment_count
      and installment_count between 1 and 120
      and length(btrim(document_base_number)) between 2 and 80
      and origin_type = 'manual'
    )
  );

-- A numeracao fiscal pode se repetir entre clientes/fornecedores diferentes.
-- Para documentos contratuais, preserva-se a unicidade anterior.
drop index apticket.manual_receivable_document_key;
create unique index manual_receivable_document_key
  on apticket.contas_receber(
    tenant_id, operating_company_id, company_id, document_type_id,
    lower(documento_referencia)
  ) where origin_type = 'manual' and deleted_at is null;

alter table apticket.supplier_payables
  drop constraint supplier_payables_document_number_tenant_id_operating_compa_key;
create unique index supplier_payables_contract_document_key
  on apticket.supplier_payables(tenant_id, operating_company_id, document_number)
  where origin_type = 'contract' and deleted_at is null;
create unique index supplier_payables_manual_document_key
  on apticket.supplier_payables(
    tenant_id, operating_company_id, supplier_id, document_type_id,
    lower(document_number)
  ) where origin_type = 'manual' and deleted_at is null;

create unique index receivable_manual_group_installment_key
  on apticket.contas_receber(manual_entry_group_id, installment_number)
  where manual_entry_group_id is not null and deleted_at is null;
create unique index supplier_payable_manual_group_installment_key
  on apticket.supplier_payables(manual_entry_group_id, installment_number)
  where manual_entry_group_id is not null and deleted_at is null;

create function apticket_finance_private.guard_financial_document_type()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_availability text;
begin
  if new.document_type_id is null then return new; end if;
  select availability into v_availability
  from apticket.financial_document_types
  where id = new.document_type_id
    and tenant_id = new.tenant_id
    and deleted_at is null
    and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'O tipo de documento selecionado esta inativo ou nao pertence a tenant.';
  end if;
  if tg_table_name = 'contas_receber' and v_availability not in ('receivable', 'both') then
    raise exception using errcode = '23514', message = 'Este tipo de documento nao esta disponivel para contas a receber.';
  end if;
  if tg_table_name = 'supplier_payables' and v_availability not in ('payable', 'both') then
    raise exception using errcode = '23514', message = 'Este tipo de documento nao esta disponivel para contas a pagar.';
  end if;
  return new;
end
$$;

revoke all on function apticket_finance_private.guard_financial_document_type()
  from public, anon, authenticated, service_role;

create trigger guard_receivable_document_type
before insert or update of document_type_id, tenant_id on apticket.contas_receber
for each row execute function apticket_finance_private.guard_financial_document_type();
create trigger guard_supplier_payable_document_type
before insert or update of document_type_id, tenant_id on apticket.supplier_payables
for each row execute function apticket_finance_private.guard_financial_document_type();

drop function apticket.create_manual_receivable(uuid,uuid,text,text,date,date,numeric,text);
drop function apticket.create_manual_supplier_payable(uuid,uuid,text,text,date,date,numeric,text);

create function apticket.create_manual_receivable(
  p_operating_company_id uuid,
  p_company_id uuid,
  p_document_type_id uuid,
  p_document_reference text,
  p_description text,
  p_competence date,
  p_total_amount numeric,
  p_installments jsonb,
  p_installment_interval_days integer default 0,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_customer apticket.companies;
  v_group_id uuid := gen_random_uuid();
  v_document text := btrim(coalesce(p_document_reference, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_competence date := date_trunc('month', p_competence)::date;
  v_total numeric(14,2) := round(p_total_amount, 2);
  v_count integer;
  v_sum numeric(14,2) := 0;
  v_expected integer := 1;
  v_item jsonb;
  v_number integer;
  v_due_date date;
  v_amount numeric(14,2);
  v_child_document text;
begin
  select tenant_id into v_tenant from apticket.operating_companies
  where id = p_operating_company_id and deleted_at is null and is_active for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa operadora ativa nao encontrada.';
  end if;
  if v_actor is null
    or not apticket.has_permission(v_actor, 'financeiro_contas_receber', 'edit')
    or not apticket.has_financial_scope(v_tenant, p_operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem permissao para incluir contas a receber nesta empresa.';
  end if;
  select * into v_customer from apticket.companies
  where id = p_company_id and tenant_id = v_tenant for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cliente ativo nao encontrado.';
  end if;
  perform 1 from apticket.financial_document_types
  where id = p_document_type_id and tenant_id = v_tenant and deleted_at is null and is_active
    and availability in ('receivable', 'both') for share;
  if not found then
    raise exception using errcode = '23514', message = 'Selecione um tipo de documento ativo para contas a receber.';
  end if;
  if length(v_document) not between 2 and 80 then
    raise exception using errcode = '23514', message = 'O numero do documento deve ter entre 2 e 80 caracteres.';
  end if;
  if length(v_description) not between 2 and 500 then
    raise exception using errcode = '23514', message = 'A descricao deve ter entre 2 e 500 caracteres.';
  end if;
  if p_competence is null or p_competence <> v_competence then
    raise exception using errcode = '23514', message = 'Informe uma competencia valida.';
  end if;
  if p_total_amount is null or v_total <= 0 or v_total > 999999999.99 then
    raise exception using errcode = '23514', message = 'Informe um valor total entre R$ 0,01 e R$ 999.999.999,99.';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'As observacoes devem ter no maximo 4.000 caracteres.';
  end if;
  if jsonb_typeof(p_installments) <> 'array' then
    raise exception using errcode = '23514', message = 'Informe as parcelas do lancamento.';
  end if;
  v_count := jsonb_array_length(p_installments);
  if v_count not between 1 and 120 then
    raise exception using errcode = '23514', message = 'A quantidade de parcelas deve estar entre 1 e 120.';
  end if;
  if (v_count = 1 and coalesce(p_installment_interval_days, 0) <> 0)
    or (v_count > 1 and coalesce(p_installment_interval_days, 0) not between 1 and 3650) then
    raise exception using errcode = '23514', message = 'Informe um intervalo valido entre as parcelas.';
  end if;

  for v_item in select value from jsonb_array_elements(p_installments)
  loop
    if coalesce(v_item->>'number', '') !~ '^[0-9]+$'
      or coalesce(v_item->>'due_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_item->>'amount', '') !~ '^\d+(\.\d{1,2})?$' then
      raise exception using errcode = '23514', message = 'Uma das parcelas possui numero, vencimento ou valor invalido.';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_installments)
    order by (value->>'number')::integer
  loop
    v_number := (v_item->>'number')::integer;
    v_due_date := (v_item->>'due_date')::date;
    v_amount := round((v_item->>'amount')::numeric, 2);
    if v_number <> v_expected then
      raise exception using errcode = '23514', message = 'A numeracao das parcelas deve ser sequencial e iniciar em 1.';
    end if;
    if v_due_date < v_competence then
      raise exception using errcode = '23514', message = 'O vencimento das parcelas nao pode anteceder a competencia.';
    end if;
    if v_amount <= 0 or v_amount > 999999999.99 then
      raise exception using errcode = '23514', message = 'Todas as parcelas devem possuir valor maior que zero.';
    end if;
    v_sum := v_sum + v_amount;
    v_expected := v_expected + 1;
  end loop;
  if v_sum <> v_total then
    raise exception using errcode = '23514', message = 'A soma das parcelas deve ser exatamente igual ao valor total do documento.';
  end if;

  insert into apticket.financial_manual_entry_groups(
    id, tenant_id, operating_company_id, direction, company_id, document_type_id,
    document_number, description, competence, total_amount, installment_count,
    installment_interval_days, notes, created_by
  ) values (
    v_group_id, v_tenant, p_operating_company_id, 'receivable', v_customer.id,
    p_document_type_id, v_document, v_description, v_competence, v_total, v_count,
    coalesce(p_installment_interval_days, 0), v_notes, v_actor
  );

  for v_item in
    select value from jsonb_array_elements(p_installments)
    order by (value->>'number')::integer
  loop
    v_number := (v_item->>'number')::integer;
    v_due_date := (v_item->>'due_date')::date;
    v_amount := round((v_item->>'amount')::numeric, 2);
    v_child_document := case when v_count = 1 then v_document
      else format('%s - %s/%s', v_document, v_number, v_count) end;
    if length(v_child_document) > 80 then
      raise exception using errcode = '23514', message = 'O numero do documento e muito longo para identificar as parcelas.';
    end if;
    insert into apticket.contas_receber(
      tenant_id, operating_company_id, medicao_id, billing_cycle_id, contrato_id,
      company_id, cliente_nome, document_type_id, documento_referencia,
      document_base_number, manual_entry_group_id, installment_number, installment_count,
      descricao, competencia, valor_original, valor_aberto, vencimento_em,
      status_cobranca, observacoes, aprovado_em, aprovado_por
    ) values (
      v_tenant, p_operating_company_id, null, null, null,
      v_customer.id, v_customer.name, p_document_type_id, v_child_document,
      v_document, v_group_id, v_number, v_count,
      v_description, v_competence, v_amount, v_amount, v_due_date,
      'a_faturar', v_notes, clock_timestamp(), v_actor
    );
  end loop;
  return v_group_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Ja existe este documento manual para o cliente e a empresa operadora selecionados.';
end
$$;

create function apticket.create_manual_supplier_payable(
  p_operating_company_id uuid,
  p_supplier_id uuid,
  p_document_type_id uuid,
  p_document_number text,
  p_description text,
  p_competence date,
  p_total_amount numeric,
  p_installments jsonb,
  p_installment_interval_days integer default 0,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_supplier apticket.suppliers;
  v_group_id uuid := gen_random_uuid();
  v_document text := btrim(coalesce(p_document_number, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_competence date := date_trunc('month', p_competence)::date;
  v_total numeric(14,2) := round(p_total_amount, 2);
  v_count integer;
  v_sum numeric(14,2) := 0;
  v_expected integer := 1;
  v_item jsonb;
  v_number integer;
  v_due_date date;
  v_amount numeric(14,2);
  v_child_document text;
begin
  select tenant_id into v_tenant from apticket.operating_companies
  where id = p_operating_company_id and deleted_at is null and is_active for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa operadora ativa nao encontrada.';
  end if;
  if v_actor is null
    or not apticket.has_permission(v_actor, 'financeiro_contas_pagar', 'edit')
    or not apticket.has_financial_scope(v_tenant, p_operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem permissao para incluir contas a pagar nesta empresa.';
  end if;
  select * into v_supplier from apticket.suppliers
  where id = p_supplier_id and tenant_id = v_tenant and deleted_at is null and is_active for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Fornecedor ativo nao encontrado.';
  end if;
  perform 1 from apticket.financial_document_types
  where id = p_document_type_id and tenant_id = v_tenant and deleted_at is null and is_active
    and availability in ('payable', 'both') for share;
  if not found then
    raise exception using errcode = '23514', message = 'Selecione um tipo de documento ativo para contas a pagar.';
  end if;
  if length(v_document) not between 2 and 80 then
    raise exception using errcode = '23514', message = 'O numero do documento deve ter entre 2 e 80 caracteres.';
  end if;
  if length(v_description) not between 2 and 500 then
    raise exception using errcode = '23514', message = 'A descricao deve ter entre 2 e 500 caracteres.';
  end if;
  if p_competence is null or p_competence <> v_competence then
    raise exception using errcode = '23514', message = 'Informe uma competencia valida.';
  end if;
  if p_total_amount is null or v_total <= 0 or v_total > 999999999.99 then
    raise exception using errcode = '23514', message = 'Informe um valor total entre R$ 0,01 e R$ 999.999.999,99.';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'As observacoes devem ter no maximo 4.000 caracteres.';
  end if;
  if jsonb_typeof(p_installments) <> 'array' then
    raise exception using errcode = '23514', message = 'Informe as parcelas do lancamento.';
  end if;
  v_count := jsonb_array_length(p_installments);
  if v_count not between 1 and 120 then
    raise exception using errcode = '23514', message = 'A quantidade de parcelas deve estar entre 1 e 120.';
  end if;
  if (v_count = 1 and coalesce(p_installment_interval_days, 0) <> 0)
    or (v_count > 1 and coalesce(p_installment_interval_days, 0) not between 1 and 3650) then
    raise exception using errcode = '23514', message = 'Informe um intervalo valido entre as parcelas.';
  end if;

  for v_item in select value from jsonb_array_elements(p_installments)
  loop
    if coalesce(v_item->>'number', '') !~ '^[0-9]+$'
      or coalesce(v_item->>'due_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_item->>'amount', '') !~ '^\d+(\.\d{1,2})?$' then
      raise exception using errcode = '23514', message = 'Uma das parcelas possui numero, vencimento ou valor invalido.';
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(p_installments)
    order by (value->>'number')::integer
  loop
    v_number := (v_item->>'number')::integer;
    v_due_date := (v_item->>'due_date')::date;
    v_amount := round((v_item->>'amount')::numeric, 2);
    if v_number <> v_expected then
      raise exception using errcode = '23514', message = 'A numeracao das parcelas deve ser sequencial e iniciar em 1.';
    end if;
    if v_due_date < v_competence then
      raise exception using errcode = '23514', message = 'O vencimento das parcelas nao pode anteceder a competencia.';
    end if;
    if v_amount <= 0 or v_amount > 999999999.99 then
      raise exception using errcode = '23514', message = 'Todas as parcelas devem possuir valor maior que zero.';
    end if;
    v_sum := v_sum + v_amount;
    v_expected := v_expected + 1;
  end loop;
  if v_sum <> v_total then
    raise exception using errcode = '23514', message = 'A soma das parcelas deve ser exatamente igual ao valor total do documento.';
  end if;

  insert into apticket.financial_manual_entry_groups(
    id, tenant_id, operating_company_id, direction, supplier_id, document_type_id,
    document_number, description, competence, total_amount, installment_count,
    installment_interval_days, notes, created_by
  ) values (
    v_group_id, v_tenant, p_operating_company_id, 'payable', v_supplier.id,
    p_document_type_id, v_document, v_description, v_competence, v_total, v_count,
    coalesce(p_installment_interval_days, 0), v_notes, v_actor
  );

  for v_item in
    select value from jsonb_array_elements(p_installments)
    order by (value->>'number')::integer
  loop
    v_number := (v_item->>'number')::integer;
    v_due_date := (v_item->>'due_date')::date;
    v_amount := round((v_item->>'amount')::numeric, 2);
    v_child_document := case when v_count = 1 then v_document
      else format('%s - %s/%s', v_document, v_number, v_count) end;
    if length(v_child_document) > 80 then
      raise exception using errcode = '23514', message = 'O numero do documento e muito longo para identificar as parcelas.';
    end if;
    insert into apticket.supplier_payables(
      tenant_id, operating_company_id, supplier_id, supplier_contract_id,
      document_type_id, document_number, document_base_number, manual_entry_group_id,
      installment_number, installment_count, description, cycle_start, cycle_end,
      due_date, billing_unit, measured_quantity, unit_price, total_amount,
      allocation_status, status, terms_snapshot, created_by
    ) values (
      v_tenant, p_operating_company_id, v_supplier.id, null,
      p_document_type_id, v_child_document, v_document, v_group_id,
      v_number, v_count, v_description, v_competence, (v_competence + interval '1 month')::date,
      v_due_date, 'fixed', 1, v_amount, v_amount,
      'complete', 'scheduled', jsonb_build_object(
        'origin', 'manual',
        'supplier_name', coalesce(v_supplier.trade_name, v_supplier.legal_name),
        'supplier_tax_id', v_supplier.tax_id,
        'document_type_id', p_document_type_id,
        'document_base_number', v_document,
        'installment_number', v_number,
        'installment_count', v_count,
        'notes', v_notes
      ), v_actor
    );
  end loop;
  return v_group_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Ja existe este documento manual para o fornecedor e a empresa operadora selecionados.';
end
$$;

revoke all on function apticket.create_manual_receivable(uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text)
  from public, anon, service_role;
revoke all on function apticket.create_manual_supplier_payable(uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text)
  from public, anon, service_role;
grant execute on function apticket.create_manual_receivable(uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text)
  to authenticated;
grant execute on function apticket.create_manual_supplier_payable(uuid,uuid,uuid,text,text,date,numeric,jsonb,integer,text)
  to authenticated;

comment on table apticket.financial_document_types is
  'Tipos de documentos financeiros configuraveis por tenant e disponibilidade.';
comment on table apticket.financial_manual_entry_groups is
  'Matriz imutavel de lancamentos financeiros manuais unicos ou parcelados.';
comment on column apticket.contas_receber.manual_entry_group_id is
  'Matriz do documento manual que originou a parcela.';
comment on column apticket.supplier_payables.manual_entry_group_id is
  'Matriz do documento manual que originou a parcela.';

notify pgrst, 'reload schema';
