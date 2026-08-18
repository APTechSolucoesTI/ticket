-- "Fila de E-mail" — mirrors public.whatsapp_pending_messages, same pattern:
-- unknown/blocked/no-contract senders get queued here with an auto-created
-- pending contact (company_id null, can_open_tickets false) so an agent can
-- review, link to a client + contract, block, or delete.

CREATE TABLE public.email_pending_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT,
  content TEXT NOT NULL,
  message_id TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_pending_messages TO authenticated;
GRANT ALL ON public.email_pending_messages TO service_role;

ALTER TABLE public.email_pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members manage pending email"
  ON public.email_pending_messages
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_email_pending_tenant_unresolved
  ON public.email_pending_messages(tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;
