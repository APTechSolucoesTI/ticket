import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/portal/session")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-session:ip:${ip}`, 60, 10 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds, CORS);

        // Identity comes from a token proven by OTP (see request-otp/verify-otp),
        // never from a client-supplied email - that was the account-takeover bug.
        const session = verifyPortalRequest(request);
        if (!session) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select(
            "id, tenant_id, company_id, name, email, can_open_tickets, is_active, companies(name)",
          )
          .eq("id", session.contact_id)
          .eq("tenant_id", session.tenant_id)
          .maybeSingle();

        if (!contact || !contact.company_id) {
          return Response.json({ found: false }, { status: 200, headers: CORS });
        }

        const { data: contractsRaw } = await supabaseAdmin
          .from("contracts")
          .select(
            "id, description, starts_at, ends_at, includes_remote, includes_lab, includes_onsite, contract_equipments(equipment_id), contract_types(name)",
          )
          .eq("tenant_id", contact.tenant_id)
          .eq("company_id", contact.company_id)
          .eq("status", "active")
          .order("starts_at", { ascending: false });

        const activeContracts = (contractsRaw ?? []).filter(
          (c) => c.includes_remote || c.includes_lab || c.includes_onsite,
        );

        const contracts = activeContracts.map((c) => ({
          id: c.id,
          name:
            (c as { contract_types?: { name?: string | null } | null }).contract_types?.name ??
            "Contrato",
          description: c.description ?? null,
          starts_at: c.starts_at,
          ends_at: c.ends_at,
          equipment_ids: (
            (c as { contract_equipments?: { equipment_id: string }[] }).contract_equipments ?? []
          ).map((e) => e.equipment_id),
        }));

        const { data: tickets } = await supabaseAdmin
          .from("tickets")
          .select("id, number, subject, status, priority, created_at, pending_type")
          .eq("tenant_id", contact.tenant_id)
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false })
          .limit(500);

        const { data: equipments } = await supabaseAdmin
          .from("equipments")
          .select("id, name, contact_id")
          .eq("tenant_id", contact.tenant_id)
          .eq("company_id", contact.company_id)
          .order("name", { ascending: true });

        return Response.json(
          {
            found: true,
            contact: {
              id: contact.id,
              name: contact.name,
              email: contact.email,
              company_name:
                (contact as { companies?: { name?: string | null } | null }).companies?.name ??
                null,
              can_open_tickets: contact.can_open_tickets !== false && contact.is_active !== false,
            },
            has_active_contract: contracts.length > 0,
            contracts,
            tickets: tickets ?? [],
            equipments: equipments ?? [],
          },
          { headers: CORS },
        );
      },
    },
  },
});
