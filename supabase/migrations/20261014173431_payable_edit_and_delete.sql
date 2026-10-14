-- Alteração e exclusão lógica com revisão concorrente e auditoria existente.
alter table apticket.supplier_payables
  add column revision integer not null default 0 check (revision>=0),
  add column updated_at timestamptz,
  add column updated_by uuid references apticket.profiles(id) on delete restrict,
  add column last_change_reason text check (last_change_reason is null or length(btrim(last_change_reason)) between 3 and 1000);
alter table apticket.supplier_payables alter column updated_at set default clock_timestamp();

alter table apticket.supplier_payable_approval_requests
  drop constraint supplier_payable_approval_requests_status_check,
  add constraint supplier_payable_approval_requests_status_check check (status in ('pending','approved','rejected','cancelled')),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references apticket.profiles(id) on delete restrict,
  add column cancellation_reason text check (cancellation_reason is null or length(btrim(cancellation_reason)) between 3 and 1000);
alter table apticket.supplier_payable_approval_steps
  drop constraint supplier_payable_approval_steps_status_check,
  add constraint supplier_payable_approval_steps_status_check check (status in ('pending','approved','rejected','cancelled'));

-- O ciclo excluído pode ser gerado novamente, mantendo o registro antigo no histórico.
alter table apticket.supplier_payables drop constraint supplier_payables_supplier_contract_id_cycle_start_key;
create unique index supplier_payables_active_contract_cycle_key
  on apticket.supplier_payables(supplier_contract_id,cycle_start) where deleted_at is null;

create or replace function apticket_finance_private.guard_supplier_payable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare v_context text:=current_setting('apticket.payable_mutation',true); v_generated text[];
begin
  -- Colunas geradas ainda estão nulas no NEW de um BEFORE UPDATE.
  select coalesce(array_agg(attname::text),'{}'::text[]) into v_generated from pg_attribute
    where attrelid=tg_relid and attgenerated<>'' and not attisdropped;
  if tg_table_name='supplier_payable_allocations' then
    if v_context=new.supplier_payable_id::text and old.deleted_at is null and new.deleted_at is not null
      and to_jsonb(new)-v_generated-'deleted_at'=to_jsonb(old)-v_generated-'deleted_at' then return new; end if;
    raise exception using errcode='23514',message='O rateio gerado é imutável.';
  end if;
  new.revision:=old.revision+1;
  new.updated_at:=clock_timestamp();
  new.updated_by:=coalesce(auth.uid(),old.updated_by);
  if v_context=old.id::text then
    if old.deleted_at is not null or old.status='paid'
      or (to_jsonb(new)-v_generated-array['document_number','description','cycle_start','cycle_end','due_date',
        'unit_price','total_amount','status','deleted_at','revision','updated_at','updated_by','last_change_reason'])
        is distinct from
        (to_jsonb(old)-v_generated-array['document_number','description','cycle_start','cycle_end','due_date',
        'unit_price','total_amount','status','deleted_at','revision','updated_at','updated_by','last_change_reason']) then
      raise exception using errcode='23514',message='A alteração financeira solicitada não é permitida.';
    end if;
    return new;
  end if;
  if new.allocation_status is distinct from old.allocation_status then
    if old.allocation_status='pending_rule' and new.allocation_status='complete' then return new; end if;
    raise exception using errcode='23514',message='A situacao do rateio nao pode retroceder.';
  end if;
  if new.status is distinct from old.status then
    if (old.status='scheduled' and new.status='awaiting_approval' and new.allocation_status='complete')
      or (old.status='awaiting_approval' and new.status in ('approved','scheduled'))
      or (old.status='scheduled' and new.status='approved' and new.allocation_status='complete'
        and not apticket_finance_private.financial_feature_enabled(new.tenant_id,'payable_approvals'))
      or (old.status='approved' and new.status='paid') then return new; end if;
    raise exception using errcode='23514',message='A transicao financeira deste lancamento nao e permitida.';
  end if;
  if new.deleted_at is distinct from old.deleted_at then return new; end if;
  raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
