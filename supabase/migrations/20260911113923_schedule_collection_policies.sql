create function apticket.schedule_collection_policies(p_as_of date default current_date,p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v_policy record; v_result jsonb; v_policies int:=0; v_actions int:=0; v_events int:=0;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='A rotina automática exige credencial de serviço.';
  end if;
  if p_as_of>current_date or p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='Data ou limite inválido para processar a régua.';
  end if;
  for v_policy in select tenant_id,operating_company_id from apticket.collection_policies
    where enabled and deleted_at is null order by updated_at limit p_limit
  loop
    v_result:=apticket_finance_private.evaluate_collection_policy(v_policy.tenant_id,v_policy.operating_company_id,p_as_of);
    v_policies:=v_policies+1;
    v_actions:=v_actions+coalesce((v_result->>'actions')::int,0);
    v_events:=v_events+coalesce((v_result->>'events')::int,0);
  end loop;
  return jsonb_build_object('policies',v_policies,'actions',v_actions,'events',v_events,
    'limit_reached',v_policies=p_limit);
end $$;

revoke all on function apticket.schedule_collection_policies(date,integer)
  from public,anon,authenticated,service_role;
grant execute on function apticket.schedule_collection_policies(date,integer) to service_role;
notify pgrst,'reload schema';
