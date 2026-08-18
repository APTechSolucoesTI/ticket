ALTER TABLE public.csat_responses
  ADD COLUMN IF NOT EXISTS token text UNIQUE,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_csat_by_token(_token text)
RETURNS TABLE(id uuid, rating int, responded_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, rating, responded_at FROM public.csat_responses
  WHERE token = _token AND _token IS NOT NULL AND length(_token) >= 16
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_csat(_token text, _rating int, _comment text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _token IS NULL OR length(_token) < 16 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;
  IF _rating IS NULL OR _rating < 1 OR _rating > 5 THEN
    RAISE EXCEPTION 'invalid rating';
  END IF;
  UPDATE public.csat_responses
    SET rating = _rating,
        comment = NULLIF(_comment, ''),
        responded_at = now()
    WHERE token = _token AND responded_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found or already answered';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_csat_by_token(text) FROM public;
REVOKE ALL ON FUNCTION public.submit_csat(text, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_csat_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_csat(text, int, text) TO anon, authenticated;

DROP POLICY IF EXISTS "kb_categories public read" ON public.kb_categories;
CREATE POLICY "kb_categories public read" ON public.kb_categories
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.kb_articles a
    WHERE a.category_id = kb_categories.id
      AND a.is_public = true
      AND a.status = 'published'
  ));

CREATE OR REPLACE FUNCTION public.prevent_profile_tenant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'cannot change tenant_id or id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_tenant_change ON public.profiles;
CREATE TRIGGER profiles_prevent_tenant_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_tenant_change();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_profile_tenant_change() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;