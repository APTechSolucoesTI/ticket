-- A revisao usada pela interface deve separar dados cadastrais do ciclo
-- financeiro. Depois do envio, o snapshot confirmado passa a ser a fonte
-- historica e o recebivel pode mudar legitimamente para faturado/recebido.
create function apticket_finance_private.review_inter_payer_display(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  req apticket.inter_charge_requests;
  snap apticket.inter_payer_snapshots;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sessao obrigatoria.';
  end if;

  select * into req
  from apticket.inter_charge_requests
  where id = p_request
    and tenant_id = apticket.current_tenant_id()
    and deleted_at is null;

  if not found or not apticket.has_financial_scope(req.tenant_id, req.operating_company_id) then
    raise exception using errcode = '42501',
      message = 'Solicitacao indisponivel ou sem acesso a empresa.';
  end if;

  if req.status not in ('submitted', 'uncertain') then
    return apticket_finance_private.review_inter_payer(p_request);
  end if;

  select * into snap
  from apticket.inter_payer_snapshots
  where request_id = req.id and deleted_at is null;

  if not found then
    raise exception using errcode = '23514',
      message = 'Snapshot confirmado do pagador indisponivel.';
  end if;

  return jsonb_build_object(
    'state', 'confirmed',
    'missing_fields', '[]'::jsonb,
    'request_id', req.id,
    'environment', req.environment,
    'binding_id', snap.binding_id,
    'snapshot_id', snap.id,
    'confirmed_at', snap.created_at,
    'source_updated_at', snap.source_updated_at,
    'source_fingerprint', snap.source_fingerprint,
    'seu_numero', snap.seu_numero,
    'amount', snap.amount,
    'due_date', snap.due_date,
    'payer', jsonb_build_object(
      'name', snap.payer_name,
      'tax_id', snap.payer_tax_id,
      'type', snap.payer_type,
      'email', snap.payer_email,
      'ddd', snap.payer_ddd,
      'phone', snap.payer_phone,
      'street', snap.payer_street,
      'number', snap.payer_number,
      'complement', snap.payer_complement,
      'district', snap.payer_district,
      'city', snap.payer_city,
      'state', snap.payer_state,
      'zip', snap.payer_zip
    ),
    'dispatch_enabled', false
  );
end
$$;

revoke all on function apticket_finance_private.review_inter_payer_display(uuid)
  from public, anon, authenticated, service_role;
grant execute on function apticket_finance_private.review_inter_payer_display(uuid)
  to authenticated;

create function apticket.review_inter_payer_display(p_request uuid)
returns jsonb
language sql
security invoker
set search_path = pg_catalog
as $$
  select apticket_finance_private.review_inter_payer_display(p_request);
$$;

revoke all on function apticket.review_inter_payer_display(uuid)
  from public, anon, service_role;
grant execute on function apticket.review_inter_payer_display(uuid)
  to authenticated;

notify pgrst, 'reload schema';
