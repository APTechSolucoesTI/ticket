-- Permite lançamentos financeiros manuais sem separar os dados dos fluxos
-- contratuais. As mesmas tabelas continuam alimentando caixa, conciliação,
-- aprovações e integração bancária.

alter table apticket.contas_receber
  alter column contrato_id drop not null,
  drop constraint receivable_origin_check,
  add column origin_type text generated always as (
    case
      when medicao_id is not null then 'measurement'
      when billing_cycle_id is not null then 'recurring'
      else 'manual'
    end
  ) stored,
  add constraint receivable_origin_check check (
    (medicao_id is not null and billing_cycle_id is null and contrato_id is not null)
    or (medicao_id is null and billing_cycle_id is not null and contrato_id is not null)
    or (medicao_id is null and billing_cycle_id is null and contrato_id is null)
  );

alter table apticket.supplier_payables
  alter column supplier_contract_id drop not null,
  add column origin_type text generated always as (
    case when supplier_contract_id is null then 'manual' else 'contract' end
  ) stored;

alter table apticket.contas_receber alter column origin_type set not null;
alter table apticket.supplier_payables alter column origin_type set not null;

alter table apticket.financial_entry_classifications
  drop constraint financial_entry_classifications_source_type_check,
  add constraint financial_entry_classifications_source_type_check check (
    source_type in (
      'measurement_receivable', 'recurring_receivable', 'manual_receivable', 'supplier_payable'
    )
  );

alter table apticket.bank_statement_transactions
  drop constraint bank_statement_transactions_match_source_type_check,
  add constraint bank_statement_transactions_match_source_type_check check (
    match_source_type is null or match_source_type in (
      'measurement_receivable', 'recurring_receivable', 'manual_receivable', 'supplier_payment'
    )
  );

-- Mantém as proteções e permissões já existentes nas funções financeiras,
-- alterando somente o reconhecimento da nova origem manual.
create function apticket_finance_private.patch_manual_receivable_support(fn regprocedure)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef(fn) into definition;
  patched := regexp_replace(
    definition,
    $pattern$p_source_type in \('measurement_receivable','recurring_receivable'\)$pattern$,
    $replacement$p_source_type in ('measurement_receivable','recurring_receivable','manual_receivable')$replacement$,
    'g'
  );
  patched := regexp_replace(
    patched,
    $pattern$new\.source_type in \('measurement_receivable','recurring_receivable'\)$pattern$,
    $replacement$new.source_type in ('measurement_receivable','recurring_receivable','manual_receivable')$replacement$,
    'g'
  );
  patched := regexp_replace(
    patched,
    $pattern$case when r\.medicao_id is not null then 'measurement_receivable'[[:space:]]+else 'recurring_receivable' end$pattern$,
    $replacement$case r.origin_type when 'measurement' then 'measurement_receivable' when 'manual' then 'manual_receivable' else 'recurring_receivable' end$replacement$,
    'g'
  );
  patched := regexp_replace(
    patched,
    $pattern$case when receivable\.medicao_id is not null then 'measurement_receivable'[[:space:]]+else 'recurring_receivable' end$pattern$,
    $replacement$case receivable.origin_type when 'measurement' then 'measurement_receivable' when 'manual' then 'manual_receivable' else 'recurring_receivable' end$replacement$,
    'g'
  );
  if patched = definition then
    raise exception 'Não foi possível adicionar suporte manual à função %', fn;
  end if;
  execute patched;
end
$$;

select apticket_finance_private.patch_manual_receivable_support(
  'apticket.classify_financial_entry(text,uuid,uuid,uuid,text)'
);
select apticket_finance_private.patch_manual_receivable_support(
  'apticket_finance_private.guard_closed_classification_period()'
);
select apticket_finance_private.patch_manual_receivable_support(
  'apticket.import_bank_statement(uuid,text,text,text,date,date,jsonb)'
);
select apticket_finance_private.patch_manual_receivable_support(
  'apticket.reconcile_bank_transaction(uuid,text,uuid,text)'
);

drop function apticket_finance_private.patch_manual_receivable_support(regprocedure);

