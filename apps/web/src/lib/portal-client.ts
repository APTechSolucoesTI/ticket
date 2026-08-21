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
  const response = await fetch("/api/public/portal/request-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (response.status === 429) {
    throw new Error("Muitas tentativas. Aguarde alguns minutos antes de reenviar.");
  }
  if (!response.ok) {
    throw new Error("Não foi possível solicitar o código. Tente novamente.");
  }
  // A successful request remains intentionally indistinguishable for registered
  // and unknown addresses; transport and rate-limit failures still reach the UI.
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
