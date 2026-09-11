-- Fatia 21: dados bancarios, programacao, baixa e conciliacao de pagamentos.
create table apticket.supplier_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_id uuid not null,
  label text not null check (length(btrim(label)) between 2 and 80),
  holder_name text not null check (length(btrim(holder_name)) between 2 and 250),
  holder_tax_id text not null check (holder_tax_id ~ '^[0-9]{11}([0-9]{3})?$'),
  bank_code text check (bank_code is null or bank_code ~ '^[0-9]{3}$'),
  bank_name text check (bank_name is null or length(btrim(bank_name)) between 2 and 120),
  branch text check (branch is null or length(btrim(branch)) between 1 and 20),
  account_number text check (account_number is null or length(btrim(account_number)) between 1 and 30),
  account_digit text check (account_digit is null or length(btrim(account_digit)) between 1 and 5),
  account_type text check (account_type is null or account_type in ('checking','savings','payment')),
  pix_key_type text check (pix_key_type is null or pix_key_type in ('cpf','cnpj','email','phone','random')),
  pix_key text check (pix_key is null or length(btrim(pix_key)) between 3 and 150),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique (id,tenant_id,operating_company_id),
  check (
    (bank_code is not null and bank_name is not null and branch is not null
      and account_number is not null and account_type is not null)
    or (pix_key_type is not null and pix_key is not null)
  ),
  check ((pix_key_type is null)=(pix_key is null)),
  foreign key (supplier_id,tenant_id,operating_company_id)
    references apticket.suppliers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index supplier_bank_account_default_key
  on apticket.supplier_bank_accounts(supplier_id)
  where is_default and is_active and deleted_at is null;
create index supplier_bank_account_scope_idx
  on apticket.supplier_bank_accounts(tenant_id,operating_company_id,supplier_id)
  where is_active and deleted_at is null;

