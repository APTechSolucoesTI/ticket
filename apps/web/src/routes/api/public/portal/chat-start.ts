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
  subject: z.string().trim().min(3).max(200).optional(),
  message: z.string().trim().min(1).max(4000),
  contract_id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/public/portal/chat-start")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = await checkRateLimit(`portal-chat-start:ip:${ip}`, 30, 10 * 60 * 1000);
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

        const { data: ticket, error } = await supabaseAdmin
          .rpc("create_portal_chat", {
            _tenant_id: session.tenant_id,
            _contact_id: session.contact_id,
            _message: data.message,
            _subject: data.subject ?? null,
            _contract_id: data.contract_id ?? null,
          })
          .single();
        if (error || !ticket) {
          if (error?.code === "42501") {
            return Response.json({ error: "contact_not_allowed" }, { status: 403, headers: CORS });
          }
          if (error?.code === "22023") {
            return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
          }
          console.error("[chat-start] transaction failed", { code: error?.code });
          return Response.json({ error: "insert_failed" }, { status: 500, headers: CORS });
        }

        return Response.json(
          { ok: true, ticket_id: ticket.ticket_id, number: ticket.number },
          { status: 201, headers: CORS },
        );
      },
    },
  },
});
