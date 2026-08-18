
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_base_url text,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_instance text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_webhook_secret text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text;

CREATE INDEX IF NOT EXISTS idx_messages_external_id ON public.messages(external_id) WHERE external_id IS NOT NULL;
