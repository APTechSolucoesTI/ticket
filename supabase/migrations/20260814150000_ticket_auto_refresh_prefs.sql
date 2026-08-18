-- Per-user preference for the ticket list's auto-refresh countdown.
-- Lives on public.profiles (one row per auth user) so it follows the user
-- across devices/sessions, not just the current browser.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tickets_auto_refresh_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tickets_auto_refresh_seconds integer NOT NULL DEFAULT 10;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_tickets_auto_refresh_seconds_check
  CHECK (tickets_auto_refresh_seconds BETWEEN 5 AND 300);
