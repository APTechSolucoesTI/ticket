-- The tenants table uses column-level grants to avoid exposing credentials.
-- Keep the newly added CNAE field available to authenticated users while the
-- existing RLS policies continue restricting reads and writes to their tenant.
grant select (cnaes) on table apticket.tenants to authenticated;
grant update (cnaes) on table apticket.tenants to authenticated;

notify pgrst, 'reload schema';
