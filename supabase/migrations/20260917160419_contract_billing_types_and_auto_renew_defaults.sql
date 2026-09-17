-- Novos contratos devem nascer com renovacao automatica habilitada tanto no
-- fluxo de clientes quanto no de fornecedores.
alter table apticket.contracts alter column auto_renew set default true;
alter table apticket.supplier_contracts alter column auto_renew set default true;

-- Substitui os dois indicadores booleanos por classificacoes explicitas. Os
-- campos antigos permanecem sincronizados para manter compatibilidade com
-- rotinas e integracoes publicadas antes desta evolucao.
alter table apticket.contracts
  add column billing_type text,
  add column collection_type text;

update apticket.contracts
set
  billing_type = case
    when emite_nf then 'service_invoice'
    else 'invoice'
  end,
  collection_type = case
    when emite_boleto then 'boleto_inter_pj'
    else 'carteira'
  end;

alter table apticket.contracts
  alter column billing_type set default 'invoice',
  alter column billing_type set not null,
  alter column collection_type set default 'carteira',
  alter column collection_type set not null,
  add constraint contracts_billing_type_check
    check (billing_type in ('service_invoice', 'invoice', 'simple_receipt')),
  add constraint contracts_collection_type_check
    check (collection_type in ('boleto_pf', 'boleto_inter_pj', 'carteira'));

comment on column apticket.contracts.billing_type is
  'Documento de faturamento previsto: nota fiscal de servico, fatura ou recibo simples.';
comment on column apticket.contracts.collection_type is
  'Forma de cobranca prevista: boleto PF, boleto Inter PJ ou em carteira.';

create function apticket_finance_private.sync_contract_billing_terms()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.emite_nf := new.billing_type = 'service_invoice';
  new.emite_boleto := new.collection_type in ('boleto_pf', 'boleto_inter_pj');
  return new;
end
$$;

revoke all on function apticket_finance_private.sync_contract_billing_terms()
  from public, anon, authenticated, service_role;

create trigger sync_contract_billing_terms
before insert or update of billing_type, collection_type
on apticket.contracts
for each row execute function apticket_finance_private.sync_contract_billing_terms();

-- A medicao preserva uma fotografia dos termos vigentes no momento em que foi
-- gerada. O trigger permite que a funcao legada de geracao continue estavel.
alter table apticket.medicoes_contrato
  add column billing_type text,
  add column collection_type text;

alter table apticket.medicoes_contrato disable trigger medicoes_contrato_bloquear_alteracao;

update apticket.medicoes_contrato
set
  billing_type = case
    when emite_nf then 'service_invoice'
    else 'invoice'
  end,
  collection_type = case
    when emite_boleto then 'boleto_inter_pj'
    else 'carteira'
  end;

alter table apticket.medicoes_contrato enable trigger medicoes_contrato_bloquear_alteracao;

alter table apticket.medicoes_contrato
  alter column billing_type set not null,
  alter column collection_type set not null,
  add constraint contract_measurements_billing_type_check
    check (billing_type in ('service_invoice', 'invoice', 'simple_receipt')),
  add constraint contract_measurements_collection_type_check
    check (collection_type in ('boleto_pf', 'boleto_inter_pj', 'carteira'));

create function apticket_finance_private.fill_measurement_billing_terms()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  select contract.billing_type, contract.collection_type
  into new.billing_type, new.collection_type
  from apticket.contracts as contract
  where contract.id = new.contrato_id
    and contract.tenant_id = new.tenant_id;

  if new.billing_type is null or new.collection_type is null then
    raise exception using
      errcode = '23514',
      message = 'Os termos de faturamento e cobranca do contrato nao foram encontrados.';
  end if;

  new.emite_nf := new.billing_type = 'service_invoice';
  new.emite_boleto := new.collection_type in ('boleto_pf', 'boleto_inter_pj');
  return new;
end
$$;

revoke all on function apticket_finance_private.fill_measurement_billing_terms()
  from public, anon, authenticated, service_role;

create trigger aa_fill_measurement_billing_terms
before insert on apticket.medicoes_contrato
for each row execute function apticket_finance_private.fill_measurement_billing_terms();

create or replace function apticket.get_contract_measurement_report_by_token(_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, apticket
as $$
  select jsonb_build_object(
    'report_number',
      'BM-' || replace(m.numero_contrato, '/', '-') || '-' || to_char(m.competencia, 'YYYYMM'),
    'generated_at', m.created_at,
    'measurement_date', m.data_medicao,
    'competence', m.competencia,
    'due_date', m.data_vencimento,
    'contract_number', m.numero_contrato,
    'client_name', m.cliente_nome,
    'contract_type_name', m.tipo_contrato_nome,
    'billing_model', m.modelo_cobranca,
    'status', m.status,
    'billing_type', m.billing_type,
    'collection_type', m.collection_type,
    'issues_invoice', m.emite_nf,
    'issues_bank_slip', m.emite_boleto,
    'total_value', m.valor_total,
    'tenant_name', tenant.name,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'type', item.tipo_item,
            'reference', item.referencia,
            'description', item.descricao,
            'quantity', item.quantidade,
            'unit_value', item.valor_unitario,
            'total_value', item.valor_total
          )
          order by item.created_at, item.id
        )
        from apticket.medicao_itens as item
        where item.medicao_id = m.id
      ),
      '[]'::jsonb
    )
  )
  from apticket.medicoes_contrato as m
  join apticket.tenants as tenant on tenant.id = m.tenant_id
  where m.report_token = _token
    and m.deleted_at is null;
$$;

revoke all on function apticket.get_contract_measurement_report_by_token(uuid)
  from public, anon, authenticated;
grant execute on function apticket.get_contract_measurement_report_by_token(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