end $$;
revoke all on function apticket_finance_private.guard_supplier_payable() from public,anon,authenticated,service_role;

create function apticket_finance_private.prepare_payable_mutation(p_id uuid,p_expected_revision integer)
returns apticket.supplier_payables language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; v_tenant uuid:=apticket.current_tenant_id();
begin
  if auth.uid() is null or v_tenant is null
    or not apticket.has_permission(auth.uid(),'financeiro_contas_pagar','edit')
    or not exists(select 1 from apticket.profiles where id=auth.uid() and tenant_id=v_tenant and is_active) then
    raise exception using errcode='42501',message='Sem permissão para alterar ou excluir contas a pagar.';
  end if;
  select * into p from apticket.supplier_payables where id=p_id and tenant_id=v_tenant and deleted_at is null;
  if not found then raise exception using errcode='P0002',message='Lançamento não encontrado.'; end if;
  if not apticket.has_financial_scope(p.tenant_id,p.operating_company_id,true) then
    raise exception using errcode='42501',message='Sem acesso financeiro de escrita nesta empresa.';
  end if;
  -- Mesma ordem usada pelas decisões de aprovação: solicitação, depois lançamento.
  perform 1 from apticket.supplier_payable_approval_requests where supplier_payable_id=p_id
    and status in ('pending','approved') order by id for update;
  select * into p from apticket.supplier_payables where id=p_id for update;
  if p_expected_revision is null or p.revision<>p_expected_revision then
    raise exception using errcode='40001',message='Este lançamento foi atualizado por outra operação. Reabra a tela antes de continuar.';
  end if;
  if p.deleted_at is not null or p.status in ('paid','cancelled') then
    raise exception using errcode='P0001',message='Lançamentos pagos, cancelados ou excluídos não podem ser alterados ou excluídos.';
  end if;
  if exists(select 1 from apticket.supplier_payments where supplier_payable_id=p.id and status in ('scheduled','paid')) then
    raise exception using errcode='P0001',message='Cancele a programação do pagamento antes de alterar ou excluir este lançamento.';
  end if;
  return p;
end $$;
revoke all on function apticket_finance_private.prepare_payable_mutation(uuid,integer) from public,anon,authenticated,service_role;

