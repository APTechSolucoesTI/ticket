begin;

create or replace function apticket.normalize_brazil_phone(value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  with cleaned as (
    select regexp_replace(value, '[^0-9]', '', 'g') as digits
  )
  select case
    when digits ~ '^[0-9]{10,11}$' then '55' || digits
    when digits ~ '^55[0-9]{10,11}$' then digits
    else value
  end
  from cleaned;
$$;

update apticket.companies
set phone = apticket.normalize_brazil_phone(phone)
where phone is not null and btrim(phone) <> '';

update apticket.contacts
set phone = apticket.normalize_brazil_phone(phone)
where phone is not null and btrim(phone) <> '';

update apticket.tenants
set
  phone = apticket.normalize_brazil_phone(phone),
  whatsapp = apticket.normalize_brazil_phone(whatsapp),
  support_phone = apticket.normalize_brazil_phone(support_phone),
  whatsapp_connected_number = apticket.normalize_brazil_phone(whatsapp_connected_number);

update apticket.whatsapp_pending_messages
set phone = apticket.normalize_brazil_phone(phone)
where phone is not null and btrim(phone) <> '';

drop function apticket.normalize_brazil_phone(text);

commit;
