import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const Schema = z.object({ document_id: z.string().uuid() });

export const Route = createFileRoute("/api/public/portal/document-download")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const limit = checkRateLimit(
          `portal-document-download:${clientIp(request)}`,
          40,
          10 * 60 * 1000,
        );
        if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds, CORS);
        const session = verifyPortalRequest(request);
        if (!session)
          return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS });
        const parsed = Schema.safeParse(await request.json().catch(() => null));
        if (!parsed.success)
          return Response.json({ error: "invalid_payload" }, { status: 400, headers: CORS });

        const baseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!baseUrl || !serviceKey) {
          return Response.json({ error: "not_configured" }, { status: 500, headers: CORS });
        }
        const response = await fetch(`${baseUrl}/functions/v1/client-document-download`, {
          method: "POST",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            document_id: parsed.data.document_id,
            contact_id: session.contact_id,
            tenant_id: session.tenant_id,
          }),
        });
        const result = await response.json().catch(() => ({}));
        return Response.json(result, { status: response.status, headers: CORS });
      },
    },
  },
});
