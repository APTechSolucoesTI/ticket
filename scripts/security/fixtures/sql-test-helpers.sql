-- Disposable databases only. These factories supply modern REQUIRED fixture
-- fields; RLS, application triggers and constraints remain active in tests.
create schema apticket_appsec;
create function apticket_appsec.financial_roles(tenant uuid) returns void
language sql security definer set search_path=pg_catalog as $$
  insert into apticket.roles(tenant_id,name)
    values(tenant,'SQL scoped writer'),(tenant,'SQL scoped reader') on conflict do nothing;
  insert into apticket.role_permissions(role_id,permission_id)
    select r.id,p.id from apticket.roles r cross join apticket.permissions p
    where r.tenant_id=tenant and (p.module like 'financeiro%' or p.module='fornecedores')
      and (r.name='SQL scoped writer' or (r.name='SQL scoped reader' and p.action='view'))
    on conflict do nothing;
$$;
create function apticket_appsec.claims(input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare tenant uuid;
begin
  if input->>'app'='apticket' and not input ? 'tenant_id' and input ? 'sub' then
    select tenant_id into tenant from apticket.profiles where id=(input->>'sub')::uuid;
    if tenant is not null then input:=input||jsonb_build_object('tenant_id',tenant); end if;
  end if;
  return input;
end $$;
create function apticket_appsec.fixture_actor(tenant uuid) returns uuid
language plpgsql security invoker set search_path=pg_catalog as $$
declare actor uuid;
begin
  -- Only the fixture bootstrap may impersonate. Real authenticated test
  -- operations keep their explicit identity, including cross-tenant attempts.
  if current_user='supabase_admin' then
    select id into actor from apticket.profiles where tenant_id=tenant and is_active order by id limit 1;
    if actor is null then raise exception 'Fixture requires an active profile'; end if;
    perform set_config('request.jwt.claims',jsonb_build_object('app','apticket','role','authenticated',
      'sub',actor,'tenant_id',tenant)::text,true);
  end if;
  return tenant;
end $$;
create function apticket_appsec.operating_company(tenant uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare item uuid;
begin
  select id into item from apticket.operating_companies where tenant_id=tenant order by id limit 1;
  if item is null then
    insert into apticket.operating_companies(tenant_id,legal_name)
      values(tenant,'SQL fixture operator') returning id into item;
  end if;
  return item;
end;
$$;
create function apticket_appsec.category(tenant uuid, direction text) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare item uuid;
begin
  select id into item from apticket.financial_categories where tenant_id=tenant and is_global
    and classification_type='analytic' and is_active and deleted_at is null
    and financial_categories.direction in ($2,'both') order by code,id limit 1;
  if item is null then
    insert into apticket.financial_categories(tenant_id,code,name,direction,is_global,classification_type,operating_company_id)
      values(tenant,case direction when 'inflow' then '98.99.0001' else '98.99.0002' end,
        'SQL fixture category',direction,true,'analytic',apticket_appsec.operating_company(tenant)) returning id into item;
  end if;
  return item;
end;
$$;
create function apticket_appsec.contract_operator(tenant uuid, customer uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare item uuid;
begin
  -- Test fixtures use matching UUID suffixes for customer/operator pairs.
  select id into item from apticket.operating_companies where tenant_id=tenant
    and right(id::text,12)=right(customer::text,12) order by id limit 1;
  return coalesce(item,apticket_appsec.operating_company(tenant));
end;
$$;
create function apticket_appsec.cost_center(tenant uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog as $$
declare item uuid;
begin
  select id into item from apticket.financial_cost_centers where tenant_id=tenant and is_global
    and classification_type='analytic' and is_active and deleted_at is null order by code,id limit 1;
  if item is null then
    insert into apticket.financial_cost_centers(tenant_id,code,name,is_global,classification_type,operating_company_id)
      values(tenant,'98.99.0001','SQL fixture cost center',true,'analytic',apticket_appsec.operating_company(tenant)) returning id into item;
  end if;
  return item;
end;
$$;
grant usage on schema apticket_appsec to authenticated,anon,service_role,postgres;
-- Not deployed or exposed through PostgREST. The fixture function owner can
-- inspect seeded identities even while the tested role has its own RLS context.
