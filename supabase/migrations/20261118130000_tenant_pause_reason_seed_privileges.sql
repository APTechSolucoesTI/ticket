begin;
set local lock_timeout = '5s';

-- Tenant inserts seed defaults through this fixed trigger entry point. Its
-- owner can call the private helper without granting callers direct access.
alter function apticket.seed_pause_reasons_for_new_tenant()
  security definer set search_path = pg_catalog;
alter function apticket.seed_pause_reasons_for_new_tenant() owner to postgres;
revoke all on function apticket.seed_pause_reasons_for_new_tenant()
  from public, anon, authenticated, service_role;

commit;
