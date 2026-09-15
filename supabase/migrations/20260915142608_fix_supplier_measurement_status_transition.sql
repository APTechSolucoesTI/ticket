-- Mantem os lancamentos imutaveis, liberando somente as transicoes realizadas
-- pelas funcoes financeiras privilegiadas. A comparacao JSON anterior podia
-- interpretar colunas geradas como alteracao durante o trigger pos-insert.
create or replace function apticket_finance_private.guard_supplier_payable()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.allocation_status is distinct from old.allocation_status then
    if old.allocation_status='pending_rule' and new.allocation_status='complete' then
      return new;
    end if;
    raise exception using errcode='23514',message='A situacao do rateio nao pode retroceder.';
  end if;
  if new.status is distinct from old.status then
    if (old.status='scheduled' and new.status='awaiting_approval' and new.allocation_status='complete')
      or (old.status='awaiting_approval' and new.status in ('approved','scheduled'))
      or (old.status='approved' and new.status='paid') then
      return new;
    end if;
    raise exception using errcode='23514',message='A transicao financeira deste lancamento nao e permitida.';
  end if;
  if new.deleted_at is distinct from old.deleted_at then return new; end if;
  raise exception using errcode='23514',message='O lancamento gerado e imutavel.';
end $$;

revoke all on function apticket_finance_private.guard_supplier_payable()
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
