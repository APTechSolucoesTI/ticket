-- Shared counters contain only server-generated HMACs, never IPs/emails/tokens.
create schema if not exists apticket_security_private authorization postgres;
revoke all on schema apticket_security_private from public, anon, authenticated;
create table apticket_security_private.rate_limit_buckets (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  hits integer not null check (hits > 0),
  expires_at timestamptz not null
);
alter table apticket_security_private.rate_limit_buckets owner to postgres;
alter table apticket_security_private.rate_limit_buckets enable row level security;
create index rate_limit_buckets_expiry on apticket_security_private.rate_limit_buckets (expires_at);
revoke all on apticket_security_private.rate_limit_buckets from public, anon, authenticated;
grant usage on schema apticket_security_private to service_role;
grant select, insert, update, delete on apticket_security_private.rate_limit_buckets to service_role;

create function apticket.consume_security_rate_limit(_key_hash text, _limit integer, _window_ms integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  stamp timestamptz := clock_timestamp();
  counter apticket_security_private.rate_limit_buckets;
begin
  if _key_hash is null or _key_hash !~ '^[0-9a-f]{64}$' or
     _limit is null or _limit < 1 or _limit > 1000000 or
     _window_ms is null or _window_ms < 1000 or _window_ms > 86400000 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;
  delete from apticket_security_private.rate_limit_buckets where key_hash in (
    select key_hash from apticket_security_private.rate_limit_buckets
    where expires_at < stamp order by expires_at limit 100
  );
  insert into apticket_security_private.rate_limit_buckets as b values
    (_key_hash, 1, stamp + _window_ms * interval '1 millisecond')
  on conflict (key_hash) do update set
    hits = case when b.expires_at <= stamp then 1 else least(b.hits + 1, _limit + 1) end,
    expires_at = case when b.expires_at <= stamp then excluded.expires_at else b.expires_at end
  returning * into counter;
  return jsonb_build_object('allowed', counter.hits <= _limit,
    'retry_after_seconds', case when counter.hits <= _limit then 0
      else greatest(1, ceil(extract(epoch from counter.expires_at - stamp))::integer) end);
end;
$$;
alter function apticket.consume_security_rate_limit(text, integer, integer) owner to postgres;
revoke all on function apticket.consume_security_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function apticket.consume_security_rate_limit(text, integer, integer) to service_role;
notify pgrst, 'reload schema';
