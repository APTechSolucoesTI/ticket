
GRANT SELECT ON public.kb_articles TO anon;
GRANT SELECT ON public.kb_categories TO anon;

CREATE POLICY "kb_categories public read"
ON public.kb_categories FOR SELECT
TO anon
USING (true);
