import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { randomInt, createHash } from "node:crypto";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Schema = z.object({ email: z.string().trim().email() });

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

        const { data: contacts, error: contactError } = await supabaseAdmin
          .from("contacts")
          .select("id, tenant_id, company_id, can_open_tickets, is_active")
          .ilike("email", email)
          .not("company_id", "is", null)
          .eq("is_active", true)
          .eq("can_open_tickets", true)
          .limit(2);

        // Always respond identically whether or not the contact exists -
        // otherwise this endpoint becomes an email-enumeration oracle.
        const genericResponse = () => Response.json({ ok: true }, { status: 200, headers: CORS });

        if (contactError) {
          console.error("[portal/request-otp] contact lookup error", contactError);
          return genericResponse();
        }

        // The public flow has no tenant selector. Refuse ambiguous identities
        // instead of silently choosing a contact from another organization.
        const contact = contacts?.length === 1 ? contacts[0] : null;

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
        const now = new Date().toISOString();

        const { error: invalidateError } = await supabaseAdmin
          .from("portal_otp_codes")
          .update({ consumed_at: now })
          .eq("contact_id", contact.id)
          .is("consumed_at", null);
        if (invalidateError) {
          console.error("[portal/request-otp] invalidate error", invalidateError);
          return genericResponse();
        }

        const { data: otpRow, error: insErr } = await supabaseAdmin
          .from("portal_otp_codes")
          .insert({
            tenant_id: contact.tenant_id,
            contact_id: contact.id,
            email,
            code_hash: codeHash,
            expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
            delivery_status: "sending",
          })
          .select("id")
          .single();
        if (insErr || !otpRow) {
          console.error("[portal/request-otp] insert error", insErr);
          return genericResponse();
        }

        try {
          const { sendMail } = await import("@/lib/mailer.server");
          const delivery = await sendMail({
            to: email,
            subject: "Código de acesso ao APTicket",
            text: `Seu código de verificação é ${code}. Ele expira em 10 minutos. Se você não solicitou este código, ignore este e-mail.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#172033"><h2 style="margin-bottom:8px">Acesso ao APTicket</h2><p>Use o código abaixo para confirmar seu acesso:</p><div style="margin:24px 0;padding:18px;border-radius:10px;background:#f3f6fb;text-align:center;font-size:30px;font-weight:700;letter-spacing:6px">${code}</div><p>Ele expira em 10 minutos.</p><p style="color:#64748b;font-size:13px">Se você não solicitou este código, ignore este e-mail.</p></div>`,
          });
          if (Array.isArray(delivery.accepted) && delivery.accepted.length === 0) {
            throw new Error("O servidor SMTP não aceitou o destinatário");
          }
          await supabaseAdmin
            .from("portal_otp_codes")
            .update({
              delivery_status: "sent",
              delivery_error: null,
              delivered_at: new Date().toISOString(),
            })
            .eq("id", otpRow.id);
          console.info("[portal/request-otp] mail accepted", {
            messageId: delivery.messageId,
            accepted: Array.isArray(delivery.accepted) ? delivery.accepted.length : undefined,
            rejected: Array.isArray(delivery.rejected) ? delivery.rejected.length : undefined,
          });
        } catch (mailErr) {
          console.error("[portal/request-otp] mail send error", mailErr);
          const deliveryError = mailErr instanceof Error ? mailErr.message : String(mailErr);
          await supabaseAdmin
            .from("portal_otp_codes")
            .update({
              consumed_at: new Date().toISOString(),
              delivery_status: "failed",
              delivery_error: deliveryError.slice(0, 1000),
            })
            .eq("id", otpRow.id);
          // Do not leak delivery failure details to the caller (enumeration/DoS surface).
        }

        return genericResponse();
      },
    },
  },
});
