begin;

-- Existing APTicket administrators can still hold a Supabase Auth JWT created
-- before the app claim was introduced. Their profile remains the scoped
-- application identity, so allow that legacy session to resolve its tenant.
create or replace function apticket.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select p.tenant_id
  from apticket.profiles p
  where p.id = (select auth.uid())
    and p.is_active;
$$;

commit;
