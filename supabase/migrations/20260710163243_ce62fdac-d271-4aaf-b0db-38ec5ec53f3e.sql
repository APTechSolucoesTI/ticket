
ALTER TABLE public.contract_types
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'hours_package',
  ADD COLUMN IF NOT EXISTS equipment_min integer,
  ADD COLUMN IF NOT EXISTS equipment_max integer,
  ADD COLUMN IF NOT EXISTS price_per_equipment numeric(12,2),
  ADD COLUMN IF NOT EXISTS includes_remote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_lab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_onsite boolean NOT NULL DEFAULT false;

ALTER TABLE public.contract_types
  DROP CONSTRAINT IF EXISTS contract_types_billing_model_check;
ALTER TABLE public.contract_types
  ADD CONSTRAINT contract_types_billing_model_check
  CHECK (billing_model IN ('hours_package','per_equipment'));
