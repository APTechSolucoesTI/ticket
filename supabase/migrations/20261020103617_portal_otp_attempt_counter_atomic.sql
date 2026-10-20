-- Preserve the existing five-attempt policy across concurrent web replicas.
begin;
set local lock_timeout = '5s';
create function apticket.increment_portal_otp_attempt(_otp_id uuid)
returns integer language sql volatile security invoker set search_path = pg_catalog as $$
  update apticket.portal_otp_codes
  set attempts = attempts + 1
  where id = _otp_id and consumed_at is null
    and expires_at > clock_timestamp() and attempts < 5
  returning attempts;
$$;
revoke all on function apticket.increment_portal_otp_attempt(uuid) from public, anon, authenticated;
grant execute on function apticket.increment_portal_otp_attempt(uuid) to service_role;
alter function apticket.increment_portal_otp_attempt(uuid) owner to postgres;
notify pgrst, 'reload schema';
commit;
