ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address_neighborhood TEXT;

CREATE TABLE public.equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text,
  brand text,
  model text,
  serial_number text,
  asset_tag text,
  operating_system text,
  location text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  purchase_date date,
  warranty_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX equipments_tenant_idx ON public.equipments(tenant_id);
CREATE INDEX equipments_company_idx ON public.equipments(company_id);
CREATE INDEX equipments_contact_idx ON public.equipments(contact_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipments TO authenticated;
GRANT ALL ON public.equipments TO service_role;

ALTER TABLE public.equipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_equipments" ON public.equipments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_equipments_updated_at
  BEFORE UPDATE ON public.equipments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tickets_equipment_idx ON public.tickets(equipment_id);

ALTER TABLE public.equipments
  ADD COLUMN IF NOT EXISTS processor text,
  ADD COLUMN IF NOT EXISTS memory text,
  ADD COLUMN IF NOT EXISTS storage text,
  ADD COLUMN IF NOT EXISTS os_key text,
  ADD COLUMN IF NOT EXISTS office_key text;

CREATE TABLE public.ticket_equipments (
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, equipment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_equipments TO authenticated;
GRANT ALL ON public.ticket_equipments TO service_role;

ALTER TABLE public.ticket_equipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_ticket_equipments" ON public.ticket_equipments
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX idx_ticket_equipments_ticket ON public.ticket_equipments(ticket_id);
CREATE INDEX idx_ticket_equipments_equipment ON public.ticket_equipments(equipment_id);

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS pending_type text
  CHECK (pending_type IN ('awaiting_tech','awaiting_customer','tech_response'));

ALTER TABLE public.time_entries ADD COLUMN IF NOT EXISTS ended_at timestamptz;

ALTER TABLE public.kb_articles ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contract_types
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'hours_package',
  ADD COLUMN IF NOT EXISTS equipment_min integer,
  ADD COLUMN IF NOT EXISTS equipment_max integer,
  ADD COLUMN IF NOT EXISTS price_per_equipment numeric(12,2),
  ADD COLUMN IF NOT EXISTS includes_remote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_lab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_onsite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS equipment_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contract_types
  DROP CONSTRAINT IF EXISTS contract_types_billing_model_check;
ALTER TABLE public.contract_types
  ADD CONSTRAINT contract_types_billing_model_check
  CHECK (billing_model IN ('hours_package','per_equipment'));

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'hours_package' CHECK (billing_model IN ('hours_package','per_equipment')),
  ADD COLUMN IF NOT EXISTS equipment_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS includes_remote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_lab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_onsite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS public.contract_equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, equipment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_equipments TO authenticated;
GRANT ALL ON public.contract_equipments TO service_role;

ALTER TABLE public.contract_equipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant isolation contract_equipments"
  ON public.contract_equipments FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_contract_equipments_contract ON public.contract_equipments(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_equipments_equipment ON public.contract_equipments(equipment_id);

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS state_registration text,
  ADD COLUMN IF NOT EXISTS municipal_registration text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS support_email text,
  ADD COLUMN IF NOT EXISTS support_phone text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS address_district text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_country text DEFAULT 'BR',
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS business_hours_start time,
  ADD COLUMN IF NOT EXISTS business_hours_end time,
  ADD COLUMN IF NOT EXISTS business_days text[] DEFAULT ARRAY['mon','tue','wed','thu','fri'],
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_base_url text,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_token text,
  ADD COLUMN IF NOT EXISTS whatsapp_uazapi_instance text,
  ADD COLUMN IF NOT EXISTS whatsapp_connected_number text,
  ADD COLUMN IF NOT EXISTS whatsapp_webhook_secret text;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text;

CREATE INDEX IF NOT EXISTS idx_messages_external_id ON public.messages(external_id) WHERE external_id IS NOT NULL;

ALTER TABLE public.contacts ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN email DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_pending ON public.contacts(tenant_id) WHERE company_id IS NULL;

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

CREATE TABLE public.stickers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stickers TO authenticated;
GRANT ALL ON public.stickers TO service_role;

ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_stickers" ON public.stickers
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_stickers_updated_at
  BEFORE UPDATE ON public.stickers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_stickers_tenant ON public.stickers(tenant_id);