-- Email channel (IMAP receiving), mirroring the whatsapp_* columns/pattern
-- already used for the WhatsApp/UAZAPI channel on public.tenants.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_inbox_address text,
  ADD COLUMN IF NOT EXISTS email_imap_host text,
  ADD COLUMN IF NOT EXISTS email_imap_port integer NOT NULL DEFAULT 993,
  ADD COLUMN IF NOT EXISTS email_imap_user text,
  ADD COLUMN IF NOT EXISTS email_imap_password text,
  ADD COLUMN IF NOT EXISTS email_imap_secure boolean NOT NULL DEFAULT true;
