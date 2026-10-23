-- `contratos` remains the customer-contract module for backward compatibility.
-- Supplier contracts have their own CRUD; payment operations keep their checks.
insert into apticket.permissions(module,action,description)
select 'contratos_fornecedores',action,label||' contratos de fornecedores'
from (values ('view','Visualizar'),('create','Criar'),('edit','Editar'),('delete','Excluir')) a(action,label)
on conflict(module,action) do nothing;

-- Preserve existing role access: payable view -> view, payable edit -> CRUD writes.
insert into apticket.role_permissions(role_id,permission_id)
select rp.role_id,new_permission.id
from apticket.role_permissions rp
join apticket.permissions old_permission on old_permission.id=rp.permission_id
join apticket.permissions new_permission on new_permission.module='contratos_fornecedores'
 and ((old_permission.action='view' and new_permission.action='view')
   or (old_permission.action='edit' and new_permission.action in ('create','edit','delete')))
where old_permission.module='financeiro_contas_pagar'
 and exists(select 1 from apticket.role_permissions parent_grant join apticket.permissions parent_permission
   on parent_permission.id=parent_grant.permission_id where parent_grant.role_id=rp.role_id
   and parent_permission.module='financeiro' and parent_permission.action='view')
 and (old_permission.action='view' or exists(select 1 from apticket.role_permissions parent_grant join apticket.permissions parent_permission
   on parent_permission.id=parent_grant.permission_id where parent_grant.role_id=rp.role_id
   and parent_permission.module='financeiro' and parent_permission.action='edit'))
on conflict do nothing;

-- Preserve individual grants AND denials, including users with custom roles.
insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted,created_by)
select up.tenant_id,up.user_id,new_permission.id,up.granted,up.created_by
from apticket.user_permissions up
join apticket.permissions old_permission on old_permission.id=up.permission_id
join apticket.permissions new_permission on new_permission.module='contratos_fornecedores'
 and ((old_permission.action='view' and new_permission.action='view')
   or (old_permission.action='edit' and new_permission.action in ('create','edit','delete')))
where old_permission.module='financeiro_contas_pagar'
on conflict(user_id,permission_id) do nothing;

-- Preserve the old EFFECTIVE boundary too: a deny on the financial parent
-- used to prevent supplier access even if payable permissions were granted.
-- After migration these are independent modules, so capture that restriction
-- once as a supplier override instead of silently widening existing access.
with legacy as (
 select ur.user_id,ur.tenant_id,
  bool_or(p.module='financeiro' and p.action='view' and coalesce(up.granted,rp.permission_id is not null)) as finance_view,
  bool_or(p.module='financeiro' and p.action='edit' and coalesce(up.granted,rp.permission_id is not null)) as finance_edit,
  bool_or(p.module='financeiro_contas_pagar' and p.action='view' and coalesce(up.granted,rp.permission_id is not null)) as payable_view,
  bool_or(p.module='financeiro_contas_pagar' and p.action='edit' and coalesce(up.granted,rp.permission_id is not null)) as payable_edit
 from apticket.user_roles ur join apticket.roles r on r.id=ur.role_id and not r.is_system
 cross join apticket.permissions p
 left join apticket.role_permissions rp on rp.role_id=ur.role_id and rp.permission_id=p.id
 left join apticket.user_permissions up on up.user_id=ur.user_id and up.permission_id=p.id
 where p.module in ('financeiro','financeiro_contas_pagar')
 group by ur.user_id,ur.tenant_id
), expected as (
 select l.user_id,l.tenant_id,p.id,
  case when p.action='view' then finance_view and payable_view
    else finance_view and finance_edit and payable_edit end as granted
 from legacy l cross join apticket.permissions p where p.module='contratos_fornecedores'
)
insert into apticket.user_permissions(tenant_id,user_id,permission_id,granted)
select e.tenant_id,e.user_id,e.id,e.granted from expected e
join apticket.user_roles ur on ur.user_id=e.user_id
left join apticket.role_permissions rp on rp.role_id=ur.role_id and rp.permission_id=e.id
left join apticket.user_permissions up on up.user_id=e.user_id and up.permission_id=e.id
where coalesce(up.granted,rp.permission_id is not null) is distinct from e.granted
on conflict(user_id,permission_id) do update set granted=excluded.granted;

