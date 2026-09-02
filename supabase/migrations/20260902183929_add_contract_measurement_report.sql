alter table apticket.medicoes_contrato
  add column if not exists report_token uuid not null default gen_random_uuid();

create unique index if not exists medicoes_contrato_report_token_key
  on apticket.medicoes_contrato (report_token);

comment on column apticket.medicoes_contrato.report_token is
  'Token não sequencial usado para consultar publicamente o boletim de medição.';

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
