begin;

-- Contas de medição também podem pertencer a uma empresa operadora. A
-- origem continua exclusiva: uma conta nasce de medição OU ciclo recorrente.
alter table apticket.contas_receber
  drop constraint receivable_origin_check,
  add constraint receivable_origin_check check (
    (medicao_id is not null and billing_cycle_id is null)
    or (medicao_id is null and billing_cycle_id is not null and operating_company_id is not null)
  ),
  add constraint receivable_operating_company_fk
    foreign key (operating_company_id, tenant_id)
    references apticket.operating_companies(id, tenant_id) on delete restrict;

create or replace function apticket_finance_private.assign_measurement_operating_company()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_explicit uuid;
  v_fallback uuid;
begin
  if new.medicao_id is null or new.operating_company_id is not null then
    return new;
  end if;

  select terms.operating_company_id into v_explicit
  from apticket.contract_financial_terms as terms
  where terms.contract_id = new.contrato_id
    and terms.tenant_id = new.tenant_id
    and terms.deleted_at is null;

  if v_explicit is not null then
    if exists (
      select 1 from apticket.operating_companies as operator
      where operator.id = v_explicit
        and operator.tenant_id = new.tenant_id
        and operator.deleted_at is null
    ) then
      new.operating_company_id := v_explicit;
    end if;
    return new;
  end if;

  select candidate.id into v_fallback
  from (
    select operator.id, count(*) over () as active_count
    from apticket.operating_companies as operator
    where operator.tenant_id = new.tenant_id
      and operator.deleted_at is null
  ) as candidate
  where candidate.active_count = 1;

  new.operating_company_id := v_fallback;
  return new;
end
$$;

revoke all on function apticket_finance_private.assign_measurement_operating_company()
  from public, anon, authenticated, service_role;

drop trigger if exists assign_measurement_operating_company on apticket.contas_receber;
create trigger assign_measurement_operating_company
before insert on apticket.contas_receber
for each row execute function apticket_finance_private.assign_measurement_operating_company();

-- Migra contas históricas sem reescrever sua origem financeira protegida. A
-- preferência é sempre o vínculo do contrato; o fallback só existe quando a
-- tenant possui exatamente uma empresa operadora ativa.
alter table apticket.contas_receber disable trigger guard_receivable_cycle;

with resolved as (
  select
    receivable.id,
    coalesce(
      (
        select terms.operating_company_id
        from apticket.contract_financial_terms as terms
        join apticket.operating_companies as operator
          on operator.id = terms.operating_company_id
         and operator.tenant_id = terms.tenant_id
         and operator.deleted_at is null
        where terms.contract_id = receivable.contrato_id
          and terms.tenant_id = receivable.tenant_id
          and terms.deleted_at is null
      ),
      (
        select candidate.id
        from (
          select operator.id, count(*) over () as active_count
          from apticket.operating_companies as operator
          where operator.tenant_id = receivable.tenant_id
            and operator.deleted_at is null
        ) as candidate
        where candidate.active_count = 1
          and not exists (
            select 1 from apticket.contract_financial_terms as terms
            where terms.contract_id = receivable.contrato_id
              and terms.tenant_id = receivable.tenant_id
              and terms.deleted_at is null
          )
      )
    ) as operating_company_id
  from apticket.contas_receber as receivable
  where receivable.medicao_id is not null
    and receivable.operating_company_id is null
)
update apticket.contas_receber as receivable
set operating_company_id = resolved.operating_company_id,
    updated_at = now()
from resolved
where receivable.id = resolved.id
  and resolved.operating_company_id is not null;

alter table apticket.contas_receber enable trigger guard_receivable_cycle;

-- O outbox bancário aceita as duas origens contratuais, mantendo as mesmas
-- garantias de tenant, empresa, permissão, saldo, idempotência e imutabilidade.
create or replace function apticket_finance_private.prepare_inter_charge(
  p_receivable uuid,
  p_environment text
)
returns jsonb
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
  if actor is null then
    raise exception using errcode = '42501', message = 'Sessão obrigatória.';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'production') then
    raise exception using errcode = '22023', message = 'Ambiente inválido.';
  end if;

  select * into r
  from apticket.contas_receber
  where id = p_receivable
    and tenant_id = apticket.current_tenant_id()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Recebível indisponível.';
  end if;
  if r.operating_company_id is null then
    raise exception using errcode = '23514',
      message = 'Defina a empresa operadora deste contrato antes de emitir a cobrança.';
  end if;
  if not apticket.has_financial_scope(r.tenant_id, r.operating_company_id, true) then
    raise exception using errcode = '42501', message = 'Sem acesso financeiro à empresa operadora.';
  end if;

  source_is_valid := (
    r.billing_cycle_id is not null
    and r.medicao_id is null
    and exists (
      select 1 from apticket.billing_cycles as cycle
      where cycle.id = r.billing_cycle_id
        and cycle.contract_id = r.contrato_id
        and cycle.tenant_id = r.tenant_id
        and cycle.operating_company_id = r.operating_company_id
        and cycle.deleted_at is null
    )
  ) or (
    r.medicao_id is not null
    and r.billing_cycle_id is null
    and exists (
      select 1 from apticket.medicoes_contrato as measurement
      where measurement.id = r.medicao_id
        and measurement.contrato_id = r.contrato_id
        and measurement.tenant_id = r.tenant_id
        and measurement.status = 'aprovada'
        and measurement.deleted_at is null
    )
  );

  if r.deleted_at is not null
    or r.status_cobranca <> 'a_faturar'
    or r.valor_aberto <= 0
    or r.valor_aberto <> r.valor_original
    or not source_is_valid
    or not exists (
      select 1 from apticket.operating_companies as operator
      where operator.id = r.operating_company_id
        and operator.tenant_id = r.tenant_id
        and operator.deleted_at is null
    ) then
    raise exception using errcode = '23514', message = 'Recebível não elegível para preparação.';
  end if;

  select * into existing
  from apticket.inter_charge_requests
  where receivable_id = r.id
    and environment = p_environment;

  if found then
    if existing.deleted_at is not null
      or existing.amount <> r.valor_aberto
      or existing.due_date <> r.vencimento_em then
      raise exception using errcode = '40001',
        message = 'Recebível alterado após a preparação. Solicite revisão antes da emissão.';
    end if;
    return jsonb_build_object('id', existing.id, 'status', existing.status, 'reused', true);
  end if;

  insert into apticket.inter_charge_requests (
    tenant_id, operating_company_id, receivable_id, environment,
    amount, due_date, created_by
  ) values (
    r.tenant_id, r.operating_company_id, r.id, p_environment,
    r.valor_aberto, r.vencimento_em, actor
  )
  returning * into existing;

  return jsonb_build_object('id', existing.id, 'status', existing.status, 'reused', false);
end
$$;

revoke all on function apticket_finance_private.prepare_inter_charge(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function apticket_finance_private.prepare_inter_charge(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
