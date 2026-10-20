-- Coordinate with reverting the verifier. Reopens the lost-increment race.
begin;
set local lock_timeout = '5s';
drop function apticket.increment_portal_otp_attempt(uuid);
notify pgrst, 'reload schema';
commit;
