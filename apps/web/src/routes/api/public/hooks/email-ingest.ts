import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { secureEquals } from "@/lib/secure-compare";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { processInboundEmail } from "@/lib/email-channel.server";

/**
 * Endpoint público de ingestão manual de e-mails -> tickets.
 *
 * Uso: integrações externas que já tenham um e-mail parseado (ex: forward
 * webhook de um provedor). Para caixas próprias configuradas por tenant,
 * veja o poller IMAP em src/lib/imap-poll.server.ts, disparado por
 * /api/public/hooks/email-imap-poll a cada poucos minutos via pg_cron.
 *
 * Autenticação: header `Authorization: Bearer <EMAIL_INGEST_SECRET>`.
 *
 * Regra de negócio: o e-mail só vira ticket se existir um contato com aquele
 * e-mail cadastrado e a empresa do contato possuir contrato ATIVO.
 */

const PayloadSchema = z.object({
  message_id: z.string().min(1),
  from_email: z.string().email(),
  from_name: z.string().optional().nullable(),
  subject: z.string().min(1).max(500),
  body: z.string().default(""),
  received_at: z.string().datetime().optional(),
});

export const Route = createFileRoute("/api/public/hooks/email-ingest")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
          },
        }),

      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`email-ingest:ip:${ip}`, 120, 5 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds);

        const secret = process.env.EMAIL_INGEST_SECRET;
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        if (!secret || !token || !secureEquals(token, secret)) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "invalid_json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ error: "invalid_payload", issues: parsed.error.issues }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        const data = parsed.data;

        const result = await processInboundEmail({
          message_id: data.message_id,
          from_email: data.from_email,
          from_name: data.from_name,
          subject: data.subject,
          body: data.body,
        });

        if (result.status === "error") {
          return new Response(JSON.stringify({ error: result.reason }), { status: 500 });
        }
        if (result.status === "skipped") {
          return new Response(
            JSON.stringify({ status: "skipped", reason: result.reason, email: data.from_email }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (result.status === "duplicate") {
          return new Response(
            JSON.stringify({ status: "duplicate", ticket_id: result.ticket_id }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ status: "created", ticket_id: result.ticket_id, number: result.number }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
