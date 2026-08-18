/**
 * In-memory, fixed-window rate limiter for public (unauthenticated) API routes.
 *
 * LIMITATION: state lives in process memory. It resets on deploy/restart and does
 * NOT share state across multiple server instances. For a horizontally-scaled
 * deployment, replace with a shared store (Redis/Upstash) or a Kong rate-limiting
 * plugin in front of these routes. For this single-instance self-hosted deployment
 * it is a real mitigation against casual brute-force / enumeration.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodic cleanup so the map doesn't grow unbounded.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();
function cleanupIfDue(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Checks and increments a fixed-window counter for `key`.
 * Returns allowed:false once `limit` hits have been recorded inside `windowMs`.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  cleanupIfDue(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort client IP extraction behind Kong/reverse proxies. */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/** Builds a standard 429 response with Retry-After, merging extra CORS/headers. */
export function rateLimitedResponse(
  retryAfterSeconds: number,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(
    { error: "rate_limited", retry_after_seconds: retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        ...extraHeaders,
      },
    },
  );
}
