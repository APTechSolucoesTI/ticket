-- Fatia 6: vínculo confirmado; não autoriza nem processa emissão bancária.
create table apticket.operating_company_inter_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  operating_company_id uuid not null,
  environment text not null check (environment in ('sandbox','production')),
  configuration_version integer not null check (configuration_version > 0),
  company_tax_id text not null check (company_tax_id ~ '^[0-9]{14}$'),
  account_last_four text not null check (account_last_four ~ '^[0-9]{1,4}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (operating_company_id,tenant_id)
    references apticket.operating_companies(id,tenant_id) on delete restrict,
  foreign key (tenant_id,environment)
    references apticket.tenant_inter_configurations(tenant_id,environment) on delete restrict,
  foreign key (created_by,tenant_id) references apticket.profiles(id,tenant_id) on delete restrict
);
-- Há apenas uma configuração bancária por tenant/ambiente nesta arquitetura.
create unique index inter_binding_current on apticket.operating_company_inter_bindings(tenant_id,environment)
  where deleted_at is null;
create index inter_binding_company on apticket.operating_company_inter_bindings(operating_company_id,tenant_id);
create index inter_binding_actor on apticket.operating_company_inter_bindings(created_by,tenant_id);
alter table apticket.operating_company_inter_bindings enable row level security;
revoke all on apticket.operating_company_inter_bindings from public,anon,authenticated,service_role;
grant select on apticket.operating_company_inter_bindings to authenticated,service_role;
create policy inter_binding_read on apticket.operating_company_inter_bindings for select to authenticated
  using (apticket.has_financial_scope(tenant_id,operating_company_id));
create trigger inter_binding_no_delete before delete on apticket.operating_company_inter_bindings
  for each row execute function apticket_finance_private.guard_record();
create trigger inter_binding_no_truncate before truncate on apticket.operating_company_inter_bindings
  for each statement execute function apticket_finance_private.guard_record();
create trigger inter_binding_audit after insert or update on apticket.operating_company_inter_bindings
  for each row execute function apticket_finance_private.audit_record();

