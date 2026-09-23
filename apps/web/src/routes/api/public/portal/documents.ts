import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/portal/documents")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const limit = checkRateLimit(`portal-documents:${clientIp(request)}`, 60, 10 * 60 * 1000);
        if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds, CORS);
        const session = verifyPortalRequest(request);
        if (!session)
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id,tenant_id,company_id,is_active,is_portal_financial")
          .eq("id", session.contact_id)
          .eq("tenant_id", session.tenant_id)
          .maybeSingle();
        if (!contact?.is_active || !contact.is_portal_financial || !contact.company_id) {
          return Response.json({ error: "forbidden" }, { status: 403, headers: CORS });
        }

        const { data: companyLinks } = await supabaseAdmin
          .from("contact_companies")
          .select("company_id")
          .eq("contact_id", contact.id)
          .eq("tenant_id", contact.tenant_id);
        const companyIds = Array.from(
          new Set([contact.company_id, ...(companyLinks ?? []).map((link) => link.company_id)]),
        );

        const { data, error } = await supabaseAdmin
          .from("client_documents")
          .select("id,document_type,competencia,historico,file_name,file_size,mime_type,created_at")
          .eq("tenant_id", contact.tenant_id)
          .in("company_id", companyIds)
          .is("deleted_at", null)
          .order("competencia", { ascending: false })
          .order("created_at", { ascending: false });
        if (error) {
          console.error("[portal/documents] list error", error);
          return Response.json({ error: "query_failed" }, { status: 500, headers: CORS });
        }
        return Response.json({ documents: data ?? [] }, { headers: CORS });
      },
    },
  },
});
