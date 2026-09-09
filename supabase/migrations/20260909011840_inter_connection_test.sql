alter table apticket.tenant_inter_configurations add column last_connection_attempt timestamptz;
alter table apticket.inter_configuration_audit drop constraint inter_configuration_audit_action_check;
alter table apticket.inter_configuration_audit add constraint inter_configuration_audit_action_check
  check(action in ('saved','selected','deselected','connection_test'));

-- Only the trusted backend can obtain a credential bundle. Never grant this RPC
-- to authenticated/anon: actor and tenant are supplied by verified server context.
create function apticket.prepare_inter_connection_test(p_actor uuid,p_tenant uuid,p_environment text,p_version integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare config apticket.tenant_inter_configurations; credentials jsonb;
begin
  if not exists(select 1 from apticket.profiles where id=p_actor and tenant_id=p_tenant and is_active)
    or not apticket.has_permission(p_actor,'empresa','edit')
    or not apticket.has_permission(p_actor,'configuracoes','view') then
    raise exception using errcode='42501',message='Sem permissão.';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production') or p_version is null then
    raise exception using errcode='22023',message='Ambiente inválido.';
  end if;
  select * into config from apticket.tenant_inter_configurations
    where tenant_id=p_tenant and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Salve a configuração primeiro.'; end if;
  if config.version<>p_version then raise exception using errcode='40001',message='Atualize a configuração.'; end if;
  if config.certificate_expires_at<=now() then raise exception using errcode='22023',message='Certificado vencido.'; end if;
  if config.last_connection_attempt>now()-interval '60 seconds' then
    raise exception using errcode='54000',message='Aguarde um minuto antes de testar novamente.';
  end if;
  select decrypted_secret::jsonb into credentials from vault.decrypted_secrets where id=config.secret_id;
  if credentials is null then raise exception using errcode='22023',message='Credenciais indisponíveis.'; end if;
  update apticket.tenant_inter_configurations set last_connection_attempt=now()
    where tenant_id=p_tenant and environment=p_environment;
  insert into apticket.inter_configuration_audit(tenant_id,actor_id,environment,action)
    values(p_tenant,p_actor,p_environment,'connection_test');
  return credentials;
end $$;
revoke all on function apticket.prepare_inter_connection_test(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function apticket.prepare_inter_connection_test(uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
