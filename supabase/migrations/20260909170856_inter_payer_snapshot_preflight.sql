-- Fatia 8: pré-validação e snapshot do pagador. Não chama o Banco Inter.
alter table apticket.inter_charge_requests
  add constraint inter_request_snapshot_scope_key unique(id,tenant_id,operating_company_id,receivable_id);
alter table apticket.operating_company_inter_bindings
  add constraint inter_binding_snapshot_scope_key unique(id,tenant_id,operating_company_id,environment);
alter table apticket.companies
  add constraint companies_payer_scope_key unique(id,tenant_id);

create table apticket.inter_payer_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  request_id uuid not null,
  receivable_id uuid not null,
  environment text not null check (environment in ('sandbox','production')),
  customer_company_id uuid not null,
  binding_id uuid not null,
  seu_numero text not null check (seu_numero ~ '^[A-Z0-9]{1,15}$'),
  amount numeric(14,2) not null check (amount between 2.50 and 99999999.99),
  due_date date not null,
  payer_name text not null check (length(btrim(payer_name)) between 1 and 100),
  payer_tax_id text not null check (payer_tax_id ~ '^[0-9]{14}$'),
  payer_type text not null check (payer_type='JURIDICA'),
  payer_email text check (payer_email is null or length(payer_email) between 3 and 100),
  payer_ddd text check (payer_ddd is null or payer_ddd ~ '^[0-9]{2}$'),
  payer_phone text check (payer_phone is null or payer_phone ~ '^[0-9]{8,9}$'),
  payer_street text not null check (length(btrim(payer_street)) between 1 and 200),
  payer_number text not null check (length(btrim(payer_number)) between 1 and 20),
  payer_complement text check (payer_complement is null or length(payer_complement)<=120),
  payer_district text not null check (length(btrim(payer_district)) between 1 and 120),
  payer_city text not null check (length(btrim(payer_city)) between 1 and 100),
  payer_state text not null check (payer_state ~ '^[A-Z]{2}$'),
  payer_zip text not null check (payer_zip ~ '^[0-9]{8}$'),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{32}$'),
  source_updated_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(request_id,tenant_id,operating_company_id,receivable_id)
    references apticket.inter_charge_requests(id,tenant_id,operating_company_id,receivable_id) on delete restrict,
  foreign key(binding_id,tenant_id,operating_company_id,environment)
    references apticket.operating_company_inter_bindings(id,tenant_id,operating_company_id,environment) on delete restrict,
  foreign key(customer_company_id,tenant_id) references apticket.companies(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index inter_payer_current on apticket.inter_payer_snapshots(request_id) where deleted_at is null;
create unique index inter_payer_number on apticket.inter_payer_snapshots(tenant_id,environment,seu_numero)
  where deleted_at is null;
create index inter_payer_scope on apticket.inter_payer_snapshots(tenant_id,operating_company_id);
alter table apticket.inter_payer_snapshots enable row level security;
revoke all on apticket.inter_payer_snapshots from public,anon,authenticated,service_role;
grant select on apticket.inter_payer_snapshots to authenticated,service_role;
create policy inter_payer_read on apticket.inter_payer_snapshots for select to authenticated
  using(apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger inter_payer_no_delete before delete on apticket.inter_payer_snapshots
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_payer_no_truncate before truncate on apticket.inter_payer_snapshots
  for each statement execute function apticket_finance_private.guard_record();
create trigger inter_payer_audit after insert or update on apticket.inter_payer_snapshots
  for each row execute function apticket_finance_private.audit_record();

create function apticket_finance_private.is_valid_cnpj(value text)
returns boolean language plpgsql immutable strict set search_path=pg_catalog as $$
declare digits text:=regexp_replace(value,'[^0-9]','','g'); total integer; remainder integer; d1 integer; d2 integer; i integer;
begin
  if digits !~ '^[0-9]{14}$' or digits=repeat(left(digits,1),14) then return false; end if;
  total:=0;
  for i in 1..12 loop total:=total+substring(digits,i,1)::integer*(array[5,4,3,2,9,8,7,6,5,4,3,2])[i]; end loop;
  remainder:=11-(total%11); d1:=case when remainder>=10 then 0 else remainder end;
  total:=0;
  for i in 1..13 loop total:=total+substring(digits,i,1)::integer*(array[6,5,4,3,2,9,8,7,6,5,4,3,2])[i]; end loop;
  remainder:=11-(total%11); d2:=case when remainder>=10 then 0 else remainder end;
  return right(digits,2)=(d1::text||d2::text);
end $$;
revoke all on function apticket_finance_private.is_valid_cnpj(text) from public,anon,authenticated,service_role;

create function apticket_finance_private.review_inter_payer(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  req apticket.inter_charge_requests; rec apticket.contas_receber; customer apticket.companies;
  cfg apticket.tenant_inter_configurations; binding apticket.operating_company_inter_bindings;
  snap apticket.inter_payer_snapshots; missing text[]:='{}'; tax text; zip text; phone text;
  ddd text; local_phone text; number_code text; state text; fingerprint text; result_state text;
  binding_review jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  select * into req from apticket.inter_charge_requests where id=p_request
    and tenant_id=apticket.current_tenant_id() and deleted_at is null;
  if not found or not apticket.has_financial_scope(req.tenant_id,req.operating_company_id) then
    raise exception using errcode='42501',message='Solicitação indisponível ou sem acesso à empresa.';
  end if;
  select * into rec from apticket.contas_receber where id=req.receivable_id and tenant_id=req.tenant_id
    and operating_company_id=req.operating_company_id and deleted_at is null;
  if not found then raise exception using errcode='23514',message='Recebível da solicitação indisponível.'; end if;
  select * into customer from apticket.companies where id=rec.company_id and tenant_id=req.tenant_id;
  if not found then raise exception using errcode='23514',message='Cliente da solicitação indisponível.'; end if;
  select * into cfg from apticket.tenant_inter_configurations where tenant_id=req.tenant_id and environment=req.environment;
  select * into binding from apticket.operating_company_inter_bindings where tenant_id=req.tenant_id
    and operating_company_id=req.operating_company_id and environment=req.environment and deleted_at is null;
  binding_review:=apticket_finance_private.review_inter_binding(req.operating_company_id,req.environment);
  select * into snap from apticket.inter_payer_snapshots where request_id=req.id and deleted_at is null;
  tax:=regexp_replace(coalesce(customer.cnpj,''),'[^0-9]','','g');
  zip:=regexp_replace(coalesce(customer.address_zip,''),'[^0-9]','','g');
  phone:=regexp_replace(coalesce(customer.phone,''),'[^0-9]','','g');
  if length(phone) in (10,11) then ddd:=left(phone,2); local_phone:=substring(phone from 3); end if;
  state:=upper(btrim(coalesce(customer.address_state,'')));
  number_code:='AP'||upper(left(replace(req.id::text,'-',''),13));
  fingerprint:=md5(concat_ws(chr(31),btrim(coalesce(customer.name,'')),tax,phone,
    btrim(coalesce(customer.address_street,'')),btrim(coalesce(customer.address_number,'')),
    btrim(coalesce(customer.address_complement,'')),btrim(coalesce(customer.address_neighborhood,'')),
    btrim(coalesce(customer.address_city,'')),state,zip));
  if length(btrim(coalesce(customer.name,''))) not between 1 and 100 then missing:=array_append(missing,'name'); end if;
  if not apticket_finance_private.is_valid_cnpj(tax) then missing:=array_append(missing,'tax_id'); end if;
  if length(btrim(coalesce(customer.address_street,''))) not between 1 and 200 then missing:=array_append(missing,'street'); end if;
  if length(btrim(coalesce(customer.address_number,''))) not between 1 and 20 then missing:=array_append(missing,'number'); end if;
  if length(btrim(coalesce(customer.address_neighborhood,''))) not between 1 and 120 then missing:=array_append(missing,'district'); end if;
  if length(btrim(coalesce(customer.address_city,''))) not between 1 and 100 then missing:=array_append(missing,'city'); end if;
  if not state=any(array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']) then missing:=array_append(missing,'state'); end if;
  if zip !~ '^[0-9]{8}$' then missing:=array_append(missing,'zip'); end if;
  if phone<>'' and local_phone is null then missing:=array_append(missing,'phone'); end if;
  if req.amount not between 2.50 and 99999999.99 then missing:=array_append(missing,'amount'); end if;
  if req.due_date<current_date then missing:=array_append(missing,'due_date'); end if;
  if rec.status_cobranca<>'a_faturar' or rec.valor_aberto<>rec.valor_original
    or req.amount<>rec.valor_aberto or req.due_date<>rec.vencimento_em then
    missing:=array_append(missing,'receivable');
  end if;
  result_state:=case
    when cardinality(missing)>0 then 'missing_data'
    when cfg.tenant_id is null or binding.id is null or binding.configuration_version<>cfg.version
      or binding_review->>'state'<>'confirmed' then 'binding_required'
    when snap.id is null then 'confirmation_required'
    when snap.binding_id<>binding.id or snap.source_fingerprint<>fingerprint
      or snap.amount<>req.amount or snap.due_date<>req.due_date then 'confirmation_outdated'
    else 'confirmed' end;
  return jsonb_build_object('state',result_state,'missing_fields',to_jsonb(missing),
    'request_id',req.id,'environment',req.environment,'binding_id',binding.id,
    'snapshot_id',snap.id,'confirmed_at',snap.created_at,'source_updated_at',customer.updated_at,
    'source_fingerprint',fingerprint,
    'seu_numero',number_code,'amount',req.amount,'due_date',req.due_date,
    'payer',jsonb_build_object('name',btrim(customer.name),'tax_id',nullif(tax,''),'type','JURIDICA',
      'email',null,'ddd',ddd,'phone',local_phone,'street',nullif(btrim(customer.address_street),''),
      'number',nullif(btrim(customer.address_number),''),'complement',nullif(btrim(customer.address_complement),''),
      'district',nullif(btrim(customer.address_neighborhood),''),'city',nullif(btrim(customer.address_city),''),
      'state',nullif(state,''),'zip',nullif(zip,'')),
    'dispatch_enabled',false);
end $$;

create function apticket_finance_private.confirm_inter_payer(
  p_request uuid,p_source_fingerprint text,p_binding uuid,p_previous_snapshot uuid,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  req apticket.inter_charge_requests; rec apticket.contas_receber; customer apticket.companies;
  review jsonb; snap apticket.inter_payer_snapshots; tax text; phone text; ddd text; local_phone text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  select * into req from apticket.inter_charge_requests where id=p_request
    and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found or not apticket.has_financial_scope(req.tenant_id,req.operating_company_id,true)
    or not exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id
      where ur.user_id=auth.uid() and r.tenant_id=req.tenant_id and r.name in ('Admin','Financeiro')) then
    raise exception using errcode='42501',message='Exige perfil Admin ou Financeiro com acesso de escrita à empresa.';
  end if;
  if p_confirmed is distinct from true or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[0-9a-f]{32}$' or p_binding is null then
    raise exception using errcode='22023',message='Confirme os dados do pagador e o vínculo revisados.';
  end if;
  select * into rec from apticket.contas_receber where id=req.receivable_id and tenant_id=req.tenant_id
    and operating_company_id=req.operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='23514',message='Recebível da solicitação indisponível.'; end if;
  select * into customer from apticket.companies where id=rec.company_id and tenant_id=req.tenant_id for update;
  if not found then raise exception using errcode='23514',message='Cliente da solicitação indisponível.'; end if;
  review:=apticket_finance_private.review_inter_payer(req.id);
  if review->>'state'='missing_data' then raise exception using errcode='23514',message='Complete os dados obrigatórios do pagador antes de confirmar.'; end if;
  if review->>'state'='binding_required' then raise exception using errcode='23514',message='Confirme o vínculo bancário deste ambiente antes do pagador.'; end if;
  if review->>'source_fingerprint'<>p_source_fingerprint or (review->>'binding_id')::uuid<>p_binding then
    raise exception using errcode='40001',message='Dados alterados. Consulte e confirme novamente.';
  end if;
  select * into snap from apticket.inter_payer_snapshots where request_id=req.id and deleted_at is null;
  if snap.id is not null and review->>'state'='confirmed' then
    return jsonb_build_object('id',snap.id,'reused',true,'dispatch_enabled',false);
  end if;
  if snap.id is distinct from p_previous_snapshot then
    raise exception using errcode='40001',message='Snapshot alterado. Consulte e confirme novamente.';
  end if;
  update apticket.inter_payer_snapshots set deleted_at=now() where id=snap.id;
  tax:=regexp_replace(customer.cnpj,'[^0-9]','','g');
  phone:=regexp_replace(coalesce(customer.phone,''),'[^0-9]','','g');
  if length(phone) in (10,11) then ddd:=left(phone,2); local_phone:=substring(phone from 3); end if;
  insert into apticket.inter_payer_snapshots(tenant_id,operating_company_id,request_id,receivable_id,environment,
    customer_company_id,binding_id,seu_numero,amount,due_date,payer_name,payer_tax_id,payer_type,
    payer_ddd,payer_phone,payer_street,payer_number,payer_complement,payer_district,payer_city,payer_state,
    payer_zip,source_fingerprint,source_updated_at,created_by)
  values(req.tenant_id,req.operating_company_id,req.id,req.receivable_id,req.environment,customer.id,p_binding,
    review->>'seu_numero',req.amount,req.due_date,btrim(customer.name),tax,'JURIDICA',ddd,local_phone,
    btrim(customer.address_street),btrim(customer.address_number),nullif(btrim(customer.address_complement),''),
    btrim(customer.address_neighborhood),btrim(customer.address_city),upper(btrim(customer.address_state)),
    regexp_replace(customer.address_zip,'[^0-9]','','g'),p_source_fingerprint,customer.updated_at,auth.uid()) returning * into snap;
  return jsonb_build_object('id',snap.id,'reused',false,'dispatch_enabled',false);
end $$;

revoke all on function apticket_finance_private.review_inter_payer(uuid) from public,anon,authenticated,service_role;
revoke all on function apticket_finance_private.confirm_inter_payer(uuid,text,uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.review_inter_payer(uuid) to authenticated;
grant execute on function apticket_finance_private.confirm_inter_payer(uuid,text,uuid,uuid,boolean) to authenticated;
create function apticket.review_inter_payer(p_request uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.review_inter_payer(p_request);
$$;
create function apticket.confirm_inter_payer(p_request uuid,p_source_fingerprint text,p_binding uuid,p_previous_snapshot uuid,p_confirmed boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.confirm_inter_payer(p_request,p_source_fingerprint,p_binding,p_previous_snapshot,p_confirmed);
$$;
revoke all on function apticket.review_inter_payer(uuid) from public,anon,service_role;
revoke all on function apticket.confirm_inter_payer(uuid,text,uuid,uuid,boolean) from public,anon,service_role;
grant execute on function apticket.review_inter_payer(uuid) to authenticated;
grant execute on function apticket.confirm_inter_payer(uuid,text,uuid,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
