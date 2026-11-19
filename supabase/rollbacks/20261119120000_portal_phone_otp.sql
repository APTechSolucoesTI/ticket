begin;
delete from apticket.portal_otp_codes where email is null;
drop index apticket.portal_otp_codes_phone_idx;
alter table apticket.portal_otp_codes
  drop constraint portal_otp_one_identifier,
  drop column phone,
  alter column email set not null;
notify pgrst, 'reload schema';
commit;