-- Consulta sanitizada: não concede SELECT na configuração nem lê o Vault.
create function apticket_finance_private.review_inter_binding(p_company uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  c apticket.operating_companies; cfg apticket.tenant_inter_configurations;
  b apticket.operating_company_inter_bindings; tenant_tax text; reason text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  select * into c from apticket.operating_companies where id=p_company
    and tenant_id=apticket.current_tenant_id() and deleted_at is null;
  if not found or not apticket.has_financial_scope(c.tenant_id,c.id) then
    raise exception using errcode='42501',message='Empresa indisponível ou sem acesso financeiro.';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production') then
    raise exception using errcode='22023',message='Ambiente inválido.';
  end if;
  select regexp_replace(cnpj,'[^0-9]','','g') into tenant_tax from apticket.tenants where id=c.tenant_id;
  select * into cfg from apticket.tenant_inter_configurations where tenant_id=c.tenant_id and environment=p_environment;
  select * into b from apticket.operating_company_inter_bindings where tenant_id=c.tenant_id
    and environment=p_environment and deleted_at is null;
  reason := case
    when c.tax_id is null or c.tax_id is distinct from tenant_tax then 'company_tax_mismatch'
    when cfg.tenant_id is null then 'configuration_missing'
    when cfg.certificate_expires_at<=now() then 'certificate_expired'
    when b.id is null then 'confirmation_required'
    when b.operating_company_id<>c.id then 'bound_to_another_company'
    when b.configuration_version<>cfg.version or b.company_tax_id<>c.tax_id then 'confirmation_outdated'
    else 'confirmed' end;
  return jsonb_build_object('environment',p_environment,'state',reason,
    'configuration_version',cfg.version,'account_last_four',right(cfg.account,4),
    'certificate_expires_at',cfg.certificate_expires_at,
    'binding_id',case when b.operating_company_id=c.id then b.id end,
    'confirmed_at',case when b.operating_company_id=c.id then b.created_at end,
    'bank_ownership_verified',false,'dispatch_enabled',false);
end $$;

-- Definer limitado ao registro protegido; tenant/ator derivados da sessão.
-- Confirmação declara o vínculo interno, não comprova titularidade perante o banco.
create function apticket_finance_private.confirm_inter_binding(
  p_company uuid,p_environment text,p_configuration_version integer,p_previous_binding uuid,p_confirmed boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
  c apticket.operating_companies; cfg apticket.tenant_inter_configurations;
  b apticket.operating_company_inter_bindings; tenant_tax text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sessão obrigatória.'; end if;
  if not apticket.has_financial_scope(apticket.current_tenant_id(),p_company,true)
    or not exists(select 1 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id
      where ur.user_id=auth.uid() and r.tenant_id=apticket.current_tenant_id() and r.name in ('Admin','Financeiro')) then
    raise exception using errcode='42501',message='Exige perfil Admin ou Financeiro com acesso de escrita à empresa.';
  end if;
  if p_environment is null or p_environment not in ('sandbox','production')
    or p_configuration_version is null or p_configuration_version<1 or p_confirmed is distinct from true then
    raise exception using errcode='22023',message='Confirme a empresa, a conta e o ambiente revisados.';
  end if;
  -- Mesma ordem de lock do salvamento de credenciais: tenant antes da configuração.
  select regexp_replace(cnpj,'[^0-9]','','g') into tenant_tax from apticket.tenants
    where id=apticket.current_tenant_id() for update;
  select * into c from apticket.operating_companies where id=p_company
    and tenant_id=apticket.current_tenant_id() and deleted_at is null for update;
  if not found or c.tax_id is null or c.tax_id is distinct from tenant_tax then
    raise exception using errcode='23514',message='O CNPJ da empresa operadora deve corresponder ao cadastro da tenant.';
  end if;
  select * into cfg from apticket.tenant_inter_configurations where tenant_id=c.tenant_id and environment=p_environment;
  if not found then raise exception using errcode='23514',message='Configure este ambiente do Inter antes de vincular.'; end if;
  if cfg.version<>p_configuration_version then
    raise exception using errcode='40001',message='Configuração bancária alterada. Consulte e confirme novamente.';
  end if;
  if cfg.certificate_expires_at<=now() then raise exception using errcode='23514',message='Renove o certificado vencido antes de vincular.'; end if;
  select * into b from apticket.operating_company_inter_bindings
    where tenant_id=c.tenant_id and environment=p_environment and deleted_at is null;
  if b.id is not null then
    if b.operating_company_id<>c.id then
      raise exception using errcode='23514',message='Ambiente vinculado a outra empresa. Solicite revisão do vínculo.';
    end if;
    if b.configuration_version=cfg.version and b.company_tax_id=c.tax_id then
      return jsonb_build_object('id',b.id,'reused',true,'dispatch_enabled',false);
    end if;
  end if;
  if b.id is distinct from p_previous_binding then
    raise exception using errcode='40001',message='Vínculo alterado. Consulte e confirme novamente.';
  end if;
  update apticket.operating_company_inter_bindings set deleted_at=now() where id=b.id;
  insert into apticket.operating_company_inter_bindings
    (tenant_id,operating_company_id,environment,configuration_version,company_tax_id,account_last_four,created_by)
    values(c.tenant_id,c.id,p_environment,cfg.version,c.tax_id,right(cfg.account,4),auth.uid()) returning * into b;
  return jsonb_build_object('id',b.id,'reused',false,'dispatch_enabled',false);
end $$;

revoke all on function apticket_finance_private.review_inter_binding(uuid,text) from public,anon,authenticated,service_role;
revoke all on function apticket_finance_private.confirm_inter_binding(uuid,text,integer,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function apticket_finance_private.review_inter_binding(uuid,text) to authenticated;
grant execute on function apticket_finance_private.confirm_inter_binding(uuid,text,integer,uuid,boolean) to authenticated;
create function apticket.review_inter_binding(p_company uuid,p_environment text)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.review_inter_binding(p_company,p_environment);
$$;
create function apticket.confirm_inter_binding(p_company uuid,p_environment text,p_configuration_version integer,p_previous_binding uuid,p_confirmed boolean)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select apticket_finance_private.confirm_inter_binding(p_company,p_environment,p_configuration_version,p_previous_binding,p_confirmed);
$$;
revoke all on function apticket.review_inter_binding(uuid,text) from public,anon,service_role;
revoke all on function apticket.confirm_inter_binding(uuid,text,integer,uuid,boolean) from public,anon,service_role;
grant execute on function apticket.review_inter_binding(uuid,text) to authenticated;
grant execute on function apticket.confirm_inter_binding(uuid,text,integer,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
