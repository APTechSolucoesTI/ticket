GRANT SELECT ON public.kb_articles TO anon;
GRANT SELECT ON public.kb_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_articles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kb_categories TO authenticated;
GRANT ALL ON public.kb_articles TO service_role;
GRANT ALL ON public.kb_categories TO service_role;