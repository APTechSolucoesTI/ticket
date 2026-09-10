begin;

-- O cadastro preserva o padrão internacional (país + DDD + número). O
-- Banco Inter recebe os campos brasileiros DDD e telefone separadamente.
create or replace function apticket_finance_private.normalize_inter_phone(value text)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
begin
  if length(digits) in (12, 13) and left(digits, 2) = '55' then
    digits := substring(digits from 3);
  end if;

  if length(digits) in (10, 11) then
    return array[left(digits, 2), substring(digits from 3)];
  end if;

  return array[null::text, null::text];
end
$$;

revoke all on function apticket_finance_private.normalize_inter_phone(text)
  from public, anon, authenticated, service_role;

create or replace function apticket_finance_private.review_inter_payer(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  req apticket.inter_charge_requests;
  rec apticket.contas_receber;
  customer apticket.companies;
  cfg apticket.tenant_inter_configurations;
  binding apticket.operating_company_inter_bindings;
  snap apticket.inter_payer_snapshots;
  missing text[] := '{}';
  tax text;
  zip text;
  phone_parts text[];
  ddd text;
  local_phone text;
  canonical_phone text;
  number_code text;
  state text;
  fingerprint text;
  result_state text;
  binding_review jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sessão obrigatória.';
  end if;

  select * into req
  from apticket.inter_charge_requests
  where id = p_request
    and tenant_id = apticket.current_tenant_id()
    and deleted_at is null;

  if not found or not apticket.has_financial_scope(req.tenant_id, req.operating_company_id) then
    raise exception using errcode = '42501',
      message = 'Solicitação indisponível ou sem acesso à empresa.';
  end if;

  select * into rec
  from apticket.contas_receber
  where id = req.receivable_id
    and tenant_id = req.tenant_id
    and operating_company_id = req.operating_company_id
    and deleted_at is null;
  if not found then
    raise exception using errcode = '23514', message = 'Recebível da solicitação indisponível.';
  end if;

  select * into customer
  from apticket.companies
  where id = rec.company_id and tenant_id = req.tenant_id;
  if not found then
    raise exception using errcode = '23514', message = 'Cliente da solicitação indisponível.';
  end if;

  select * into cfg
  from apticket.tenant_inter_configurations
  where tenant_id = req.tenant_id and environment = req.environment;
  select * into binding
  from apticket.operating_company_inter_bindings
  where tenant_id = req.tenant_id
    and operating_company_id = req.operating_company_id
    and environment = req.environment
    and deleted_at is null;
  binding_review := apticket_finance_private.review_inter_binding(
    req.operating_company_id,
    req.environment
  );
  select * into snap
  from apticket.inter_payer_snapshots
  where request_id = req.id and deleted_at is null;

  tax := regexp_replace(coalesce(customer.cnpj, ''), '[^0-9]', '', 'g');
  zip := regexp_replace(coalesce(customer.address_zip, ''), '[^0-9]', '', 'g');
  phone_parts := apticket_finance_private.normalize_inter_phone(customer.phone);
  ddd := phone_parts[1];
  local_phone := phone_parts[2];
  canonical_phone := coalesce(ddd, '') || coalesce(local_phone, '');
  state := upper(btrim(coalesce(customer.address_state, '')));
  number_code := 'AP' || upper(left(replace(req.id::text, '-', ''), 13));
  fingerprint := md5(concat_ws(chr(31),
    btrim(coalesce(customer.name, '')), tax, canonical_phone,
    btrim(coalesce(customer.address_street, '')),
    btrim(coalesce(customer.address_number, '')),
    btrim(coalesce(customer.address_complement, '')),
    btrim(coalesce(customer.address_neighborhood, '')),
    btrim(coalesce(customer.address_city, '')), state, zip
  ));

  if length(btrim(coalesce(customer.name, ''))) not between 1 and 100 then
    missing := array_append(missing, 'name');
  end if;
  if not apticket_finance_private.is_valid_cnpj(tax) then
    missing := array_append(missing, 'tax_id');
  end if;
  if length(btrim(coalesce(customer.address_street, ''))) not between 1 and 200 then
    missing := array_append(missing, 'street');
  end if;
  if length(btrim(coalesce(customer.address_number, ''))) not between 1 and 20 then
    missing := array_append(missing, 'number');
  end if;
  if length(btrim(coalesce(customer.address_neighborhood, ''))) not between 1 and 120 then
    missing := array_append(missing, 'district');
  end if;
  if length(btrim(coalesce(customer.address_city, ''))) not between 1 and 100 then
    missing := array_append(missing, 'city');
  end if;
  if not state = any(array[
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
    'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ]) then
    missing := array_append(missing, 'state');
  end if;
  if zip !~ '^[0-9]{8}$' then missing := array_append(missing, 'zip'); end if;
  if btrim(coalesce(customer.phone, '')) <> '' and local_phone is null then
    missing := array_append(missing, 'phone');
  end if;
  if req.amount not between 2.50 and 99999999.99 then
    missing := array_append(missing, 'amount');
  end if;
  if req.due_date < current_date then missing := array_append(missing, 'due_date'); end if;
  if rec.status_cobranca <> 'a_faturar'
    or rec.valor_aberto <> rec.valor_original
    or req.amount <> rec.valor_aberto
    or req.due_date <> rec.vencimento_em then
    missing := array_append(missing, 'receivable');
  end if;

  result_state := case
    when cardinality(missing) > 0 then 'missing_data'
    when cfg.tenant_id is null or binding.id is null
      or binding.configuration_version <> cfg.version
      or binding_review ->> 'state' <> 'confirmed' then 'binding_required'
    when snap.id is null then 'confirmation_required'
    when snap.binding_id <> binding.id or snap.source_fingerprint <> fingerprint
      or snap.amount <> req.amount or snap.due_date <> req.due_date then 'confirmation_outdated'
    else 'confirmed'
  end;

  return jsonb_build_object(
    'state', result_state,
    'missing_fields', to_jsonb(missing),
    'request_id', req.id,
    'environment', req.environment,
    'binding_id', binding.id,
    'snapshot_id', snap.id,
    'confirmed_at', snap.created_at,
    'source_updated_at', customer.updated_at,
    'source_fingerprint', fingerprint,
    'seu_numero', number_code,
    'amount', req.amount,
    'due_date', req.due_date,
    'payer', jsonb_build_object(
      'name', btrim(customer.name),
      'tax_id', nullif(tax, ''),
      'type', 'JURIDICA',
      'email', null,
      'ddd', ddd,
      'phone', local_phone,
      'street', nullif(btrim(customer.address_street), ''),
      'number', nullif(btrim(customer.address_number), ''),
      'complement', nullif(btrim(customer.address_complement), ''),
      'district', nullif(btrim(customer.address_neighborhood), ''),
      'city', nullif(btrim(customer.address_city), ''),
      'state', nullif(state, ''),
      'zip', nullif(zip, '')
    ),
    'dispatch_enabled', false
  );
end
$$;

create or replace function apticket_finance_private.confirm_inter_payer(
  p_request uuid,
  p_source_fingerprint text,
  p_binding uuid,
  p_previous_snapshot uuid,
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  req apticket.inter_charge_requests;
  rec apticket.contas_receber;
  customer apticket.companies;
  review jsonb;
  snap apticket.inter_payer_snapshots;
  tax text;
  phone_parts text[];
  ddd text;
  local_phone text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sessão obrigatória.';
  end if;

  select * into req
  from apticket.inter_charge_requests
  where id = p_request
    and tenant_id = apticket.current_tenant_id()
    and deleted_at is null
  for update;

  if not found
    or not apticket.has_financial_scope(req.tenant_id, req.operating_company_id, true)
    or not exists (
      select 1
      from apticket.user_roles as user_role
      join apticket.roles as role on role.id = user_role.role_id
      where user_role.user_id = auth.uid()
        and role.tenant_id = req.tenant_id
        and role.name in ('Admin', 'Financeiro')
    ) then
    raise exception using errcode = '42501',
      message = 'Exige perfil Admin ou Financeiro com acesso de escrita à empresa.';
  end if;

  if p_confirmed is distinct from true
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[0-9a-f]{32}$'
    or p_binding is null then
    raise exception using errcode = '22023',
      message = 'Confirme os dados do pagador e o vínculo revisados.';
  end if;

  select * into rec
  from apticket.contas_receber
  where id = req.receivable_id
    and tenant_id = req.tenant_id
    and operating_company_id = req.operating_company_id
    and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'Recebível da solicitação indisponível.';
  end if;

  select * into customer
  from apticket.companies
  where id = rec.company_id and tenant_id = req.tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'Cliente da solicitação indisponível.';
  end if;

  review := apticket_finance_private.review_inter_payer(req.id);
  if review ->> 'state' = 'missing_data' then
    raise exception using errcode = '23514',
      message = 'Complete os dados obrigatórios do pagador antes de confirmar.';
  end if;
  if review ->> 'state' = 'binding_required' then
    raise exception using errcode = '23514',
      message = 'Confirme o vínculo bancário deste ambiente antes do pagador.';
  end if;
  if review ->> 'source_fingerprint' <> p_source_fingerprint
    or (review ->> 'binding_id')::uuid <> p_binding then
    raise exception using errcode = '40001', message = 'Dados alterados. Consulte e confirme novamente.';
  end if;

  select * into snap
  from apticket.inter_payer_snapshots
  where request_id = req.id and deleted_at is null;
  if snap.id is not null and review ->> 'state' = 'confirmed' then
    return jsonb_build_object('id', snap.id, 'reused', true, 'dispatch_enabled', false);
  end if;
  if snap.id is distinct from p_previous_snapshot then
    raise exception using errcode = '40001',
      message = 'Snapshot alterado. Consulte e confirme novamente.';
  end if;

  update apticket.inter_payer_snapshots set deleted_at = now() where id = snap.id;
  tax := regexp_replace(customer.cnpj, '[^0-9]', '', 'g');
  phone_parts := apticket_finance_private.normalize_inter_phone(customer.phone);
  ddd := phone_parts[1];
  local_phone := phone_parts[2];

  insert into apticket.inter_payer_snapshots (
    tenant_id, operating_company_id, request_id, receivable_id, environment,
    customer_company_id, binding_id, seu_numero, amount, due_date, payer_name,
    payer_tax_id, payer_type, payer_ddd, payer_phone, payer_street, payer_number,
    payer_complement, payer_district, payer_city, payer_state, payer_zip,
    source_fingerprint, source_updated_at, created_by
  ) values (
    req.tenant_id, req.operating_company_id, req.id, req.receivable_id,
    req.environment, customer.id, p_binding, review ->> 'seu_numero', req.amount,
    req.due_date, btrim(customer.name), tax, 'JURIDICA', ddd, local_phone,
    btrim(customer.address_street), btrim(customer.address_number),
    nullif(btrim(customer.address_complement), ''),
    btrim(customer.address_neighborhood), btrim(customer.address_city),
    upper(btrim(customer.address_state)),
    regexp_replace(customer.address_zip, '[^0-9]', '', 'g'),
    p_source_fingerprint, customer.updated_at, auth.uid()
  )
  returning * into snap;

  return jsonb_build_object('id', snap.id, 'reused', false, 'dispatch_enabled', false);
end
$$;

revoke all on function apticket_finance_private.review_inter_payer(uuid)
  from public, anon, authenticated, service_role;
revoke all on function apticket_finance_private.confirm_inter_payer(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function apticket_finance_private.review_inter_payer(uuid) to authenticated;
grant execute on function apticket_finance_private.confirm_inter_payer(uuid, text, uuid, uuid, boolean)
  to authenticated;

notify pgrst, 'reload schema';

commit;
