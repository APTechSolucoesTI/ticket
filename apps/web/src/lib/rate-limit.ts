import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Atomic shared store; outages deny access instead of restoring local quotas. */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("unavailable");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("consume_security_rate_limit", {
      _key_hash: createHmac("sha256", secret).update(`rate-limit:v1:${key}`).digest("hex"),
      _limit: limit,
      _window_ms: windowMs,
    });
    const result = data as unknown;
    if (
      error ||
      !result ||
      typeof result !== "object" ||
      !("allowed" in result) ||
      typeof result.allowed !== "boolean" ||
      !("retry_after_seconds" in result) ||
      typeof result.retry_after_seconds !== "number" ||
      !Number.isFinite(result.retry_after_seconds)
    ) {
      throw new Error("unavailable");
    }
    return { allowed: result.allowed, retryAfterSeconds: Math.max(0, result.retry_after_seconds) };
  } catch {
    console.warn("[security] shared rate limiter unavailable");
    return { allowed: false, retryAfterSeconds: 30 };
  }
}

/** Traefik is the single ingress and appends the peer to X-Forwarded-For.
 * Use its rightmost address, never a client-supplied prefix. Containers must
 * remain unpublished; additional trusted proxy hops require an explicit policy.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;
  const real = request.headers.get("x-real-ip")?.trim();
  return real && isIP(real) ? real : "unknown";
}

export function rateLimitedResponse(
  retryAfterSeconds: number,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(
    { error: "rate_limited", retry_after_seconds: retryAfterSeconds },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds), ...extraHeaders },
    },
  );
}
