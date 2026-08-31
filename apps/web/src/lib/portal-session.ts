// Server-only. Short-lived, HMAC-signed session token issued after a portal
// contact proves ownership of their email via OTP (see routes/api/public/portal
// /request-otp.ts and verify-otp.ts). This token - not a client-supplied email -
// is what the rest of the portal endpoints trust to identify the caller.
import { createHmac, timingSafeEqual } from "node:crypto";

export type PortalSessionPayload = {
  contact_id: string;
  tenant_id: string;
  email: string;
  exp: number; // unix seconds
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function getSecret(): string {
  const secret = process.env.PORTAL_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing PORTAL_SESSION_SECRET environment variable.");
  }
  return secret;
}

export function signPortalToken(
  data: Omit<PortalSessionPayload, "exp">,
  ttlSeconds = 30 * 60,
): string {
  const payload: PortalSessionPayload = {
    ...data,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = base64url(JSON.stringify(payload));
  const sig = base64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPortalToken(token: string | null | undefined): PortalSessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expectedSig = base64url(createHmac("sha256", getSecret()).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: PortalSessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null; // expired
  }
  if (!payload.contact_id || !payload.tenant_id || !payload.email) return null;
  return payload;
}

/** Extracts and verifies the bearer token from a request's Authorization header. */
export function verifyPortalRequest(request: Request): PortalSessionPayload | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return verifyPortalToken(token || null);
}
