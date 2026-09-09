import { createHandler } from "./handler.ts";

const payload = {
  actor: "d2000000-0000-0000-0000-000000000001",
  tenant: "d1000000-0000-0000-0000-000000000001",
  environment: "sandbox",
  version: 1,
};
function assert(value: unknown) {
  if (!value) throw new Error("Assertion failed");
}
function setup(
  options: {
    status?: number;
    code?: string;
    malformed?: boolean;
    failTls?: boolean;
  } = {},
) {
  let calls = 0, closed = false, url = "";
  const handler = createHandler({
    supabaseUrl: "https://db.test",
    serviceKey: "service-test",
    createClient: () => {
      if (options.failTls) throw new Error("PRIVATE-SECRET");
      return {
        close() {
          closed = true;
        },
      };
    },
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      calls++;
      url = String(input);
      if (calls === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              options.code
                ? { code: options.code, details: "PRIVATE-SECRET" }
                : {
                  client_id: "id",
                  client_secret: "PRIVATE-SECRET",
                  certificate: "cert",
                  private_key: "key",
                },
            ),
            { status: options.code ? 400 : 200 },
          ),
        );
      }
      assert(init?.redirect === "error");
      assert(String(init?.body).includes("scope=boleto-cobranca.read"));
      return Promise.resolve(
        new Response(
          JSON.stringify(
            options.malformed ? {} : {
              access_token: "PRIVATE-SECRET",
              token_type: "Bearer",
              expires_in: 3600,
            },
          ),
          { status: options.status ?? 200 },
        ),
      );
    }) as typeof fetch,
  });
  return { handler, state: () => ({ calls, closed, url }) };
}
const request = (body: unknown = payload, bearer = "service-test") =>
  new Request("https://edge.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
Deno.test("rejects user bearer before accessing credentials", async () => {
  const t = setup();
  assert((await t.handler(request(payload, "user-jwt"))).status === 401);
  assert(t.state().calls === 0);
});
Deno.test("rejects arbitrary endpoints and invalid environment", async () => {
  const t = setup();
  assert(
    (await t.handler(
      request({ ...payload, environment: "http://attacker.test" }),
    )).status === 400,
  );
  assert(t.state().calls === 0);
});
for (
  const [code, status] of [["42501", 403], ["40001", 409], ["P0002", 409], [
    "22023",
    422,
  ], ["54000", 429]] as const
) {
  Deno.test(`maps database ${code} without leaking secrets`, async () => {
    const t = setup({ code });
    const response = await t.handler(request());
    assert(response.status === status);
    assert(!(await response.text()).includes("PRIVATE-SECRET"));
    assert(t.state().calls === 1);
  });
}
for (const environment of ["sandbox", "production"]) {
  Deno.test(`authenticates ${environment} and never returns token`, async () => {
    const t = setup();
    const response = await t.handler(request({ ...payload, environment }));
    assert(response.status === 200);
    assert(!(await response.text()).includes("PRIVATE-SECRET"));
    assert(t.state().closed);
    assert(
      t.state().url ===
        (environment === "sandbox"
            ? "https://cdpj-sandbox.partners.uatinter.co"
            : "https://cdpj.partners.bancointer.com.br") + "/oauth/v2/token",
    );
  });
}
for (
  const options of [{ status: 401 }, { status: 429 }, { malformed: true }, {
    failTls: true,
  }]
) {
  Deno.test(`safe failure ${JSON.stringify(options)}`, async () => {
    const t = setup(options);
    const response = await t.handler(request());
    assert(response.status >= 400);
    assert(!(await response.text()).includes("PRIVATE-SECRET"));
    if (!options.failTls) assert(t.state().closed);
  });
}
