-- Validate the company identity before returning a collection policy.
CREATE OR REPLACE FUNCTION apticket.get_collection_policy(p_company uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare v_tenant uuid:=apticket.current_tenant_id(); v_policy apticket.collection_policies; v_configured boolean;
begin
  if not apticket.has_permission(auth.uid(),'financeiro_contas_receber','view') then
    raise exception using errcode='42501',message='Sem permissao para esta operacao financeira.';
  end if;
  if auth.uid() is null or not apticket.has_financial_scope(v_tenant,p_company)
    or not exists(select 1 from apticket.operating_companies where id=p_company and tenant_id=v_tenant and deleted_at is null) then
    raise exception using errcode='42501',message='Você não possui permissão para consultar a régua de cobrança.';
  end if;
  select * into v_policy from apticket.collection_policies where tenant_id=v_tenant
    and operating_company_id=p_company and deleted_at is null;
  v_configured:=found;
  return jsonb_build_object(
    'company_id',p_company,'configured',v_configured,'enabled',coalesce(v_policy.enabled,false),
    'suspend_after_days',v_policy.suspend_after_days,
    'steps',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'position',s.position,
      'days_after_due',s.days_after_due,'channel',s.channel,'subject',s.subject,
      'message_template',s.message_template,'enabled',s.enabled) order by s.position)
      from apticket.collection_policy_steps s where s.policy_id=v_policy.id and s.deleted_at is null),'[]'::jsonb),
    'pending_actions',coalesce((select count(*) from apticket.collection_actions a
      where a.policy_id=v_policy.id and a.status='pending'),0),
    'failed_actions',coalesce((select count(*) from apticket.collection_actions a
      where a.policy_id=v_policy.id and a.status='failed'),0),
    'pending_events',coalesce((select count(*) from apticket.financial_domain_events e
      where e.tenant_id=v_tenant and e.operating_company_id=p_company and e.status='pending'),0),
    'updated_at',v_policy.updated_at
  );
end $$;


ALTER FUNCTION apticket.get_collection_policy(p_company uuid) OWNER TO supabase_admin;
