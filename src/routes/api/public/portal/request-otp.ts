import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { randomInt, createHash } from "node:crypto";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Schema = z.object({ email: z.string().email() });

const OTP_TTL_MS = 10 * 60 * 1000;

export const Route = createFileRoute("/api/public/portal/request-otp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        // Tight limits: this is the entry point of an auth flow.
        const ipLimit = checkRateLimit(`portal-request-otp:ip:${ip}`, 8, 10 * 60 * 1000);
        if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds, CORS);

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
        const email = parsed.data.email.toLowerCase();

        const emailLimit = checkRateLimit(`portal-request-otp:email:${email}`, 5, 10 * 60 * 1000);
        if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retryAfterSeconds, CORS);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: contact } = await supabaseAdmin
          .from("contacts")
          .select("id, tenant_id, company_id, can_open_tickets, is_active")
          .ilike("email", email)
          .maybeSingle();

        // Always respond identically whether or not the contact exists —
        // otherwise this endpoint becomes an email-enumeration oracle.
        const genericResponse = () => Response.json({ ok: true }, { status: 200, headers: CORS });

        if (
          !contact ||
          !contact.company_id ||
          contact.is_active === false ||
          contact.can_open_tickets === false
        ) {
          return genericResponse();
        }

        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = createHash("sha256").update(code).digest("hex");

        const { error: insErr } = await supabaseAdmin.from("portal_otp_codes").insert({
          tenant_id: contact.tenant_id,
          contact_id: contact.id,
          email,
          code_hash: codeHash,
          expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
        });
        if (insErr) {
          console.error("[portal/request-otp] insert error", insErr);
          return genericResponse();
        }

        try {
          const { sendMail } = await import("@/lib/mailer.server");
          await sendMail({
            to: email,
            subject: `Seu código de acesso: ${code}`,
            text: `Seu código de verificação é ${code}. Ele expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.`,
            html: `<p>Seu código de verificação é:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>Ele expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.</p>`,
          });
        } catch (mailErr) {
          console.error("[portal/request-otp] mail send error", mailErr);
          // Do not leak delivery failure details to the caller (enumeration/DoS surface).
        }

        return genericResponse();
      },
    },
  },
});
