import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserId } from "@/lib/session";

/**
 * Returns the tenant_id of the currently logged in user.
 * Admins can read every profile of the organization, so the query
 * MUST be scoped by the current user id.
 */
export async function getMyTenantId(): Promise<string | null> {
  const uid = getCurrentUserId();
  if (!uid) return null;
  const { data } = await supabase.from("profiles").select("tenant_id").eq("id", uid).maybeSingle();
  return data?.tenant_id ?? null;
}
