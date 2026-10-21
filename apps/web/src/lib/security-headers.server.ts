export function withSecurityHeaders(response: Response, nonce: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), geolocation=(self), payment=()",
  );
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: data: https:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' blob: https:",
      "worker-src 'self' blob:",
    ].join("; "),
  );
  // No includeSubDomains: other applications share the operator's domain.
  if (process.env.PUBLIC_SITE_URL?.startsWith("https://")) {
    headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  // A fresh nonce is generated per HTML response; never cache it across users.
  if (headers.get("content-type")?.includes("text/html"))
    headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