create function apticket_finance_private.cancel_payable_approvals(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  update apticket.supplier_payable_approval_steps set status='cancelled',decided_at=clock_timestamp(),
    decision_comment=left(p_reason,1000)
    where status='pending' and request_id in
      (select id from apticket.supplier_payable_approval_requests where supplier_payable_id=p_id and status='pending');
  update apticket.supplier_payable_approval_requests set status='cancelled',cancelled_at=clock_timestamp(),
    cancelled_by=auth.uid(),cancellation_reason=left(p_reason,1000),completed_at=coalesce(completed_at,clock_timestamp())
    where supplier_payable_id=p_id and status in ('pending','approved');
end $$;
revoke all on function apticket_finance_private.cancel_payable_approvals(uuid,text) from public,anon,authenticated,service_role;

create function apticket.update_supplier_payable(
  p_id uuid,p_expected_revision integer,p_document_number text,p_description text,
  p_competence date,p_due_date date,p_total_amount numeric,p_reason text
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; v_competence date:=date_trunc('month',p_competence)::date;
  v_context text:=coalesce(current_setting('apticket.payable_mutation',true),'');
begin
  p:=apticket_finance_private.prepare_payable_mutation(p_id,p_expected_revision);
  if length(btrim(coalesce(p_document_number,''))) not between 2 and 80
    or length(btrim(coalesce(p_description,''))) not between 2 and 500
    or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
    or v_competence is null or p_due_date is null or p_due_date<v_competence
    or p_total_amount is null or p_total_amount::text in ('NaN','Infinity','-Infinity')
    or p_total_amount<0 or p_total_amount>999999999999.99 or p_total_amount<>round(p_total_amount,2)
    or (p.origin_type='manual' and p_total_amount=0) then
    raise exception using errcode='22023',message='Revise documento, descrição, competência, vencimento, valor e motivo da alteração.';
  end if;
  if p.origin_type<>'manual' and (v_competence<>date_trunc('month',p.cycle_start)::date or p_total_amount<>p.total_amount) then
    raise exception using errcode='P0001',message='O valor e a competência dos lançamentos contratuais são definidos pelo contrato e seus rateios.';
  end if;
  if row(btrim(p_document_number),btrim(p_description),v_competence,p_due_date,p_total_amount)
    is not distinct from row(p.document_number,p.description,date_trunc('month',p.cycle_start)::date,p.due_date,p.total_amount) then
    raise exception using errcode='22023',message='Altere pelo menos um campo do lançamento antes de salvar.';
  end if;
  perform apticket_finance_private.cancel_payable_approvals(p.id,'Lançamento alterado: '||btrim(p_reason));
  perform set_config('apticket.payable_mutation',p.id::text,true);
  update apticket.supplier_payables set document_number=btrim(p_document_number),description=btrim(p_description),
    cycle_start=case when p.origin_type='manual' then v_competence else p.cycle_start end,
    cycle_end=case when p.origin_type='manual' then (v_competence+interval '1 month')::date else p.cycle_end end,
    due_date=p_due_date,total_amount=p_total_amount,
    unit_price=case when p.origin_type='manual' then p_total_amount else p.unit_price end,
    status='scheduled',last_change_reason=btrim(p_reason) where id=p.id;
  perform set_config('apticket.payable_mutation',v_context,true);
  return true;
end $$;

create function apticket.delete_supplier_payable(p_id uuid,p_expected_revision integer,p_reason text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare p apticket.supplier_payables; v_context text:=coalesce(current_setting('apticket.payable_mutation',true),'');
begin
  p:=apticket_finance_private.prepare_payable_mutation(p_id,p_expected_revision);
  if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then
    raise exception using errcode='22023',message='Informe o motivo da exclusão, com 3 a 1.000 caracteres.';
  end if;
  perform apticket_finance_private.cancel_payable_approvals(p.id,'Lançamento excluído: '||btrim(p_reason));
  perform set_config('apticket.payable_mutation',p.id::text,true);
  update apticket.supplier_payables set status='cancelled',deleted_at=clock_timestamp(),last_change_reason=btrim(p_reason) where id=p.id;
  update apticket.supplier_payable_allocations set deleted_at=clock_timestamp() where supplier_payable_id=p.id and deleted_at is null;
  perform set_config('apticket.payable_mutation',v_context,true);
  return true;
end $$;
revoke all on function apticket.update_supplier_payable(uuid,integer,text,text,date,date,numeric,text),
  apticket.delete_supplier_payable(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function apticket.update_supplier_payable(uuid,integer,text,text,date,date,numeric,text),
  apticket.delete_supplier_payable(uuid,integer,text) to authenticated;
comment on function apticket.update_supplier_payable(uuid,integer,text,text,date,date,numeric,text) is
  'Edita um lançamento/parcela ainda não pago e sem pagamento ativo; invalida aprovações anteriores. Valor/período contratuais preservados.';
comment on function apticket.delete_supplier_payable(uuid,integer,text) is
  'Exclui logicamente um lançamento/parcela e seus rateios, preservando histórico e auditoria.';
-- O fluxo também informa a data da última correção da conta.
do $$ declare v_definition text; v_updated text;
begin
  v_definition:=pg_get_viewdef('apticket.cash_flow_entries'::regclass,true);
  v_updated:=regexp_replace(v_definition,'COALESCE\(payment\.updated_at,[[:space:]]*payable\.created_at\)',
    'GREATEST(payment.updated_at, payable.updated_at, payable.created_at)','gi');
  if v_updated=v_definition then raise exception 'Expressão de atualização do fluxo de caixa não encontrada.'; end if;
  execute 'create or replace view apticket.cash_flow_entries with (security_invoker=true) as '||v_updated;
end $$;
notify pgrst,'reload schema';