insert into apticket.role_permissions(role_id,permission_id)
select r.id,p.id from apticket.roles r cross join apticket.permissions p
where r.is_system on conflict do nothing;

-- A protected system role is always complete, including newly catalogued actions.
-- Return no individual override for Admin, so UI and database agree.
create or replace function apticket.get_effective_permissions(_user_id uuid)
returns table(module text,action text,granted_by_role boolean,override boolean,effective boolean)
language sql stable security invoker set search_path=pg_catalog as $$
 select p.module,p.action,
   (coalesce(r.is_system,false) or rp.permission_id is not null),
   case when r.is_system then null::boolean else up.granted end,
   case when r.is_system then true else coalesce(up.granted,rp.permission_id is not null) end
 from apticket.permissions p
 left join apticket.user_roles ur on ur.user_id=_user_id
 left join apticket.roles r on r.id=ur.role_id and r.tenant_id=ur.tenant_id
 left join apticket.role_permissions rp on rp.permission_id=p.id and rp.role_id=ur.role_id
 left join apticket.user_permissions up on up.permission_id=p.id and up.user_id=_user_id
 where _user_id=(select auth.uid()) or current_user in ('service_role','postgres');
$$;

-- Keep company boundaries without requiring access to Accounts Payable itself.
-- CRUD module checks are paired with this scope in policies/RPCs below.
create function apticket.has_supplier_contract_scope(_tenant_id uuid,_company_id uuid,_write boolean default false)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
 select _tenant_id=(select apticket.current_tenant_id()) and (
   exists(select 1 from apticket.user_roles ur join apticket.roles r
     on r.id=ur.role_id and r.tenant_id=ur.tenant_id
     where ur.user_id=auth.uid() and ur.tenant_id=_tenant_id
       and (r.is_system or r.name='Financeiro'))
   or exists(select 1 from apticket.financial_access a
     where a.tenant_id=_tenant_id and a.user_id=auth.uid() and a.deleted_at is null
       and (not _write or a.can_write)
       and (a.operating_company_id is null or a.operating_company_id=_company_id))
 );
$$;
alter function apticket.has_supplier_contract_scope(uuid,uuid,boolean) owner to postgres;
revoke all on function apticket.has_supplier_contract_scope(uuid,uuid,boolean) from public,anon;
grant execute on function apticket.has_supplier_contract_scope(uuid,uuid,boolean) to authenticated,service_role;

