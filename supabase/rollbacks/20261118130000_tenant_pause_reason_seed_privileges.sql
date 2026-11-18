begin;
set local lock_timeout = '5s';

alter function apticket.seed_pause_reasons_for_new_tenant()
  security invoker set search_path = '';

commit;
