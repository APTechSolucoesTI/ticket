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
  ticket_id: z.string().uuid(),
});

export const Route = createFileRoute("/api/public/portal/ticket-detail")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-ticket-detail:ip:${ip}`, 60, 10 * 60 * 1000);
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
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
        }
        const { ticket_id } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: ticket } = await supabaseAdmin
          .from("tickets")
          .select("id, number, subject, status, priority, channel, created_at, updated_at")
          .eq("id", ticket_id)
          .eq("tenant_id", session.tenant_id)
          .eq("contact_id", session.contact_id)
          .maybeSingle();

        if (!ticket) {
          return Response.json({ error: "not_found" }, { status: 404, headers: CORS });
        }

        const { data: ticketEquipments } = await supabaseAdmin
          .from("ticket_equipments")
          .select("equipment:equipments(id, name, brand, model, serial_number, asset_tag)")
          .eq("ticket_id", ticket_id)
          .eq("tenant_id", session.tenant_id);

        const equipments = (ticketEquipments ?? [])
          .map((te) => te.equipment)
          .filter((e): e is NonNullable<typeof e> => !!e);

        const { data: messages } = await supabaseAdmin
          .from("messages")
          .select(
            "id, content, author_type, author_id, author_contact_id, channel, is_internal, created_at, attachments",
          )
          .eq("ticket_id", ticket_id)
          .eq("tenant_id", session.tenant_id)
          .eq("is_internal", false)
          .order("created_at", { ascending: true });

        const agentIds = Array.from(
          new Set((messages ?? []).map((m) => m.author_id).filter(Boolean)),
        ) as string[];
        let agentMap: Record<string, string> = {};
        if (agentIds.length) {
          const { data: profs } = await supabaseAdmin
            .from("profiles")
            .select("id, name")
            .in("id", agentIds);
          agentMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p.name as string]));
        }

        const enriched = await Promise.all(
          (messages ?? []).map(async (m) => {
            const atts = Array.isArray(m.attachments)
              ? (m.attachments as Array<{ path: string; name: string; size: number; type: string }>)
              : [];
            const signed = await Promise.all(
              atts.map(async (a) => {
                const { data } = await supabaseAdmin.storage
                  .from("ticket-attachments")
                  .createSignedUrl(a.path, 60 * 60);
                return { name: a.name, size: a.size, type: a.type, url: data?.signedUrl ?? null };
              }),
            );
            return {
              ...m,
              author_name:
                m.author_type === "contact"
                  ? "Você"
                  : m.author_id
                    ? (agentMap[m.author_id] ?? "Atendente")
                    : "Sistema",
              attachments: signed,
            };
          }),
        );

        return Response.json(
          { ticket, equipments, messages: enriched },
          { status: 200, headers: CORS },
        );
      },
    },
  },
});
