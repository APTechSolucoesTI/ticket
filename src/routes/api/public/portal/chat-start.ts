import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const Schema = z.object({
  subject: z.string().min(3).max(200).optional(),
  message: z.string().min(1).max(4000),
  contract_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/public/portal/chat-start")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-chat-start:ip:${ip}`, 30, 10 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds, CORS);

        const session = verifyPortalRequest(request);
        if (!session) {
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400, headers: CORS });
        }
        const parsed = Schema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "invalid_payload", issues: parsed.error.issues },
            { status: 400, headers: CORS },
          );
        }
        const data = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id, tenant_id, company_id, name, can_open_tickets, is_active")
          .eq("id", session.contact_id)
          .eq("tenant_id", session.tenant_id)
          .maybeSingle();

        if (!contact || !contact.company_id) {
          return Response.json({ error: "unknown_contact" }, { status: 403, headers: CORS });
        }
        if (contact.is_active === false || contact.can_open_tickets === false) {
          return Response.json({ error: "contact_not_allowed" }, { status: 403, headers: CORS });
        }

        const { data: contracts } = await supabaseAdmin
          .from("contracts")
          .select("id, sla_policy_id, includes_remote, includes_lab, includes_onsite")
          .eq("tenant_id", contact.tenant_id)
          .eq("company_id", contact.company_id)
          .eq("status", "active")
          .order("starts_at", { ascending: false });

        const eligible = (contracts ?? []).filter(
          (c) => c.includes_remote || c.includes_lab || c.includes_onsite,
        );
        const contract = data.contract_id
          ? eligible.find((c) => c.id === data.contract_id)
          : eligible[0];

        if (!contract) {
          return Response.json({ error: "no_active_contract" }, { status: 403, headers: CORS });
        }

        const subject =
          data.subject?.trim() || `Chat: ${data.message.slice(0, 80).replace(/\s+/g, " ").trim()}`;

        const { data: ticket, error: tErr } = await supabaseAdmin
          .from("tickets")
          .insert({
            tenant_id: contact.tenant_id,
            subject,
            status: "new",
            priority: "medium",
            channel: "chat",
            contact_id: contact.id,
            company_id: contact.company_id,
            contract_id: contract.id,
            sla_policy_id: contract.sla_policy_id ?? null,
            pending_type: "awaiting_tech",
          })
          .select("id, number")
          .single();

        if (tErr || !ticket) {
          console.error("[chat-start] insert error", tErr);
          return Response.json({ error: "insert_failed" }, { status: 500, headers: CORS });
        }

        const { error: msgErr } = await supabaseAdmin.from("messages").insert({
          tenant_id: contact.tenant_id,
          ticket_id: ticket.id,
          author_contact_id: contact.id,
          author_type: "contact",
          channel: "chat",
          is_internal: false,
          content: data.message,
          attachments: [],
        });
        if (msgErr) {
          console.error("[chat-start] message error", msgErr);
        }

        return Response.json(
          { ok: true, ticket_id: ticket.id, number: ticket.number },
          { status: 201, headers: CORS },
        );
      },
    },
  },
});
