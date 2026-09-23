import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { verifyPortalRequest } from "@/lib/portal-session";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
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
        const result = (await response.json().catch(() => ({}))) as {
          url?: string;
          file_name?: string;
          message?: string;
        };
        if (!response.ok || !result.url) {
          return Response.json(result, { status: response.status, headers: CORS });
        }

        // A URL assinada usa o endereço interno do Supabase no ambiente self-hosted.
        // O servidor consegue acessá-la; o navegador externo não. Por isso o arquivo
        // é transmitido por esta rota depois que a Edge Function autoriza e audita.
        const signedUrl = new URL(result.url);
        const reachableUrl = new URL(
          `${signedUrl.pathname}${signedUrl.search}`,
          baseUrl,
        ).toString();
        const fileResponse = await fetch(reachableUrl);
        if (!fileResponse.ok || !fileResponse.body) {
          return Response.json({ error: "download_unavailable" }, { status: 502, headers: CORS });
        }
        const safeName = (result.file_name || "documento").replace(/[\r\n"]/g, "_");
        const headers = new Headers(CORS);
        headers.set(
          "Content-Type",
          fileResponse.headers.get("Content-Type") || "application/octet-stream",
        );
        headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        );
        headers.set("Cache-Control", "private, no-store");
        const length = fileResponse.headers.get("Content-Length");
        if (length) headers.set("Content-Length", length);
        return new Response(fileResponse.body, { status: 200, headers });
      },
    },
  },
});
