import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const retryHeaders = new WeakMap<Headers, number>();

// The current Start serializer preserves response status but rebuilds its
// headers. Carry Retry-After through the outer server entry without accepting
// a client-provided header or changing the serialized error contract.
export function withAuthRateLimitHeaders(request: Request, response: Response): Response {
  const retry = retryHeaders.get(request.headers);
  retryHeaders.delete(request.headers);
  if (response.status === 429 && retry) response.headers.set("Retry-After", String(retry));
  return response;
}

/** Identifiers are HMACed by the shared limiter; no email/token/IP is logged. */
export async function enforceAuthRateLimit(
  action: "login" | "recovery" | "reset" | "invite" | "signup",
  identity?: string,
): Promise<void> {
  const origin = clientIp(getRequest());
  const originQuota = await checkRateLimit(
    `auth:${action}:origin:${origin}`,
    action === "signup" ? 5 : 100,
    action === "signup" ? 60 * 60 * 1000 : FIFTEEN_MINUTES,
  );
  const identityQuota =
    identity && originQuota.allowed
      ? await checkRateLimit(
          `auth:${action}:identity:${identity}`,
          action === "login" ? 10 : 5,
          FIFTEEN_MINUTES,
        )
      : originQuota;
  if (!originQuota.allowed || !identityQuota.allowed) {
    const retry = Math.max(originQuota.retryAfterSeconds, identityQuota.retryAfterSeconds, 1);
    setResponseStatus(429);
    setResponseHeader("Retry-After", String(retry));
    retryHeaders.set(getRequest().headers, retry);
    throw new Error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
  }
}