-- Minimal lookup data for the contract form, without granting access to the
-- supplier registry, payment records, or financial configuration screens.
create function apticket.get_supplier_contract_options(_company_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare tenant uuid:=apticket.current_tenant_id();
begin
 if auth.uid() is null or tenant is null
   or not apticket.has_permission(auth.uid(),'contratos_fornecedores','view')
   or (_company_id is not null and not apticket.has_supplier_contract_scope(tenant,_company_id)) then
   raise insufficient_privilege using message='Sem permissao para consultar as opcoes de contratos de fornecedores.';
 end if;
 return jsonb_build_object(
  'companies',coalesce((select jsonb_agg(x order by x.legal_name) from (
   select id,legal_name,trade_name from apticket.operating_companies
   where tenant_id=tenant and is_active and deleted_at is null
    and apticket.has_supplier_contract_scope(tenant,id)) x),'[]'::jsonb),
  'suppliers',coalesce((select jsonb_agg(x order by x.legal_name) from (
   select id,legal_name,trade_name,is_active from apticket.suppliers
   where tenant_id=tenant and deleted_at is null) x),'[]'::jsonb),
  'categories',coalesce((select jsonb_agg(x order by x.code) from (
   select id,code,name from apticket.financial_categories
   where tenant_id=tenant and _company_id is not null and (operating_company_id=_company_id or is_global)
    and is_active and classification_type='analytic' and deleted_at is null and direction in ('outflow','both')) x),'[]'::jsonb),
  'cost_centers',coalesce((select jsonb_agg(x order by x.code) from (
   select id,code,name from apticket.financial_cost_centers
   where tenant_id=tenant and _company_id is not null and (operating_company_id=_company_id or is_global)
    and is_active and classification_type='analytic' and deleted_at is null) x),'[]'::jsonb));
end $$;
alter function apticket.get_supplier_contract_options(uuid) owner to postgres;
revoke all on function apticket.get_supplier_contract_options(uuid) from public,anon;
grant execute on function apticket.get_supplier_contract_options(uuid) to authenticated;

alter policy payable_read on apticket.supplier_contracts
 using(apticket.has_supplier_contract_scope(tenant_id,operating_company_id));
alter policy payable_insert on apticket.supplier_contracts
 with check(deleted_at is null and apticket.has_supplier_contract_scope(tenant_id,operating_company_id,true));
alter policy payable_update on apticket.supplier_contracts
 using(deleted_at is null and apticket.has_supplier_contract_scope(tenant_id,operating_company_id,true))
 with check(apticket.has_supplier_contract_scope(tenant_id,operating_company_id,true));
alter policy financial_area_read_guard on apticket.supplier_contracts
 using(apticket.has_permission(auth.uid(),'contratos_fornecedores','view'));
alter policy supplier_contract_area_insert on apticket.supplier_contracts
 with check(apticket.has_permission(auth.uid(),'contratos_fornecedores','create'));
alter policy supplier_contract_area_update on apticket.supplier_contracts
 using(apticket.has_permission(auth.uid(),'contratos_fornecedores','edit'))
 with check(apticket.has_permission(auth.uid(),'contratos_fornecedores','edit'));

-- Domain RPCs preserve their financial checks when producing payment records.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('apticket.archive_supplier_contract(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'apticket.has_financial_scope(', 'apticket.has_supplier_contract_scope(');
 definition:=replace(definition,'''financeiro_contas_pagar'',''edit''','''contratos_fornecedores'',''delete''');
 execute definition;

 select pg_get_functiondef('apticket.generate_supplier_payable(uuid,date)'::regprocedure) into definition;
 definition:=replace(definition,
   'if not apticket.has_permission(auth.uid(),''financeiro_contas_pagar'',''edit'') then',
   'if not apticket.has_permission(auth.uid(),''contratos_fornecedores'',''edit'') or not apticket.has_permission(auth.uid(),''financeiro_contas_pagar'',''edit'') then');
 execute definition;

 select pg_get_functiondef('apticket.save_supplier_allocation_rules(uuid,date,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'if v_actor is null or not apticket.has_financial_scope(',
   'if not apticket.has_permission(auth.uid(),''contratos_fornecedores'',''edit'') or v_actor is null or not apticket.has_financial_scope(');
 execute definition;

 -- New tenants: non-financial default roles do not inherit supplier contracts.
 select pg_get_functiondef('apticket.seed_tenant_default_roles(uuid)'::regprocedure) into definition;
 definition:=replace(definition,'''financeiro'',''fornecedores'')','''financeiro'',''fornecedores'',''contratos_fornecedores'')');
 definition:=replace(definition,'or module=''fornecedores''','or module in (''fornecedores'',''contratos_fornecedores'')');
 execute definition;
end $migration$;

-- A user override must not turn a protected Admin role into a partial role.
create function apticket_security_private.protect_admin_user_permissions()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if not new.granted and exists(select 1 from apticket.user_roles ur join apticket.roles r
   on r.id=ur.role_id and r.tenant_id=ur.tenant_id
   where ur.user_id=new.user_id and ur.tenant_id=new.tenant_id and r.is_system) then
   raise insufficient_privilege using message='Administradores possuem acesso integral. Altere o papel para definir permissoes individuais.';
 end if;
 return new;
end $$;
alter function apticket_security_private.protect_admin_user_permissions() owner to postgres;
revoke all on function apticket_security_private.protect_admin_user_permissions() from public,anon,authenticated,service_role;
create trigger protect_admin_user_permissions before insert or update on apticket.user_permissions
for each row execute function apticket_security_private.protect_admin_user_permissions();

notify pgrst,'reload schema';
