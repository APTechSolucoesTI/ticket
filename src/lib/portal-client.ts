// Browser-side helpers for the customer portal's OTP-authenticated session.
// The token is issued by /api/public/portal/verify-otp after the contact
// proves ownership of their email; every other portal call must carry it.

const TOKEN_KEY = "apticket_portal_token_v1";

export function getPortalToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setPortalToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Fetch wrapper that attaches the portal bearer token. Returns the raw Response. */
export async function portalFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getPortalToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

export async function requestPortalOtp(email: string): Promise<void> {
  await fetch("/api/public/portal/request-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  // Always resolves — the endpoint intentionally responds the same way whether
  // or not the email is registered, to avoid leaking which emails exist.
}

export async function verifyPortalOtp(
  email: string,
  code: string,
): Promise<{ ok: boolean; token?: string }> {
  const res = await fetch("/api/public/portal/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) return { ok: false };
  setPortalToken(json.token as string);
  return { ok: true, token: json.token as string };
}
