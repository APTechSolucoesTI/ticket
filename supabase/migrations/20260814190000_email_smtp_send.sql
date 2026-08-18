-- Outbound SMTP for the email channel — "Responder ao cliente" on an
-- email-origin ticket actually dispatches an email, instead of only saving a
-- message row. Reuses email_imap_user/email_imap_password as SMTP auth
-- (the common case: same mailbox account for receiving and sending).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS email_smtp_host text,
  ADD COLUMN IF NOT EXISTS email_smtp_port integer NOT NULL DEFAULT 587,
  ADD COLUMN IF NOT EXISTS email_smtp_secure boolean NOT NULL DEFAULT false;
