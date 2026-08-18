ALTER TABLE public.contacts ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN email DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_pending ON public.contacts(tenant_id) WHERE company_id IS NULL;