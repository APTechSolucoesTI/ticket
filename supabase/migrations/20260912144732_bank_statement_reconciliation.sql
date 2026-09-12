-- Fatia 29: contas bancarias operacionais, OFX e fila de conciliacao.
create table apticket.operating_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  name text not null check(length(btrim(name)) between 2 and 100),
  bank_code text check(bank_code is null or bank_code ~ '^[0-9]{3}$'),
  bank_name text not null check(length(btrim(bank_name)) between 2 and 120),
  branch text check(branch is null or length(btrim(branch)) between 1 and 20),
  account_number text not null check(length(btrim(account_number)) between 1 and 30),
  account_type text not null check(account_type in ('checking','savings','payment')),
  currency_code text not null default 'BRL' check(currency_code='BRL'),
  opening_balance numeric(14,2) not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  foreign key(operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  foreign key(updated_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
create unique index operating_bank_account_identity_key
  on apticket.operating_bank_accounts(
    tenant_id,operating_company_id,coalesce(bank_code,''),coalesce(branch,''),account_number
  ) where deleted_at is null;
create unique index operating_bank_account_default_key
  on apticket.operating_bank_accounts(tenant_id,operating_company_id)
  where is_default and is_active and deleted_at is null;

create table apticket.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  bank_account_id uuid not null,
  source_type text not null check(source_type in ('ofx','bank_api')),
  original_file_name text,
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
  period_start date not null,
  period_end date not null check(period_end>=period_start),
  status text not null check(status in ('processed','needs_review')),
  transaction_count integer not null check(transaction_count between 1 and 5000),
  auto_matched_count integer not null default 0 check(auto_matched_count>=0),
  review_count integer not null default 0 check(review_count>=0),
  imported_by uuid,
  imported_by_name text not null,
  imported_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  unique(bank_account_id,file_hash),
  foreign key(bank_account_id,tenant_id,operating_company_id)
    references apticket.operating_bank_accounts(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(imported_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check(auto_matched_count+review_count<=transaction_count)
);
create index bank_statement_import_scope_idx
  on apticket.bank_statement_imports(tenant_id,operating_company_id,imported_at desc);

create table apticket.bank_statement_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  tenant_id uuid not null,
  operating_company_id uuid not null,
  bank_account_id uuid not null,
  fit_id text not null check(length(btrim(fit_id)) between 1 and 150),
  posted_at date not null,
  amount numeric(14,2) not null check(amount<>0),
  transaction_type text,
  document_number text,
  memo text not null check(length(btrim(memo)) between 1 and 500),
  reconciliation_status text not null default 'pending_review'
    check(reconciliation_status in ('pending_review','matched_auto','matched_manual','ignored')),
  match_source_type text check(match_source_type is null or match_source_type in
    ('measurement_receivable','recurring_receivable','supplier_payment')),
  match_source_id uuid,
  match_document_number text,
  match_counterparty_name text,
  matched_amount numeric(14,2),
  difference_amount numeric(14,2),
  confidence_percent numeric(5,2) check(confidence_percent is null or confidence_percent between 0 and 100),
  reconciled_by uuid,
  reconciled_by_name text,
  reconciled_at timestamptz,
  resolution_notes text check(resolution_notes is null or length(btrim(resolution_notes)) between 3 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(id,tenant_id,operating_company_id),
  unique(bank_account_id,fit_id),
  foreign key(import_id,tenant_id,operating_company_id)
    references apticket.bank_statement_imports(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(bank_account_id,tenant_id,operating_company_id)
    references apticket.operating_bank_accounts(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(reconciled_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict,
  check(
    (reconciliation_status='pending_review' and match_source_type is null and match_source_id is null
      and reconciled_at is null)
    or (reconciliation_status in ('matched_auto','matched_manual') and match_source_type is not null
      and match_source_id is not null and matched_amount is not null and difference_amount is not null
      and reconciled_at is not null)
    or (reconciliation_status='ignored' and match_source_type is null and match_source_id is null
      and reconciled_at is not null and resolution_notes is not null)
  )
);
create index bank_statement_transaction_queue_idx
  on apticket.bank_statement_transactions(
    tenant_id,operating_company_id,bank_account_id,reconciliation_status,posted_at desc
  ) where deleted_at is null;
create unique index bank_statement_source_match_key
  on apticket.bank_statement_transactions(tenant_id,operating_company_id,match_source_type,match_source_id)
  where reconciliation_status in ('matched_auto','matched_manual') and deleted_at is null;

do $$ declare t text; begin
  foreach t in array array['operating_bank_accounts','bank_statement_imports','bank_statement_transactions'] loop
    execute format('alter table apticket.%I enable row level security',t);
    execute format('revoke all on apticket.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on apticket.%I to authenticated,service_role',t);
    execute format('create policy bank_reconciliation_read on apticket.%I for select to authenticated
      using (apticket.has_financial_scope(tenant_id,operating_company_id))',t);
    execute format('create trigger bank_reconciliation_no_delete before delete on apticket.%I
      for each row execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger bank_reconciliation_no_truncate before truncate on apticket.%I
      for each statement execute function apticket_finance_private.guard_record()',t);
    execute format('create trigger bank_reconciliation_audit after insert or update on apticket.%I
      for each row execute function apticket_finance_private.audit_record()',t);
  end loop;
end $$;

create function apticket_finance_private.guard_operating_bank_account()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if row(new.tenant_id,new.operating_company_id,new.created_by,new.created_at)
    is distinct from row(old.tenant_id,old.operating_company_id,old.created_by,old.created_at) then
    raise exception using errcode='23514',message='O escopo da conta bancária não pode ser alterado.';
  end if;
  return new;
end $$;
create trigger guard_operating_bank_account before update on apticket.operating_bank_accounts
  for each row execute function apticket_finance_private.guard_operating_bank_account();

create function apticket_finance_private.guard_statement_import()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-array['status','auto_matched_count','review_count','processed_at','deleted_at'])
    is distinct from
    (to_jsonb(old)-array['status','auto_matched_count','review_count','processed_at','deleted_at']) then
    raise exception using errcode='23514',message='Os dados originais da importação são imutáveis.';
  end if;
  return new;
end $$;
create trigger guard_statement_import before update on apticket.bank_statement_imports
  for each row execute function apticket_finance_private.guard_statement_import();

create function apticket_finance_private.guard_statement_transaction()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if (to_jsonb(new)-array['reconciliation_status','match_source_type','match_source_id',
      'match_document_number','match_counterparty_name','matched_amount','difference_amount',
      'confidence_percent','reconciled_by','reconciled_by_name','reconciled_at','resolution_notes',
      'updated_at','deleted_at']) is distinct from
    (to_jsonb(old)-array['reconciliation_status','match_source_type','match_source_id',
      'match_document_number','match_counterparty_name','matched_amount','difference_amount',
      'confidence_percent','reconciled_by','reconciled_by_name','reconciled_at','resolution_notes',
      'updated_at','deleted_at']) then
    raise exception using errcode='23514',message='Os dados originais do movimento bancário são imutáveis.';
  end if;
  return new;
end $$;
create trigger guard_statement_transaction before update on apticket.bank_statement_transactions
  for each row execute function apticket_finance_private.guard_statement_transaction();

create function apticket_finance_private.refresh_statement_import(p_import_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare v_review integer; v_matched integer; begin
  select count(*) filter(where reconciliation_status='pending_review'),
    count(*) filter(where reconciliation_status in ('matched_auto','matched_manual'))
    into v_review,v_matched
  from apticket.bank_statement_transactions where import_id=p_import_id and deleted_at is null;
  update apticket.bank_statement_imports set review_count=v_review,auto_matched_count=v_matched,
    status=case when v_review=0 then 'processed' else 'needs_review' end,
    processed_at=clock_timestamp() where id=p_import_id;
end $$;

create function apticket.save_operating_bank_account(
  p_id uuid,p_operating_company_id uuid,p_name text,p_bank_code text,p_bank_name text,
  p_branch text,p_account_number text,p_account_type text,p_opening_balance numeric,
  p_is_default boolean
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare v_tenant uuid; v_actor uuid:=auth.uid(); v_id uuid:=coalesce(p_id,gen_random_uuid()); begin
  select tenant_id into v_tenant from apticket.operating_companies
    where id=p_operating_company_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Empresa operadora não encontrada.'; end if;
  if v_actor is null or not apticket.has_financial_scope(v_tenant,p_operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão para configurar contas bancárias.';
  end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 100
    or length(btrim(coalesce(p_bank_name,''))) not between 2 and 120
    or length(btrim(coalesce(p_account_number,''))) not between 1 and 30
    or p_account_type not in ('checking','savings','payment') then
    raise exception using errcode='23514',message='Informe corretamente os dados da conta bancária.';
  end if;
  if p_bank_code is not null and btrim(p_bank_code)!~'^[0-9]{3}$' then
    raise exception using errcode='23514',message='O código do banco deve possuir três dígitos.';
  end if;
  if p_is_default then
    update apticket.operating_bank_accounts set is_default=false,updated_by=v_actor,
      updated_at=clock_timestamp() where tenant_id=v_tenant
      and operating_company_id=p_operating_company_id and is_default;
  end if;
  if p_id is null then
    insert into apticket.operating_bank_accounts(id,tenant_id,operating_company_id,name,bank_code,
      bank_name,branch,account_number,account_type,opening_balance,is_default,created_by,updated_by)
    values(v_id,v_tenant,p_operating_company_id,btrim(p_name),nullif(btrim(p_bank_code),''),
      btrim(p_bank_name),nullif(btrim(p_branch),''),btrim(p_account_number),p_account_type,
      round(coalesce(p_opening_balance,0),2),coalesce(p_is_default,false),v_actor,v_actor);
  else
    if exists(select 1 from apticket.bank_statement_imports where bank_account_id=p_id) then
      raise exception using errcode='23514',message='Conta com extrato importado não pode ser reescrita. Cadastre uma nova conta.';
    end if;
    update apticket.operating_bank_accounts set name=btrim(p_name),
      bank_code=nullif(btrim(p_bank_code),''),bank_name=btrim(p_bank_name),
      branch=nullif(btrim(p_branch),''),account_number=btrim(p_account_number),
      account_type=p_account_type,opening_balance=round(coalesce(p_opening_balance,0),2),
      is_default=coalesce(p_is_default,false),is_active=true,updated_by=v_actor,
      updated_at=clock_timestamp() where id=p_id and tenant_id=v_tenant
      and operating_company_id=p_operating_company_id and deleted_at is null;
    if not found then raise exception using errcode='P0002',message='Conta bancária não encontrada.'; end if;
  end if;
  if not exists(select 1 from apticket.operating_bank_accounts where tenant_id=v_tenant
    and operating_company_id=p_operating_company_id and is_default and deleted_at is null) then
    update apticket.operating_bank_accounts set is_default=true,updated_by=v_actor,
      updated_at=clock_timestamp() where id=v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception using errcode='23505',message='Esta conta bancária já está cadastrada.';
end $$;

create function apticket.import_bank_statement(
  p_bank_account_id uuid,p_source_type text,p_file_name text,p_file_hash text,
  p_period_start date,p_period_end date,p_transactions jsonb
) returns uuid language plpgsql security definer set search_path=pg_catalog as $$
declare
  account apticket.operating_bank_accounts; v_actor_name text; v_import uuid; item record;
  v_count integer; v_candidate_count integer; v_source_type text; v_source_id uuid;
  v_document text; v_counterparty text; v_source_amount numeric(14,2);
begin
  select * into account from apticket.operating_bank_accounts where id=p_bank_account_id
    and is_active and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Conta bancária não encontrada.'; end if;
  if auth.uid() is null
    or not apticket.has_financial_scope(account.tenant_id,account.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão para importar extratos nesta conta.';
  end if;
  if p_source_type not in ('ofx','bank_api') then
    raise exception using errcode='23514',message='Origem do extrato inválida.';
  end if;
  if p_file_hash!~'^[a-f0-9]{64}$' or p_period_start is null or p_period_end<p_period_start
    or jsonb_typeof(p_transactions)<>'array' then
    raise exception using errcode='23514',message='Arquivo ou período do extrato inválido.';
  end if;
  v_count:=jsonb_array_length(p_transactions);
  if v_count not between 1 and 5000 then
    raise exception using errcode='23514',message='O extrato deve conter entre 1 e 5000 movimentos.';
  end if;
  select id into v_import from apticket.bank_statement_imports
    where bank_account_id=p_bank_account_id and file_hash=p_file_hash;
  if found then return v_import; end if;
  select name into v_actor_name from apticket.profiles where id=auth.uid()
    and tenant_id=account.tenant_id and is_active;
  if v_actor_name is null then raise exception using errcode='42501',message='Usuário responsável não está ativo.'; end if;
  v_import:=gen_random_uuid();
  insert into apticket.bank_statement_imports(id,tenant_id,operating_company_id,bank_account_id,
    source_type,original_file_name,file_hash,period_start,period_end,status,transaction_count,
    imported_by,imported_by_name)
  values(v_import,account.tenant_id,account.operating_company_id,account.id,p_source_type,
    left(nullif(btrim(p_file_name),''),255),p_file_hash,p_period_start,p_period_end,'needs_review',
    v_count,auth.uid(),v_actor_name);
  for item in select * from jsonb_to_recordset(p_transactions) as parsed(
    fit_id text,posted_at date,amount numeric,transaction_type text,document_number text,memo text
  ) loop
    if length(btrim(coalesce(item.fit_id,''))) not between 1 and 150 or item.posted_at is null
      or item.amount is null or item.amount=0 or length(btrim(coalesce(item.memo,''))) not between 1 and 500 then
      raise exception using errcode='23514',message='O extrato contém um movimento inválido.';
    end if;
    v_candidate_count:=0; v_source_type:=null; v_source_id:=null;
    v_document:=null; v_counterparty:=null; v_source_amount:=null;
    if item.amount>0 then
      select count(*),min(case when receivable.medicao_id is not null then 'measurement_receivable'
        else 'recurring_receivable' end),min(receivable.id::text)::uuid,min(receivable.documento_referencia),
        min(receivable.cliente_nome),min(receivable.valor_aberto)
      into v_candidate_count,v_source_type,v_source_id,v_document,v_counterparty,v_source_amount
      from apticket.contas_receber receivable
      where receivable.tenant_id=account.tenant_id
        and receivable.operating_company_id=account.operating_company_id
        and receivable.deleted_at is null and receivable.valor_aberto>0
        and receivable.valor_aberto=round(item.amount,2)
        and receivable.vencimento_em between item.posted_at-7 and item.posted_at+7
        and not exists(select 1 from apticket.bank_statement_transactions previous
          where previous.tenant_id=account.tenant_id
            and previous.operating_company_id=account.operating_company_id
            and previous.match_source_id=receivable.id
            and previous.reconciliation_status in ('matched_auto','matched_manual')
            and previous.deleted_at is null);
    else
      select count(*),'supplier_payment',min(payment.id::text)::uuid,min(payable.document_number),
        min(coalesce(payable.terms_snapshot->>'supplier_name','Fornecedor')),min(payment.scheduled_amount)
      into v_candidate_count,v_source_type,v_source_id,v_document,v_counterparty,v_source_amount
      from apticket.supplier_payments payment join apticket.supplier_payables payable
        on payable.id=payment.supplier_payable_id
      where payment.tenant_id=account.tenant_id
        and payment.operating_company_id=account.operating_company_id
        and payment.status='scheduled' and payment.scheduled_amount=round(abs(item.amount),2)
        and payment.scheduled_date between item.posted_at-7 and item.posted_at+7
        and not exists(select 1 from apticket.bank_statement_transactions previous
          where previous.tenant_id=account.tenant_id
            and previous.operating_company_id=account.operating_company_id
            and previous.match_source_id=payment.id
            and previous.reconciliation_status in ('matched_auto','matched_manual')
            and previous.deleted_at is null);
    end if;
    insert into apticket.bank_statement_transactions(import_id,tenant_id,operating_company_id,
      bank_account_id,fit_id,posted_at,amount,transaction_type,document_number,memo,
      reconciliation_status,match_source_type,match_source_id,match_document_number,
      match_counterparty_name,matched_amount,difference_amount,confidence_percent,reconciled_at)
    values(v_import,account.tenant_id,account.operating_company_id,account.id,btrim(item.fit_id),
      item.posted_at,round(item.amount,2),left(nullif(btrim(item.transaction_type),''),30),
      left(nullif(btrim(item.document_number),''),100),btrim(item.memo),
      case when v_candidate_count=1 then 'matched_auto' else 'pending_review' end,
      case when v_candidate_count=1 then v_source_type end,
      case when v_candidate_count=1 then v_source_id end,
      case when v_candidate_count=1 then v_document end,
      case when v_candidate_count=1 then v_counterparty end,
      case when v_candidate_count=1 then v_source_amount end,
      case when v_candidate_count=1 then abs(item.amount)-v_source_amount end,
      case when v_candidate_count=1 then 100 end,
      case when v_candidate_count=1 then clock_timestamp() end);
  end loop;
  perform apticket_finance_private.refresh_statement_import(v_import);
  return v_import;
exception when unique_violation then
  raise exception using errcode='23505',message='Este extrato ou movimento bancário já foi importado.';
end $$;

create function apticket.reconcile_bank_transaction(
  p_transaction_id uuid,p_source_type text,p_source_id uuid,p_notes text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare tx apticket.bank_statement_transactions; v_amount numeric(14,2); v_document text;
  v_counterparty text; v_actual_type text; v_name text; begin
  select * into tx from apticket.bank_statement_transactions where id=p_transaction_id
    and reconciliation_status='pending_review' and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Movimento pendente não encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(tx.tenant_id,tx.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão para conciliar este movimento.';
  end if;
  if tx.amount>0 and p_source_type in ('measurement_receivable','recurring_receivable') then
    select receivable.valor_aberto,receivable.documento_referencia,receivable.cliente_nome,
      case when receivable.medicao_id is not null then 'measurement_receivable' else 'recurring_receivable' end
      into v_amount,v_document,v_counterparty,v_actual_type
    from apticket.contas_receber receivable where receivable.id=p_source_id
      and receivable.tenant_id=tx.tenant_id and receivable.operating_company_id=tx.operating_company_id
      and receivable.deleted_at is null and receivable.valor_aberto>0;
  elsif tx.amount<0 and p_source_type='supplier_payment' then
    select payment.scheduled_amount,payable.document_number,
      coalesce(payable.terms_snapshot->>'supplier_name','Fornecedor'),'supplier_payment'
      into v_amount,v_document,v_counterparty,v_actual_type
    from apticket.supplier_payments payment join apticket.supplier_payables payable
      on payable.id=payment.supplier_payable_id
    where payment.id=p_source_id and payment.tenant_id=tx.tenant_id
      and payment.operating_company_id=tx.operating_company_id and payment.status='scheduled';
  else raise exception using errcode='23514',message='A natureza do lançamento não corresponde ao movimento bancário.';
  end if;
  if v_amount is null or v_actual_type<>p_source_type then
    raise exception using errcode='P0002',message='Lançamento financeiro disponível não encontrado.';
  end if;
  if exists(select 1 from apticket.bank_statement_transactions previous
    where previous.tenant_id=tx.tenant_id and previous.operating_company_id=tx.operating_company_id
      and previous.match_source_type=p_source_type and previous.match_source_id=p_source_id
      and previous.reconciliation_status in ('matched_auto','matched_manual')
      and previous.deleted_at is null) then
    raise exception using errcode='23505',message='Este lançamento já está conciliado com outro movimento.';
  end if;
  select name into v_name from apticket.profiles where id=auth.uid()
    and tenant_id=tx.tenant_id and is_active;
  update apticket.bank_statement_transactions set reconciliation_status='matched_manual',
    match_source_type=p_source_type,match_source_id=p_source_id,match_document_number=v_document,
    match_counterparty_name=v_counterparty,matched_amount=v_amount,
    difference_amount=abs(tx.amount)-v_amount,confidence_percent=null,reconciled_by=auth.uid(),
    reconciled_by_name=v_name,reconciled_at=clock_timestamp(),
    resolution_notes=nullif(btrim(p_notes),''),updated_at=clock_timestamp() where id=tx.id;
  perform apticket_finance_private.refresh_statement_import(tx.import_id);
  return true;
end $$;

create function apticket.ignore_bank_transaction(p_transaction_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare tx apticket.bank_statement_transactions; v_name text; begin
  select * into tx from apticket.bank_statement_transactions where id=p_transaction_id
    and reconciliation_status='pending_review' and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Movimento pendente não encontrado.'; end if;
  if auth.uid() is null or not apticket.has_financial_scope(tx.tenant_id,tx.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem permissão para ignorar este movimento.';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception using errcode='23514',message='Informe uma justificativa para ignorar o movimento.';
  end if;
  select name into v_name from apticket.profiles where id=auth.uid()
    and tenant_id=tx.tenant_id and is_active;
  update apticket.bank_statement_transactions set reconciliation_status='ignored',
    reconciled_by=auth.uid(),reconciled_by_name=v_name,reconciled_at=clock_timestamp(),
    resolution_notes=btrim(p_reason),updated_at=clock_timestamp() where id=tx.id;
  perform apticket_finance_private.refresh_statement_import(tx.import_id);
  return true;
end $$;

revoke all on function apticket.save_operating_bank_account(uuid,uuid,text,text,text,text,text,text,numeric,boolean),
  apticket.import_bank_statement(uuid,text,text,text,date,date,jsonb),
  apticket.reconcile_bank_transaction(uuid,text,uuid,text),
  apticket.ignore_bank_transaction(uuid,text) from public,anon;
grant execute on function apticket.save_operating_bank_account(uuid,uuid,text,text,text,text,text,text,numeric,boolean),
  apticket.import_bank_statement(uuid,text,text,text,date,date,jsonb),
  apticket.reconcile_bank_transaction(uuid,text,uuid,text),
  apticket.ignore_bank_transaction(uuid,text) to authenticated;
revoke all on function apticket_finance_private.guard_operating_bank_account(),
  apticket_finance_private.guard_statement_import(),
  apticket_finance_private.guard_statement_transaction(),
  apticket_finance_private.refresh_statement_import(uuid) from public,anon,authenticated,service_role;

comment on table apticket.operating_bank_accounts is 'Contas bancárias próprias das empresas operadoras.';
comment on table apticket.bank_statement_imports is 'Lotes idempotentes de extratos OFX ou API bancária.';
comment on table apticket.bank_statement_transactions is 'Movimentos bancários e sua conciliação com contas a receber ou pagar.';
notify pgrst,'reload schema';
