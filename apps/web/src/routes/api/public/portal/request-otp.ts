import { createFileRoute } from "@tanstack/react-router";
import { parsePortalIdentifier, portalIdentifierInput } from "@/lib/portal-identifier";
import { randomInt, createHash } from "node:crypto";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Schema = portalIdentifierInput;

const OTP_TTL_MS = 10 * 60 * 1000;

export const Route = createFileRoute("/api/public/portal/request-otp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        // Tight limits: this is the entry point of an auth flow.
        const ipLimit = await checkRateLimit(`portal-request-otp:ip:${ip}`, 8, 10 * 60 * 1000);
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
        const identifier = parsePortalIdentifier(parsed.data);
        if (!identifier.success)
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });
        const { field, value } = identifier.data;

        const identifierLimit = await checkRateLimit(
          `portal-request-otp:${field}:${value}`,
          5,
          15 * 60 * 1000,
        );
        if (!identifierLimit.allowed)
          return rateLimitedResponse(identifierLimit.retryAfterSeconds, CORS);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: contacts, error: contactError } = await supabaseAdmin
          .from("contacts")
          .select(
            "id, tenant_id, company_id, email, phone, can_open_tickets, is_portal_admin, is_portal_financial, is_active",
          )
          .eq(field, value)
          .not("company_id", "is", null)
          .eq("is_active", true)
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
          (!contact.can_open_tickets && !contact.is_portal_admin && !contact.is_portal_financial)
        ) {
          return genericResponse();
        }

        const contactLimit = await checkRateLimit(
          `portal-request-otp:contact:${contact.id}`,
          5,
          15 * 60 * 1000,
        );
        if (!contactLimit.allowed) return genericResponse();

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
            ...(field === "email" ? { email: value } : { phone: value }),
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

        const { deliverAuthCode } = await import("@/lib/auth-code-delivery.server");
        const delivered = await deliverAuthCode(contact, code);
        await supabaseAdmin
          .from("portal_otp_codes")
          .update(
            delivered
              ? { delivery_status: "sent", delivered_at: new Date().toISOString() }
              : {
                  delivery_status: "failed",
                  consumed_at: new Date().toISOString(),
                  delivery_error: "Nenhum canal confirmou o envio.",
                },
          )
          .eq("id", otpRow.id);
        return genericResponse();
      },
    },
  },
});
