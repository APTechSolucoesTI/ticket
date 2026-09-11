-- A API publica apenas um invoker fino. O bypass necessario ao worker fica
-- isolado na funcao privada, protegida pela verificacao de service_role.
create or replace function apticket.process_contract_financial_events(
  p_limit integer default 100,
  p_as_of date default current_date
) returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.process_contract_financial_events(p_limit,p_as_of)
$$;
revoke all on function apticket.process_contract_financial_events(integer,date)
  from public,anon,authenticated,service_role;
grant execute on function apticket.process_contract_financial_events(integer,date)
  to service_role;
notify pgrst,'reload schema';
