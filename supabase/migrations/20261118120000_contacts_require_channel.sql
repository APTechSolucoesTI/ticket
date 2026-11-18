begin;
set local lock_timeout = '5s';

alter table apticket.contacts
  drop constraint contacts_registered_email_required,
  add constraint contacts_channel_required check (
    coalesce(email ~ '[^[:space:]]', false)
    or coalesce(phone ~ '[^[:space:]]', false)
    or cardinality(secondary_emails) > 0
    or cardinality(secondary_phones) > 0
  ) not valid;

-- The existing BEFORE trigger normalizes channels and validates every secondary
-- value. NOT VALID preserves legacy drafts while enforcing all INSERTs/UPDATEs,
-- including updates that only change company_id, name or another non-channel field.
-- No legacy contact is populated, removed or otherwise modified here.
do $migration$
begin
  if not exists (
    select 1 from apticket.contacts
    where not (
      coalesce(email ~ '[^[:space:]]', false)
      or coalesce(phone ~ '[^[:space:]]', false)
      or cardinality(secondary_emails) > 0
      or cardinality(secondary_phones) > 0
    )
  ) then
    alter table apticket.contacts validate constraint contacts_channel_required;
  else
    raise notice 'contacts_channel_required remains NOT VALID because legacy contacts need a real email or phone before their next update.';
  end if;
end $migration$;

-- Deployment preflight / follow-up inventory (read-only)
-- select id, tenant_id from apticket.contacts
-- where not (coalesce(email ~ '[^[:space:]]', false)
--   or coalesce(phone ~ '[^[:space:]]', false)
--   or cardinality(secondary_emails) > 0 or cardinality(secondary_phones) > 0);
-- Once the responsible team supplies each real channel, validate explicitly
-- alter table apticket.contacts validate constraint contacts_channel_required;

notify pgrst, 'reload schema';
commit;
