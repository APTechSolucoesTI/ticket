CREATE TABLE public.whatsapp_pending_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  content TEXT NOT NULL,
  external_id TEXT,
  payload JSONB,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_pending_messages TO authenticated;
GRANT ALL ON public.whatsapp_pending_messages TO service_role;

ALTER TABLE public.whatsapp_pending_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members manage pending whatsapp"
  ON public.whatsapp_pending_messages
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_wa_pending_tenant_unresolved
  ON public.whatsapp_pending_messages(tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;