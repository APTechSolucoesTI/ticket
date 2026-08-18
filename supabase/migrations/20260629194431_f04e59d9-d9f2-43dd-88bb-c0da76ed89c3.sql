
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
