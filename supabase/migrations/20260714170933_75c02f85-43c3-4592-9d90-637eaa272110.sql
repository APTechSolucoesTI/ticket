
ALTER TABLE public.csat_responses
  ADD COLUMN IF NOT EXISTS token text UNIQUE,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Public policies for anon access via token
GRANT SELECT, UPDATE (rating, comment, responded_at) ON public.csat_responses TO anon;

DROP POLICY IF EXISTS "public read by token" ON public.csat_responses;
CREATE POLICY "public read by token" ON public.csat_responses
  FOR SELECT TO anon USING (token IS NOT NULL);

DROP POLICY IF EXISTS "public update by token" ON public.csat_responses;
CREATE POLICY "public update by token" ON public.csat_responses
  FOR UPDATE TO anon USING (token IS NOT NULL AND responded_at IS NULL)
  WITH CHECK (token IS NOT NULL);