create table apticket.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  supplier_id uuid not null,
  supplier_payable_id uuid not null,
  bank_account_id uuid not null,
  status text not null default 'scheduled' check (status in ('scheduled','paid','cancelled')),
  payment_method text not null check (payment_method in ('pix','bank_transfer','boleto','other')),
  scheduled_date date not null,
  scheduled_amount numeric(14,2) not null check (scheduled_amount>0),
  bank_snapshot jsonb not null check (jsonb_typeof(bank_snapshot)='object'),
  scheduling_notes text check (scheduling_notes is null or length(btrim(scheduling_notes)) between 1 and 1000),
  scheduled_by uuid,
  scheduled_by_name text not null,
  scheduled_at timestamptz not null default clock_timestamp(),
  paid_at timestamptz,
  paid_amount numeric(14,2) check (paid_amount is null or paid_amount>0),
  reconciliation_status text not null default 'pending'
    check (reconciliation_status in ('pending','matched','difference')),
  difference_amount numeric(14,2),
  transaction_reference text check (
    transaction_reference is null or length(btrim(transaction_reference)) between 2 and 150),
  settlement_notes text check (settlement_notes is null or length(btrim(settlement_notes)) between 1 and 1000),
  receipt_bucket text,
  receipt_path text,
  receipt_file_name text,
  receipt_mime_type text,
  receipt_size bigint check (receipt_size is null or receipt_size between 1 and 10485760),
  settled_by uuid,
  settled_by_name text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancelled_by_name text,
  cancellation_reason text check (
    cancellation_reason is null or length(btrim(cancellation_reason)) between 3 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (id,tenant_id,operating_company_id),
  foreign key (supplier_id,tenant_id,operating_company_id)
    references apticket.suppliers(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (supplier_payable_id,tenant_id,operating_company_id)
    references apticket.supplier_payables(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (bank_account_id,tenant_id,operating_company_id)
    references apticket.supplier_bank_accounts(id,tenant_id,operating_company_id) on delete restrict,
  foreign key (scheduled_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (settled_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key (cancelled_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check (
    (status='scheduled' and paid_at is null and paid_amount is null and settled_by is null
      and reconciliation_status='pending' and difference_amount is null and cancelled_at is null)
    or (status='paid' and paid_at is not null and paid_amount is not null and settled_by is not null
      and settled_by_name is not null and reconciliation_status in ('matched','difference')
      and difference_amount is not null and receipt_bucket='supplier-payment-receipts'
      and receipt_path is not null and receipt_file_name is not null and receipt_mime_type is not null
      and receipt_size is not null and cancelled_at is null)
    or (status='cancelled' and cancelled_at is not null and cancelled_by is not null
      and cancelled_by_name is not null and cancellation_reason is not null and paid_at is null)
  )
);
create unique index supplier_payment_active_payable_key
  on apticket.supplier_payments(supplier_payable_id)
  where status in ('scheduled','paid');
create index supplier_payment_scope_idx
  on apticket.supplier_payments(tenant_id,operating_company_id,scheduled_date,status);

do $$ declare t text; begin
  foreach t in array array['supplier_bank_accounts','supplier_payments'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy supplier_payment_read on apticket.%I for select to authenticated using
      (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger supplier_payment_no_delete before delete on apticket.%I for each row
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger supplier_payment_no_truncate before truncate on apticket.%I for each statement
      execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger supplier_payment_audit after insert or update on apticket.%I for each row
      execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create function apticket_finance_private.guard_supplier_bank_account()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if row(new.tenant_id,new.operating_company_id,new.supplier_id,new.created_by,new.created_at)
    is distinct from row(old.tenant_id,old.operating_company_id,old.supplier_id,old.created_by,old.created_at) then
    raise exception using errcode='23514',message='O escopo do dado bancario nao pode ser alterado.';
  end if;
  return new;
end $$;
create trigger guard_supplier_bank_account before update on apticket.supplier_bank_accounts
  for each row execute function apticket_finance_private.guard_supplier_bank_account();

create function apticket_finance_private.guard_supplier_payment()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if to_jsonb(new)-array['status','paid_at','paid_amount','reconciliation_status','difference_amount',
      'transaction_reference','settlement_notes','receipt_bucket','receipt_path','receipt_file_name',
      'receipt_mime_type','receipt_size','settled_by','settled_by_name','cancelled_at','cancelled_by',
      'cancelled_by_name','cancellation_reason','updated_at']
    is distinct from
    to_jsonb(old)-array['status','paid_at','paid_amount','reconciliation_status','difference_amount',
      'transaction_reference','settlement_notes','receipt_bucket','receipt_path','receipt_file_name',
      'receipt_mime_type','receipt_size','settled_by','settled_by_name','cancelled_at','cancelled_by',
      'cancelled_by_name','cancellation_reason','updated_at'] then
    raise exception using errcode='23514',message='A programacao do pagamento e imutavel.';
  end if;
  if new.status is distinct from old.status and not
    (old.status='scheduled' and new.status in ('paid','cancelled')) then
    raise exception using errcode='23514',message='A transicao deste pagamento nao e permitida.';
  end if;
  return new;
end $$;
create trigger guard_supplier_payment before update on apticket.supplier_payments
  for each row execute function apticket_finance_private.guard_supplier_payment();

create function apticket.save_supplier_bank_account(
  p_bank_account_id uuid,
  p_supplier_id uuid,
  p_label text,
  p_holder_name text,
  p_holder_tax_id text,
  p_bank_code text,
  p_bank_name text,
  p_branch text,
  p_account_number text,
  p_account_digit text,
  p_account_type text,
  p_pix_key_type text,
  p_pix_key text,
  p_is_default boolean default false
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  s apticket.suppliers;
  v_id uuid;
  v_tax text:=regexp_replace(coalesce(p_holder_tax_id,''),'[^0-9]','','g');
  v_bank_code text:=nullif(regexp_replace(coalesce(p_bank_code,''),'[^0-9]','','g'),'');
begin
  select * into s from apticket.suppliers where id=p_supplier_id and deleted_at is null for update;
  if not found or not s.is_active then
    raise exception using errcode='P0002',message='Fornecedor ativo nao encontrado.';
  end if;
  if auth.uid() is null or not apticket.has_financial_scope(s.tenant_id,s.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para alterar dados bancarios.';
  end if;
  if length(btrim(coalesce(p_label,''))) not between 2 and 80
    or length(btrim(coalesce(p_holder_name,''))) not between 2 and 250
    or v_tax !~ '^[0-9]{11}([0-9]{3})?$' then
    raise exception using errcode='23514',message='Informe identificacao, titular e CPF ou CNPJ validos.';
  end if;
  if p_pix_key_type is not null and p_pix_key_type not in ('cpf','cnpj','email','phone','random') then
    raise exception using errcode='23514',message='O tipo da chave PIX e invalido.';
  end if;
  if (nullif(btrim(coalesce(p_pix_key,'')),'') is null)<>(p_pix_key_type is null) then
    raise exception using errcode='23514',message='Informe o tipo e a chave PIX em conjunto.';
  end if;
  if p_account_type is not null and p_account_type not in ('checking','savings','payment') then
    raise exception using errcode='23514',message='O tipo da conta bancaria e invalido.';
  end if;
  if nullif(btrim(coalesce(p_pix_key,'')),'') is null and
    (v_bank_code is null or length(v_bank_code)<>3 or nullif(btrim(coalesce(p_bank_name,'')),'') is null
      or nullif(btrim(coalesce(p_branch,'')),'') is null
      or nullif(btrim(coalesce(p_account_number,'')),'') is null or p_account_type is null) then
    raise exception using errcode='23514',message='Informe uma chave PIX ou os dados completos da conta bancaria.';
  end if;
  if p_is_default then
    update apticket.supplier_bank_accounts set is_default=false,updated_by=auth.uid(),
      updated_at=clock_timestamp() where supplier_id=s.id and is_default and deleted_at is null;
  end if;
  if p_bank_account_id is null then
    v_id:=gen_random_uuid();
    insert into apticket.supplier_bank_accounts(id,tenant_id,operating_company_id,supplier_id,label,
      holder_name,holder_tax_id,bank_code,bank_name,branch,account_number,account_digit,account_type,
      pix_key_type,pix_key,is_default,created_by,updated_by)
    values(v_id,s.tenant_id,s.operating_company_id,s.id,btrim(p_label),btrim(p_holder_name),v_tax,
      v_bank_code,nullif(btrim(p_bank_name),''),nullif(btrim(p_branch),''),
      nullif(btrim(p_account_number),''),nullif(btrim(p_account_digit),''),p_account_type,
      p_pix_key_type,nullif(btrim(p_pix_key),''),p_is_default,auth.uid(),auth.uid());
  else
    select id into v_id from apticket.supplier_bank_accounts where id=p_bank_account_id
      and supplier_id=s.id and deleted_at is null for update;
    if not found then raise exception using errcode='P0002',message='Dado bancario nao encontrado.'; end if;
    if exists(select 1 from apticket.supplier_payments where bank_account_id=v_id) then
      raise exception using errcode='23514',message='O dado bancario ja foi utilizado e nao pode ser alterado. Cadastre uma nova conta.';
    end if;
    update apticket.supplier_bank_accounts set label=btrim(p_label),holder_name=btrim(p_holder_name),
      holder_tax_id=v_tax,bank_code=v_bank_code,bank_name=nullif(btrim(p_bank_name),''),
      branch=nullif(btrim(p_branch),''),account_number=nullif(btrim(p_account_number),''),
      account_digit=nullif(btrim(p_account_digit),''),account_type=p_account_type,
      pix_key_type=p_pix_key_type,pix_key=nullif(btrim(p_pix_key),''),is_default=p_is_default,
      is_active=true,updated_by=auth.uid(),updated_at=clock_timestamp() where id=v_id;
  end if;
  if not exists(select 1 from apticket.supplier_bank_accounts where supplier_id=s.id
    and is_default and is_active and deleted_at is null) then
    update apticket.supplier_bank_accounts set is_default=true,updated_by=auth.uid(),
      updated_at=clock_timestamp() where id=v_id;
  end if;
  return v_id;
end $$;

create function apticket.archive_supplier_bank_account(p_bank_account_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare a apticket.supplier_bank_accounts; v_next uuid; begin
  select * into a from apticket.supplier_bank_accounts where id=p_bank_account_id
    and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Dado bancario nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(a.tenant_id,a.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para arquivar dados bancarios.';
  end if;
  if exists(select 1 from apticket.supplier_payments where bank_account_id=a.id and status='scheduled') then
    raise exception using errcode='23514',message='Este dado bancario possui pagamento programado.';
  end if;
  update apticket.supplier_bank_accounts set is_default=false,is_active=false,
    deleted_at=clock_timestamp(),updated_by=auth.uid(),updated_at=clock_timestamp() where id=a.id;
  if a.is_default then
    select id into v_next from apticket.supplier_bank_accounts where supplier_id=a.supplier_id
      and is_active and deleted_at is null order by created_at limit 1 for update;
    if found then update apticket.supplier_bank_accounts set is_default=true,updated_by=auth.uid(),
      updated_at=clock_timestamp() where id=v_next; end if;
  end if;
  return true;
end $$;

create function apticket.schedule_supplier_payment(
  p_supplier_payable_id uuid,
  p_bank_account_id uuid,
  p_scheduled_date date,
  p_payment_method text,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; a apticket.supplier_bank_accounts; v_id uuid; v_name text; begin
  select * into p from apticket.supplier_payables where id=p_supplier_payable_id
    and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Lancamento nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para programar pagamentos.';
  end if;
  if p.status<>'approved' then
    raise exception using errcode='23514',message='Somente lancamentos aprovados podem ser programados para pagamento.';
  end if;
  if p_scheduled_date is null then
    raise exception using errcode='23514',message='Informe a data programada para o pagamento.';
  end if;
  if p_payment_method not in ('pix','bank_transfer','boleto','other') then
    raise exception using errcode='23514',message='A forma de pagamento e invalida.';
  end if;
  select * into a from apticket.supplier_bank_accounts where id=p_bank_account_id
    and supplier_id=p.supplier_id and tenant_id=p.tenant_id and operating_company_id=p.operating_company_id
    and is_active and deleted_at is null;
  if not found then
    raise exception using errcode='23514',message='Selecione um dado bancario ativo deste fornecedor.';
  end if;
  select id into v_id from apticket.supplier_payments where supplier_payable_id=p.id
    and status in ('scheduled','paid');
  if found then return v_id; end if;
  select name into v_name from apticket.profiles where id=auth.uid() and tenant_id=p.tenant_id and is_active;
  if v_name is null then raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.'; end if;
  v_id:=gen_random_uuid();
  insert into apticket.supplier_payments(id,tenant_id,operating_company_id,supplier_id,
    supplier_payable_id,bank_account_id,payment_method,scheduled_date,scheduled_amount,
    bank_snapshot,scheduling_notes,scheduled_by,scheduled_by_name)
  values(v_id,p.tenant_id,p.operating_company_id,p.supplier_id,p.id,a.id,p_payment_method,
    p_scheduled_date,p.total_amount,
    jsonb_build_object('label',a.label,'holder_name',a.holder_name,'holder_tax_id',a.holder_tax_id,
      'bank_code',a.bank_code,'bank_name',a.bank_name,'branch',a.branch,
      'account_number',a.account_number,'account_digit',a.account_digit,
      'account_type',a.account_type,'pix_key_type',a.pix_key_type,'pix_key',a.pix_key),
    nullif(btrim(p_notes),''),auth.uid(),v_name);
  return v_id;
end $$;

create function apticket.settle_supplier_payment(
  p_payment_id uuid,
  p_paid_at timestamptz,
  p_paid_amount numeric,
  p_transaction_reference text,
  p_receipt_path text,
  p_receipt_file_name text,
  p_receipt_mime_type text,
  p_receipt_size bigint,
  p_notes text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare pay apticket.supplier_payments; p apticket.supplier_payables; v_name text; v_difference numeric(14,2); begin
  select * into pay from apticket.supplier_payments where id=p_payment_id for update;
  if not found then raise exception using errcode='P0002',message='Pagamento programado nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(pay.tenant_id,pay.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para baixar pagamentos.';
  end if;
  if pay.status<>'scheduled' then
    raise exception using errcode='23514',message='Somente pagamentos programados podem receber baixa.';
  end if;
  if p_paid_at is null or p_paid_at>clock_timestamp()+interval '5 minutes' or p_paid_amount is null or p_paid_amount<=0 then
    raise exception using errcode='23514',message='Informe uma data e um valor pago validos.';
  end if;
  if length(btrim(coalesce(p_transaction_reference,''))) not between 2 and 150 then
    raise exception using errcode='23514',message='Informe a referencia da transacao.';
  end if;
  if p_receipt_size is null or p_receipt_size not between 1 and 10485760
    or p_receipt_mime_type not in ('application/pdf','image/png','image/jpeg','image/webp')
    or p_receipt_path is null
    or p_receipt_path not like pay.tenant_id::text||'/'||pay.operating_company_id::text||'/'||pay.id::text||'/%'
    or length(btrim(coalesce(p_receipt_file_name,''))) not between 1 and 255
    or not exists(select 1 from storage.objects o where o.bucket_id='supplier-payment-receipts'
      and o.name=p_receipt_path) then
    raise exception using errcode='23514',message='Envie um comprovante valido de ate 10 MB antes de confirmar a baixa.';
  end if;
  select * into p from apticket.supplier_payables where id=pay.supplier_payable_id for update;
  if not found or p.status<>'approved' then
    raise exception using errcode='23514',message='O lancamento deve permanecer aprovado ate a baixa.';
  end if;
  select name into v_name from apticket.profiles where id=auth.uid() and tenant_id=pay.tenant_id and is_active;
  if v_name is null then raise exception using errcode='42501',message='Usuario responsavel nao esta ativo.'; end if;
  v_difference:=round(p_paid_amount-pay.scheduled_amount,2);
  update apticket.supplier_payments set status='paid',paid_at=p_paid_at,paid_amount=p_paid_amount,
    reconciliation_status=case when v_difference=0 then 'matched' else 'difference' end,
    difference_amount=v_difference,transaction_reference=btrim(p_transaction_reference),
    settlement_notes=nullif(btrim(p_notes),''),receipt_bucket='supplier-payment-receipts',
    receipt_path=p_receipt_path,receipt_file_name=btrim(p_receipt_file_name),
    receipt_mime_type=p_receipt_mime_type,receipt_size=p_receipt_size,
    settled_by=auth.uid(),settled_by_name=v_name,updated_at=clock_timestamp() where id=pay.id;
  update apticket.supplier_payables set status='paid' where id=p.id;
  return true;
end $$;

create function apticket.cancel_supplier_payment(p_payment_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare pay apticket.supplier_payments; v_name text; begin
  select * into pay from apticket.supplier_payments where id=p_payment_id for update;
  if not found then raise exception using errcode='P0002',message='Pagamento programado nao encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(pay.tenant_id,pay.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissao financeira para cancelar pagamentos.';
  end if;
  if pay.status<>'scheduled' then
    raise exception using errcode='23514',message='Somente pagamentos programados podem ser cancelados.';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception using errcode='23514',message='Informe o motivo do cancelamento.';
  end if;
  select name into v_name from apticket.profiles where id=auth.uid() and tenant_id=pay.tenant_id and is_active;
  update apticket.supplier_payments set status='cancelled',cancelled_at=clock_timestamp(),
    cancelled_by=auth.uid(),cancelled_by_name=v_name,cancellation_reason=btrim(p_reason),
    updated_at=clock_timestamp() where id=pay.id;
  return true;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('supplier-payment-receipts','supplier-payment-receipts',false,10485760,
  array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy supplier_payment_receipt_read on storage.objects for select to authenticated using (
  bucket_id='supplier-payment-receipts' and exists(
    select 1 from apticket.supplier_payments pay
    where pay.id::text=(storage.foldername(name))[3]
      and pay.tenant_id::text=(storage.foldername(name))[1]
      and pay.operating_company_id::text=(storage.foldername(name))[2]
      and apticket.has_financial_scope(pay.tenant_id,pay.operating_company_id)));
create policy supplier_payment_receipt_insert on storage.objects for insert to authenticated with check (
  bucket_id='supplier-payment-receipts' and exists(
    select 1 from apticket.supplier_payments pay
    where pay.id::text=(storage.foldername(name))[3] and pay.status='scheduled'
      and pay.tenant_id::text=(storage.foldername(name))[1]
      and pay.operating_company_id::text=(storage.foldername(name))[2]
      and apticket.has_financial_scope(pay.tenant_id,pay.operating_company_id,true)));
create policy supplier_payment_receipt_delete on storage.objects for delete to authenticated using (
  bucket_id='supplier-payment-receipts' and exists(
    select 1 from apticket.supplier_payments pay
    where pay.id::text=(storage.foldername(name))[3] and pay.status='scheduled'
      and pay.tenant_id::text=(storage.foldername(name))[1]
      and pay.operating_company_id::text=(storage.foldername(name))[2]
      and apticket.has_financial_scope(pay.tenant_id,pay.operating_company_id,true)));

revoke all on function apticket.save_supplier_bank_account(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean),
  apticket.archive_supplier_bank_account(uuid),apticket.schedule_supplier_payment(uuid,uuid,date,text,text),
  apticket.settle_supplier_payment(uuid,timestamptz,numeric,text,text,text,text,bigint,text),
  apticket.cancel_supplier_payment(uuid,text) from public,anon;
grant execute on function apticket.save_supplier_bank_account(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,boolean),
  apticket.archive_supplier_bank_account(uuid),apticket.schedule_supplier_payment(uuid,uuid,date,text,text),
  apticket.settle_supplier_payment(uuid,timestamptz,numeric,text,text,text,text,bigint,text),
  apticket.cancel_supplier_payment(uuid,text) to authenticated;
revoke all on function apticket_finance_private.guard_supplier_bank_account(),
  apticket_finance_private.guard_supplier_payment() from public,anon,authenticated,service_role;

comment on table apticket.supplier_bank_accounts is 'Dados bancarios versionaveis dos fornecedores por empresa operadora.';
comment on table apticket.supplier_payments is 'Programacao e baixa auditavel dos pagamentos de fornecedores.';
notify pgrst,'reload schema';
