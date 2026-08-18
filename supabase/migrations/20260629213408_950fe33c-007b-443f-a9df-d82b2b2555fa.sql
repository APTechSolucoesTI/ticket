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

-- Backfill from existing tickets.equipment_id
INSERT INTO public.ticket_equipments (ticket_id, equipment_id, tenant_id)
SELECT id, equipment_id, tenant_id FROM public.tickets
WHERE equipment_id IS NOT NULL
ON CONFLICT DO NOTHING;