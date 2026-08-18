ALTER TABLE public.contract_types
  ADD COLUMN IF NOT EXISTS service_items jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS service_items jsonb NOT NULL DEFAULT '[]'::jsonb;