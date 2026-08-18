import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { signPortalToken } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const Schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "invalid_code_format"),
});

const MAX_ATTEMPTS = 5;

function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export const Route = createFileRoute("/api/public/portal/verify-otp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const ipLimit = checkRateLimit(`portal-verify-otp:ip:${ip}`, 15, 10 * 60 * 1000);
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
        const { code } = parsed.data;

        const emailLimit = checkRateLimit(`portal-verify-otp:email:${email}`, 10, 10 * 60 * 1000);
        if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retryAfterSeconds, CORS);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: otpRow } = await supabaseAdmin
          .from("portal_otp_codes")
          .select("id, contact_id, tenant_id, code_hash, expires_at, attempts, consumed_at")
          .eq("email", email)
          .is("consumed_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const fail = () =>
          Response.json(
            { ok: false, error: "invalid_or_expired_code" },
            { status: 401, headers: CORS },
          );

        if (!otpRow) return fail();
        if (new Date(otpRow.expires_at).getTime() < Date.now()) return fail();
        if (otpRow.attempts >= MAX_ATTEMPTS) return fail();

        const codeHash = createHash("sha256").update(code).digest("hex");
        const matches = hashesEqual(codeHash, otpRow.code_hash);

        if (!matches) {
          await supabaseAdmin
            .from("portal_otp_codes")
            .update({ attempts: otpRow.attempts + 1 })
            .eq("id", otpRow.id);
          return fail();
        }

        await supabaseAdmin
          .from("portal_otp_codes")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", otpRow.id);

        const token = signPortalToken({
          contact_id: otpRow.contact_id,
          tenant_id: otpRow.tenant_id,
          email,
        });

        return Response.json({ ok: true, token }, { status: 200, headers: CORS });
      },
    },
  },
});
