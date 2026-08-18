
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS pending_type text
  CHECK (pending_type IN ('awaiting_tech','awaiting_customer','tech_response'));
