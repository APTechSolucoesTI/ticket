ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS billing_model text NOT NULL DEFAULT 'hours_package' CHECK (billing_model IN ('hours_package','per_equipment')),
  ADD COLUMN IF NOT EXISTS equipment_tiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS includes_remote boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_lab boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS includes_onsite boolean NOT NULL DEFAULT false;