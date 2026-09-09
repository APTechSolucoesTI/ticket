-- Preparação interna apenas. Não há envio ao banco nesta migration.
alter table apticket.contas_receber add constraint receivable_inter_scope_key
  unique(id,tenant_id,operating_company_id);
create table apticket.inter_charge_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  receivable_id uuid not null,
  environment text not null check(environment in ('sandbox','production')),
  amount numeric(14,2) not null check(amount>0),
  due_date date not null,
  status text not null default 'blocked_homologation' check(status='blocked_homologation'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(receivable_id,environment),
  foreign key(receivable_id,tenant_id,operating_company_id)
    references apticket.contas_receber(id,tenant_id,operating_company_id) on delete restrict,
  foreign key(created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
alter table apticket.inter_charge_requests enable row level security;
revoke all on apticket.inter_charge_requests from public,anon,authenticated,service_role;
grant select on apticket.inter_charge_requests to authenticated,service_role;
create policy inter_requests_scoped_read on apticket.inter_charge_requests for select to authenticated
  using(apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger inter_requests_no_delete before delete on apticket.inter_charge_requests
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_requests_no_truncate before truncate on apticket.inter_charge_requests
  for each statement execute function apticket_finance_private.guard_record();
create trigger inter_requests_audit after insert or update on apticket.inter_charge_requests
  for each row execute function apticket_finance_private.audit_record();

-- Private definer is necessary to insert into the protected outbox. The caller's
-- signed JWT supplies auth.uid(); actor/tenant/amount cannot come from the body.
create function apticket_finance_private.prepare_inter_charge(p_receivable uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r apticket.contas_receber; existing apticket.inter_charge_requests; actor uuid:=auth.uid();
begin
  if actor is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  if p_environment is null or p_environment not in ('sandbox','production') then
    raise exception using errcode='22023',message='Ambiente inválido.';
  end if;
  -- Lock the source serializes requests and concurrent manual financial changes.
  select * into r from apticket.contas_receber where id=p_receivable
    and tenant_id=apticket.current_tenant_id() for update;
  if not found or r.operating_company_id is null
    or not apticket.has_financial_scope(r.tenant_id,r.operating_company_id,true) then
    raise exception using errcode='42501',message='Recebível indisponível ou sem acesso à empresa.';
  end if;
  if r.deleted_at is not null or r.status_cobranca<>'a_faturar' or r.valor_aberto<=0
    or r.valor_aberto<>r.valor_original
    or not exists(select 1 from apticket.operating_companies where id=r.operating_company_id and deleted_at is null)
    or not exists(select 1 from apticket.billing_cycles where id=r.billing_cycle_id and deleted_at is null) then
    raise exception using errcode='23514',message='Recebível não elegível para preparação.';
  end if;
  select * into existing from apticket.inter_charge_requests
    where receivable_id=r.id and environment=p_environment;
  if found then
    if existing.deleted_at is not null or existing.amount<>r.valor_aberto or existing.due_date<>r.vencimento_em then
      raise exception using errcode='40001',message='Recebível alterado após a preparação. Solicite revisão antes da emissão.';
    end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'reused',true);
  end if;
  insert into apticket.inter_charge_requests(tenant_id,operating_company_id,receivable_id,environment,amount,due_date,created_by)
    values(r.tenant_id,r.operating_company_id,r.id,p_environment,r.valor_aberto,r.vencimento_em,actor)
    returning * into existing;
  return jsonb_build_object('id',existing.id,'status',existing.status,'reused',false);
end $$;
revoke all on function apticket_finance_private.prepare_inter_charge(uuid,text) from public,anon,authenticated,service_role;
grant usage on schema apticket_finance_private to authenticated;
grant execute on function apticket_finance_private.prepare_inter_charge(uuid,text) to authenticated;
create function apticket.prepare_inter_charge(p_receivable uuid,p_environment text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.prepare_inter_charge(p_receivable,p_environment);
$$;
revoke all on function apticket.prepare_inter_charge(uuid,text) from public,anon,service_role;
grant execute on function apticket.prepare_inter_charge(uuid,text) to authenticated;
notify pgrst,'reload schema';
