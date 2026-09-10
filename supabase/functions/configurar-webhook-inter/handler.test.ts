import { assertEquals } from "jsr:@std/assert@1";
import { createHandler } from "./handler.ts";

const actor = "fa200000-0000-4000-8000-000000000001";
const tenant = "fa300000-0000-4000-8000-000000000001";
const attempt = "fa400000-0000-4000-8000-000000000001";
const candidate = "a".repeat(64);

function setup(options: { oauthStatus?: number; bankStatus?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let closed = false;
  const fetchMock = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/rpc/prepare_inter_webhook_registration")) {
      return Response.json({
        attempt_id: attempt,
        environment: "sandbox",
        account: "12345",
        callback_url:
          `https://app.test/backend/webhooks/inter/sandbox?token=${candidate}`,
        candidate_token: candidate,
        credentials: {
          client_id: "client",
          client_secret: "secret",
          certificate: "cert",
          private_key: "key",
        },
      });
    }
    if (url.endsWith("/oauth/v2/token")) {
      return new Response(
        options.oauthStatus && options.oauthStatus !== 200
          ? null
          : JSON.stringify({ access_token: "bank-token" }),
        { status: options.oauthStatus ?? 200 },
      );
    }
    if (url.endsWith("/cobranca/v3/cobrancas/webhook")) {
      return new Response(null, { status: options.bankStatus ?? 204 });
    }
    if (url.endsWith("/rpc/finish_inter_webhook_registration")) {
      return Response.json({ state: "registered" });
    }
    return new Response(null, { status: 404 });
  };
  const handler = createHandler({
    supabaseUrl: "https://db.test",
    serviceKey: "service-key",
    fetch: fetchMock as typeof fetch,
    createClient: () => ({ close: () => (closed = true) }),
  });
  const request = () =>
    new Request("https://fn.test", {
      method: "POST",
      headers: {
        Authorization: "Bearer service-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actor,
        tenant,
        environment: "sandbox",
        version: 1,
        callback_base_url: "https://app.test/backend/webhooks/inter/sandbox",
      }),
    });
  return { handler, request, calls, isClosed: () => closed };
}

Deno.test("registers an HTTPS webhook without exposing the secret", async () => {
  const ctx = setup();
  const response = await ctx.handler(ctx.request());
  assertEquals(response.status, 200);
  const bank = ctx.calls.find((call) =>
    call.url.endsWith("/cobranca/v3/cobrancas/webhook")
  );
  assertEquals(bank?.init?.method, "PUT");
  assertEquals(
    JSON.parse(String(bank?.init?.body)).webhookUrl.includes(candidate),
    true,
  );
  const finish = ctx.calls.find((call) =>
    call.url.endsWith("/rpc/finish_inter_webhook_registration")
  );
  assertEquals(
    JSON.parse(String(finish?.init?.body)).p_candidate_token,
    candidate,
  );
  const body = await response.text();
  assertEquals(body.includes(candidate), false);
  assertEquals(ctx.isClosed(), true);
});

Deno.test("rejects calls without the internal service credential", async () => {
  const ctx = setup();
  const request = ctx.request();
  request.headers.delete("Authorization");
  const response = await ctx.handler(request);
  assertEquals(response.status, 401);
  assertEquals(ctx.calls.length, 0);
});

Deno.test("records an OAuth refusal without calling the webhook endpoint", async () => {
  const ctx = setup({ oauthStatus: 401 });
  const response = await ctx.handler(ctx.request());
  assertEquals(response.status, 502);
  assertEquals(
    ctx.calls.some((call) =>
      call.url.endsWith("/cobranca/v3/cobrancas/webhook")
    ),
    false,
  );
  const finish = ctx.calls.find((call) =>
    call.url.endsWith("/rpc/finish_inter_webhook_registration")
  );
  assertEquals(
    JSON.parse(String(finish?.init?.body)).p_error_code,
    "OAUTH_401",
  );
});
