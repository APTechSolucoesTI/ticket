
-- 1. CSAT: replace anon policies with token-checked RPCs
DROP POLICY IF EXISTS "public read by token" ON public.csat_responses;
DROP POLICY IF EXISTS "public update by token" ON public.csat_responses;

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

-- 2. kb_categories: restrict anon read to categories with public published articles
DROP POLICY IF EXISTS "kb_categories public read" ON public.kb_categories;
CREATE POLICY "kb_categories public read" ON public.kb_categories
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.kb_articles a
    WHERE a.category_id = kb_categories.id
      AND a.is_public = true
      AND a.status = 'published'
  ));

-- 3. profiles: prevent self-update from changing tenant_id (or id)
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

-- 4. Reduce SECURITY DEFINER exposure to authenticated role
-- has_role & current_tenant_id can work as SECURITY INVOKER since authenticated
-- already has SELECT (RLS-scoped) on user_roles and profiles.
ALTER FUNCTION public.has_role(uuid, app_role) SECURITY INVOKER;
ALTER FUNCTION public.current_tenant_id() SECURITY INVOKER;

-- handle_new_user is a trigger only; revoke direct execution
REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

-- prevent_profile_tenant_change is trigger only
REVOKE ALL ON FUNCTION public.prevent_profile_tenant_change() FROM public, anon, authenticated;