create or replace view apticket.cash_flow_entries
with (security_invoker=true)
as
select
  receivable.tenant_id, receivable.operating_company_id, 'inflow'::text as direction,
  case receivable.origin_type
    when 'measurement' then 'measurement_receivable'
    when 'manual' then 'manual_receivable'
    else 'recurring_receivable'
  end as source_type,
  receivable.id as source_id, receivable.documento_referencia as document_number,
  receivable.cliente_nome as counterparty_name, receivable.descricao as description,
  receivable.competencia as competence, receivable.vencimento_em as planned_date,
  case when receivable.valor_aberto < receivable.valor_original
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
  null::text as reconciliation_status, null::numeric(14,2) as difference_amount,
  receivable.created_at, receivable.updated_at,
  classification.id as classification_id, classification.financial_category_id,
  classification.financial_category_code, classification.financial_category_name,
  classification.cost_center_id, classification.cost_center_code, classification.cost_center_name
from apticket.contas_receber receivable
left join apticket.financial_entry_classifications classification
  on classification.source_id=receivable.id
  and classification.source_type=case receivable.origin_type
    when 'measurement' then 'measurement_receivable'
    when 'manual' then 'manual_receivable'
    else 'recurring_receivable'
  end
  and classification.replaced_at is null
where receivable.deleted_at is null and receivable.operating_company_id is not null
union all
select
  payable.tenant_id, payable.operating_company_id, 'outflow'::text, 'supplier_payable'::text,
  payable.id, payable.document_number,
  coalesce(payable.terms_snapshot->>'supplier_name','Fornecedor'), payable.description,
  payable.cycle_start, coalesce(payment.scheduled_date,payable.due_date),
  payment.paid_at::date, payable.total_amount::numeric(14,2),
  case when payable.status='paid' then 0 else payable.total_amount end::numeric(14,2),
  coalesce(payment.paid_amount,0)::numeric(14,2),
  case
    when payable.status='cancelled' then 'cancelled'
    when payable.status='paid' then 'realized'
    when coalesce(payment.scheduled_date,payable.due_date)<current_date then 'overdue'
    else 'pending'
  end,
  payable.status, payment.reconciliation_status, payment.difference_amount,
  payable.created_at, coalesce(payment.updated_at,payable.created_at),
  classification.id, classification.financial_category_id,
  classification.financial_category_code, classification.financial_category_name,
  classification.cost_center_id, classification.cost_center_code, classification.cost_center_name
from apticket.supplier_payables payable
left join lateral (
  select candidate.scheduled_date, candidate.paid_at, candidate.paid_amount,
    candidate.reconciliation_status, candidate.difference_amount, candidate.updated_at
  from apticket.supplier_payments candidate
  where candidate.supplier_payable_id=payable.id and candidate.status in ('scheduled','paid')
  limit 1
) payment on true
left join apticket.financial_entry_classifications classification
  on classification.source_id=payable.id
  and classification.source_type='supplier_payable'
  and classification.replaced_at is null
where payable.deleted_at is null;

revoke all on apticket.cash_flow_entries from public, anon, authenticated, service_role;
grant select on apticket.cash_flow_entries to authenticated, service_role;

create unique index manual_receivable_document_key
  on apticket.contas_receber(tenant_id, operating_company_id, lower(documento_referencia))
  where origin_type = 'manual' and deleted_at is null;

