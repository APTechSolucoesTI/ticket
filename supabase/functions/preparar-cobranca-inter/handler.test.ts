import { createHandler } from "./handler.ts";
function assert(value: unknown) {
  if (!value) throw new Error("Assertion failed");
}
const body = {
  receivable_id: "e1000000-0000-0000-0000-000000000001",
  environment: "sandbox",
};
function request(payload: unknown = body, token = "user-jwt") {
  return new Request("http://test", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(payload),
  });
}
function setup(code?: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    handler: createHandler({
      supabaseUrl: "https://db.test",
      apiKey: "anon",
      fetch: ((url, init) => {
        calls++;
        assert(
          String(url) === "https://db.test/rest/v1/rpc/prepare_inter_charge",
        );
        assert(
          new Headers(init?.headers).get("Authorization") === "Bearer user-jwt",
        );
        return Promise.resolve(
          new Response(
            JSON.stringify(
              code ? { code, details: "PRIVATE" } : {
                id: "request-id",
                status: "blocked_homologation",
                reused: true,
              },
            ),
            { status: code ? 400 : 200 },
          ),
        );
      }) as typeof fetch,
    }),
  };
}
Deno.test("no session never reaches database", async () => {
  const t = setup();
  assert((await t.handler(request(body, ""))).status === 401);
  assert(t.calls === 0);
});
Deno.test("client cannot inject tenant or amount", async () => {
  const t = setup();
  assert((await t.handler(request({ ...body, amount: 1 }))).status === 400);
  assert(t.calls === 0);
});
Deno.test("preserves user bearer and reports blocked retry", async () => {
  const t = setup();
  const r = await t.handler(request());
  assert(r.status === 200);
  assert((await r.json()).status === "blocked_homologation");
  assert(t.calls === 1);
});
for (
  const [code, status] of [["42501", 403], ["40001", 409], ["23514", 422], [
    "XX000",
    502,
  ]] as const
) {
  Deno.test(`sanitizes ${code}`, async () => {
    const t = setup(code);
    const r = await t.handler(request());
    assert(r.status === status);
    assert(!(await r.text()).includes("PRIVATE"));
  });
}
