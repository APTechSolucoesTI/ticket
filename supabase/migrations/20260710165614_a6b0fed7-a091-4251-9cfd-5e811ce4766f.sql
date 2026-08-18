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
  ON public.contract_equipments FOR ALL
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_contract_equipments_contract ON public.contract_equipments(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_equipments_equipment ON public.contract_equipments(equipment_id);