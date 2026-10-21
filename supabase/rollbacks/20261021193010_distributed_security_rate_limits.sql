-- Coordinate with app rollback: removing this RPC denies guarded requests.
drop function apticket.consume_security_rate_limit(text, integer, integer);
drop table apticket_security_private.rate_limit_buckets;
-- Retain the private schema in case later migrations depend on it.
notify pgrst, 'reload schema';
