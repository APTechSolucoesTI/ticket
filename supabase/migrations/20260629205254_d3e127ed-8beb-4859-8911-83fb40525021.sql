ALTER TABLE public.equipments
  ADD COLUMN IF NOT EXISTS processor text,
  ADD COLUMN IF NOT EXISTS memory text,
  ADD COLUMN IF NOT EXISTS storage text;