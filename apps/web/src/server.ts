import "./lib/error-capture";
import { randomBytes } from "node:crypto";
import { withSecurityHeaders } from "./lib/security-headers.server";
import { withAuthRateLimitHeaders } from "./lib/auth-rate-limit.server";
import { boundedBody } from "./lib/bounded-body.server";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} - try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const nonce = randomBytes(24).toString("base64");
    // Nitro wraps Request in a proxy; the native Request copy constructor
    // cannot read its private Undici fields. Overwrite this per-request header.
    request.headers.set("x-apticket-csp-nonce", nonce);
    if (request.method === "POST" && new URL(request.url).pathname.startsWith("/_serverFn/")) {
      try {
        // Avatar JSON is at most 2 MiB encoded as base64. Bound the actual
        // stream before TanStack deserializes it, including chunked requests.
        const bytes = await boundedBody(request, 4 * 1024 * 1024);
        request = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bytes,
          signal: request.signal,
        });
      } catch {
        return withSecurityHeaders(
          Response.json({ error: "request_body_too_large" }, { status: 413 }),
          nonce,
        );
      }
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(
        withAuthRateLimitHeaders(request, await normalizeCatastrophicSsrResponse(response)),
        nonce,
      );
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        nonce,
      );
    }
  },
};
