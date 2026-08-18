-- Portal (customer) email OTP verification.
-- Contacts are not Supabase Auth users, so portal identity is proven by a
-- one-time code emailed to the contact's address, then exchanged for a
-- short-lived signed session token (see src/lib/portal-session.ts).

create table public.portal_otp_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index portal_otp_codes_email_idx on public.portal_otp_codes(email);
create index portal_otp_codes_contact_idx on public.portal_otp_codes(contact_id);
create index portal_otp_codes_expires_idx on public.portal_otp_codes(expires_at);

alter table public.portal_otp_codes enable row level security;
-- No policies: this table is only ever touched via the service-role client
-- (src/integrations/supabase/client.server.ts) from the request-otp/verify-otp
-- routes. anon/authenticated get zero access by default (RLS deny-all).
