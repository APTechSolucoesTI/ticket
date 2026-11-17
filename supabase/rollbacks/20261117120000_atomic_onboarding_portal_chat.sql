begin;
set local lock_timeout = '5s';
-- Restore the previous application version before removing these RPCs.
drop function apticket.create_portal_chat(uuid,uuid,text,text,uuid);
drop function apticket.provision_tenant(text,text,text,text);
create or replace function apticket.classificar_ticket_antes_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_result record;
begin
  select * into v_result from apticket.resolver_atendimento_ticket(
    new.tenant_id,new.company_id,new.equipment_id,coalesce(new.created_at,now()));
  new.tipo_atendimento := v_result.tipo; new.motivo_avulso := v_result.motivo;
  new.contract_id := v_result.contrato_id; new.sla_policy_id := v_result.sla_id;
  if new.tipo_atendimento='avulso' then
    new.sla_first_response_due_at := null; new.sla_resolution_due_at := null; new.sla_breached := false;
  end if;
  return new;
end $$;
notify pgrst,'reload schema';
commit;