create function apticket.create_manual_receivable(
  p_operating_company_id uuid,
  p_company_id uuid,
  p_document_reference text,
  p_description text,
  p_competence date,
  p_due_date date,
  p_amount numeric,
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
  v_id uuid := gen_random_uuid();
  v_document text := btrim(coalesce(p_document_reference, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_competence date := date_trunc('month', p_competence)::date;
begin
  select tenant_id into v_tenant
  from apticket.operating_companies
  where id = p_operating_company_id and deleted_at is null and is_active
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa operadora ativa não encontrada.';
  end if;
  if v_actor is null
    or not apticket.has_permission(v_actor, 'financeiro_contas_receber', 'edit')
    or not apticket.has_financial_scope(v_tenant, p_operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem permissão para incluir contas a receber nesta empresa.';
  end if;

  select * into v_customer
  from apticket.companies
  where id = p_company_id and tenant_id = v_tenant
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cliente ativo não encontrado.';
  end if;
  if length(v_document) not between 2 and 80 then
    raise exception using errcode = '23514', message = 'O documento deve ter entre 2 e 80 caracteres.';
  end if;
  if length(v_description) not between 2 and 500 then
    raise exception using errcode = '23514', message = 'A descrição deve ter entre 2 e 500 caracteres.';
  end if;
  if p_competence is null or p_competence <> v_competence then
    raise exception using errcode = '23514', message = 'Informe uma competência válida.';
  end if;
  if p_due_date is null or p_due_date < v_competence then
    raise exception using errcode = '23514', message = 'O vencimento não pode anteceder a competência.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999.99 then
    raise exception using errcode = '23514', message = 'Informe um valor entre R$ 0,01 e R$ 999.999.999,99.';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'As observações devem ter no máximo 4.000 caracteres.';
  end if;

  insert into apticket.contas_receber(
    id, tenant_id, operating_company_id, medicao_id, billing_cycle_id,
    contrato_id, company_id, cliente_nome, documento_referencia, descricao,
    competencia, valor_original, valor_aberto, vencimento_em, status_cobranca,
    observacoes, aprovado_em, aprovado_por
  ) values (
    v_id, v_tenant, p_operating_company_id, null, null,
    null, v_customer.id, v_customer.name, v_document, v_description,
    v_competence, round(p_amount, 2), round(p_amount, 2), p_due_date, 'a_faturar',
    v_notes, clock_timestamp(), v_actor
  );

  return v_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Já existe uma conta a receber manual com este documento para a empresa operadora.';
end
$$;

create function apticket.create_manual_supplier_payable(
  p_operating_company_id uuid,
  p_supplier_id uuid,
  p_document_number text,
  p_description text,
  p_competence date,
  p_due_date date,
  p_amount numeric,
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
  v_id uuid := gen_random_uuid();
  v_document text := btrim(coalesce(p_document_number, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_competence date := date_trunc('month', p_competence)::date;
begin
  select tenant_id into v_tenant
  from apticket.operating_companies
  where id = p_operating_company_id and deleted_at is null and is_active
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Empresa operadora ativa não encontrada.';
  end if;
  if v_actor is null
    or not apticket.has_permission(v_actor, 'financeiro_contas_pagar', 'edit')
    or not apticket.has_financial_scope(v_tenant, p_operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem permissão para incluir contas a pagar nesta empresa.';
  end if;

  select * into v_supplier
  from apticket.suppliers
  where id = p_supplier_id and tenant_id = v_tenant and deleted_at is null and is_active
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Fornecedor ativo não encontrado.';
  end if;
  if length(v_document) not between 5 and 80 then
    raise exception using errcode = '23514', message = 'O documento deve ter entre 5 e 80 caracteres.';
  end if;
  if length(v_description) not between 2 and 500 then
    raise exception using errcode = '23514', message = 'A descrição deve ter entre 2 e 500 caracteres.';
  end if;
  if p_competence is null or p_competence <> v_competence then
    raise exception using errcode = '23514', message = 'Informe uma competência válida.';
  end if;
  if p_due_date is null or p_due_date < v_competence then
    raise exception using errcode = '23514', message = 'O vencimento não pode anteceder a competência.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 999999999.99 then
    raise exception using errcode = '23514', message = 'Informe um valor entre R$ 0,01 e R$ 999.999.999,99.';
  end if;
  if v_notes is not null and length(v_notes) > 4000 then
    raise exception using errcode = '23514', message = 'As observações devem ter no máximo 4.000 caracteres.';
  end if;

  insert into apticket.supplier_payables(
    id, tenant_id, operating_company_id, supplier_id, supplier_contract_id,
    document_number, description, cycle_start, cycle_end, due_date, billing_unit,
    measured_quantity, unit_price, total_amount, allocation_status, status,
    terms_snapshot, created_by
  ) values (
    v_id, v_tenant, p_operating_company_id, v_supplier.id, null,
    v_document, v_description, v_competence, (v_competence + interval '1 month')::date,
    p_due_date, 'fixed', 1, round(p_amount, 2), round(p_amount, 2), 'complete', 'scheduled',
    jsonb_build_object(
      'origin', 'manual',
      'supplier_name', coalesce(v_supplier.trade_name, v_supplier.legal_name),
      'supplier_tax_id', v_supplier.tax_id,
      'notes', v_notes
    ),
    v_actor
  );

  return v_id;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Já existe uma conta a pagar com este documento para a empresa operadora.';
end
$$;

revoke all on function apticket.create_manual_receivable(uuid,uuid,text,text,date,date,numeric,text)
  from public, anon, service_role;
revoke all on function apticket.create_manual_supplier_payable(uuid,uuid,text,text,date,date,numeric,text)
  from public, anon, service_role;
grant execute on function apticket.create_manual_receivable(uuid,uuid,text,text,date,date,numeric,text)
  to authenticated;
grant execute on function apticket.create_manual_supplier_payable(uuid,uuid,text,text,date,date,numeric,text)
  to authenticated;

create trigger audit_manual_receivable
after insert or update on apticket.contas_receber
for each row when (new.origin_type = 'manual')
execute function apticket_finance_private.audit_record();

-- Recebíveis manuais também podem seguir o mesmo fluxo de boleto do Inter.
create or replace function apticket_finance_private.prepare_inter_charge(
  p_receivable uuid,
  p_environment text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r apticket.contas_receber;
  existing apticket.inter_charge_requests;
  actor uuid := auth.uid();
  source_is_valid boolean;
begin
  if not apticket.has_permission(actor, 'financeiro_contas_receber', 'edit') then
    raise exception using errcode = '42501', message = 'Sem permissão para esta operação financeira.';
  end if;
  if actor is null then
    raise exception using errcode = '42501', message = 'Sessão obrigatória.';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'production') then
    raise exception using errcode = '22023', message = 'Ambiente inválido.';
  end if;

  select * into r
  from apticket.contas_receber
  where id = p_receivable and tenant_id = apticket.current_tenant_id()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Recebível indisponível.';
  end if;
  if not apticket.has_financial_scope(r.tenant_id, r.operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem acesso financeiro à empresa operadora.';
  end if;

  source_is_valid := (
    r.origin_type = 'recurring'
    and exists (
      select 1 from apticket.billing_cycles cycle
      where cycle.id = r.billing_cycle_id and cycle.contract_id = r.contrato_id
        and cycle.tenant_id = r.tenant_id
        and cycle.operating_company_id = r.operating_company_id
        and cycle.deleted_at is null
    )
  ) or (
    r.origin_type = 'measurement'
    and exists (
      select 1 from apticket.medicoes_contrato measurement
      where measurement.id = r.medicao_id and measurement.contrato_id = r.contrato_id
        and measurement.tenant_id = r.tenant_id and measurement.status = 'aprovada'
        and measurement.deleted_at is null
    )
  ) or r.origin_type = 'manual';

  if r.deleted_at is not null or r.status_cobranca <> 'a_faturar'
    or r.valor_aberto <= 0 or r.valor_aberto <> r.valor_original
    or not source_is_valid
    or not exists (
      select 1 from apticket.operating_companies operator
      where operator.id = r.operating_company_id and operator.tenant_id = r.tenant_id
        and operator.deleted_at is null and operator.is_active
    ) then
    raise exception using errcode = '23514', message = 'Recebível não elegível para preparação.';
  end if;

  select * into existing
  from apticket.inter_charge_requests
  where receivable_id = r.id and environment = p_environment;

  if found then
    if existing.deleted_at is not null or existing.amount <> r.valor_aberto
      or existing.due_date <> r.vencimento_em then
      raise exception using errcode = '40001',
        message = 'Recebível alterado após a preparação. Solicite revisão antes da emissão.';
    end if;
    return jsonb_build_object('id', existing.id, 'status', existing.status, 'reused', true);
  end if;

  insert into apticket.inter_charge_requests(
    tenant_id, operating_company_id, receivable_id, environment,
    amount, due_date, created_by
  ) values (
    r.tenant_id, r.operating_company_id, r.id, p_environment,
    r.valor_aberto, r.vencimento_em, actor
  ) returning * into existing;

  return jsonb_build_object('id', existing.id, 'status', existing.status, 'reused', false);
end
$$;

revoke all on function apticket_finance_private.prepare_inter_charge(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function apticket_finance_private.prepare_inter_charge(uuid,text)
  to authenticated;

comment on function apticket.create_manual_receivable(uuid,uuid,text,text,date,date,numeric,text)
  is 'Cria conta a receber manual com validação de tenant, empresa, cliente e permissão financeira.';
comment on function apticket.create_manual_supplier_payable(uuid,uuid,text,text,date,date,numeric,text)
  is 'Cria conta a pagar manual pronta para classificação, aprovação e pagamento.';

notify pgrst, 'reload schema';
