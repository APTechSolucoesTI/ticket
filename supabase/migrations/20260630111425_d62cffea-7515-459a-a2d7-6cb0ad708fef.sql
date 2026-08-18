ALTER TABLE public.equipments
  ADD COLUMN IF NOT EXISTS os_key text,
  ADD COLUMN IF NOT EXISTS office_key text;