import { createHandler } from "./handler.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

const request = (body: string, token = "Bearer test-jwt") =>
  new Request("http://localhost", {
    method: "POST",
    headers: { Authorization: token },
    body,
  });

Deno.test("valida método, autenticação e payload antes de chamar banco", async () => {
  const handler = createHandler({
    supabaseUrl: "http://db",
    apiKey: "anon",
    fetch: () => {
      throw new Error("Unexpected fetch");
    },
  });
  assert((await handler(new Request("http://localhost"))).status === 405);
  assert((await handler(request("{}", ""))).status === 401);
  for (
    const body of [
      "[1]",
      "null",
      "bad",
      '{"limit":0}',
      '{"limit":101}',
      '{"limit":1.5}',
      '{"as_of":"2026-02-30"}',
      '{"contract_id":"bad"}',
      '{"tenant_id":"fake"}',
    ]
  ) {
    assert((await handler(request(body))).status === 400, body);
  }
});

Deno.test("encaminha token sem elevar privilégios e usa schema apticket", async () => {
  const handler = createHandler({
    supabaseUrl: "http://db",
    apiKey: "anon",
    fetch: (url, init) => {
      assert(url === "http://db/rest/v1/rpc/close_billing_cycles");
      const headers = new Headers(init?.headers);
      assert(headers.get("Authorization") === "Bearer test-jwt");
      assert(headers.get("Content-Profile") === "apticket");
      assert(headers.get("apikey") === "anon");
      assert(JSON.parse(String(init?.body)).p_limit === 50);
      return Promise.resolve(
        Response.json({ generated: 1, errors: [], limit_reached: false }),
      );
    },
  });
  assert((await handler(request("{}"))).status === 200);
});

Deno.test("propaga negação de acesso sem detalhes internos", async () => {
  for (const status of [401, 403]) {
    const handler = createHandler({
      supabaseUrl: "http://db",
      apiKey: "anon",
      fetch: () => Promise.resolve(new Response("secret", { status })),
    });
    const response = await handler(request("{}"));
    assert(response.status === status);
    assert(!(await response.text()).includes("secret"));
  }
});

Deno.test("falha parcial é explícita e indisponibilidade permite retry", async () => {
  const partial = createHandler({
    supabaseUrl: "http://db",
    apiKey: "anon",
    fetch: () =>
      Promise.resolve(Response.json({
        generated: 1,
        errors: [{ message: "Apuração incompleta" }],
      })),
  });
  assert((await partial(request("{}"))).status === 409);
  const unavailable = createHandler({
    supabaseUrl: "http://db",
    apiKey: "anon",
    fetch: () => Promise.reject(new Error("offline")),
  });
  assert((await unavailable(request("{}"))).status === 503);
});
