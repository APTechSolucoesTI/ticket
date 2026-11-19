begin;
alter table apticket.portal_otp_codes
  alter column email drop not null,
  add column phone text,
  add constraint portal_otp_one_identifier check (
    num_nonnulls(email, phone) = 1 and (phone is null or phone ~ '^[0-9]{10,15}$')
  );
create index portal_otp_codes_phone_idx
  on apticket.portal_otp_codes(phone, created_at desc) where phone is not null;
notify pgrst, 'reload schema';
commit;
