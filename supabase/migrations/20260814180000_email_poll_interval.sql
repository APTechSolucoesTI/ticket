-- Per-tenant polling interval for the email channel. The pg_cron job itself
-- ticks every minute (finest cron granularity); pollAllTenants() decides,
-- per tenant, whether email_poll_interval_minutes have actually elapsed
-- since email_last_polled_at before spending an IMAP connection on it.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS email_poll_interval_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS email_last_polled_at timestamptz;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_email_poll_interval_minutes_check
  CHECK (email_poll_interval_minutes BETWEEN 1 AND 60);
