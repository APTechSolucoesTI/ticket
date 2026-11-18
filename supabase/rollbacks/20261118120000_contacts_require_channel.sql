begin;
set local lock_timeout = '5s';

alter table apticket.contacts
  drop constraint contacts_channel_required,
  add constraint contacts_registered_email_required
    check (company_id is null or nullif(btrim(email), '') is not null) not valid;

-- Preserve contacts saved under the new rule. Restoring the old constraint as
-- NOT VALID still enforces primary email on subsequent registered-contact writes.
do $rollback$
begin
  if not exists (
    select 1 from apticket.contacts
    where company_id is not null and nullif(btrim(email), '') is null
  ) then
    alter table apticket.contacts validate constraint contacts_registered_email_required;
  else
    raise notice 'contacts_registered_email_required remains NOT VALID because registered contacts now exist without primary email.';
  end if;
end $rollback$;

notify pgrst, 'reload schema';
commit;
