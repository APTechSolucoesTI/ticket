import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyPortalRequest } from "@/lib/portal-session";

/** A signed token proves identity, but does not preserve access after deactivation. */
export async function authorizePortalRequest(request: Request) {
  const session = verifyPortalRequest(request);
  if (!session) return null;

  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select(
      "id, tenant_id, company_id, name, email, can_open_tickets, is_portal_admin, is_portal_financial, is_active, companies(name)",
    )
    .eq("id", session.contact_id)
    .eq("tenant_id", session.tenant_id)
    .maybeSingle();

  if (error || !contact?.is_active || !contact.company_id) return null;
  return { session, contact: { ...contact, company_id: contact.company_id } };
}
