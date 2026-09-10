import { createHandler } from "./handler.ts";

const requestId = "a1000000-0000-0000-0000-000000000001";
const actorId = "a2000000-0000-0000-0000-000000000001";
const attemptId = "a3000000-0000-0000-0000-000000000001";
const bankId = "a4000000-0000-0000-0000-000000000001";
const secret = "PRIVATE-SECRET";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

type SetupOptions = {
  prepare?: Record<string, unknown>;
  prepareCode?: string;
  loadStatus?: number;
  oauthStatus?: number;
  bankStatus?: number;
  malformedBank?: boolean;
  throwAt?: "load" | "oauth" | "bank";
};

function setup(options: SetupOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let prepareCount = 0;
  const handler = createHandler({
    supabaseUrl: "https://db.test",
    anonKey: "anon-test",
    serviceKey: "service-test",
    now: () => 1_000_000,
    createClient: (certificate, key) => {
      assert(certificate === "certificate" && key === secret, "mTLS material mismatch");
      return { close() {} };
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/rpc/prepare_inter_sandbox_dispatch")) {
        prepareCount++;
        if (options.prepareCode) {
          return new Response(JSON.stringify({ code: options.prepareCode, details: secret }), {
            status: 400,
          });
        }
        return new Response(
          JSON.stringify(
            options.prepare ?? {
              state: "dispatching",
              request_id: requestId,
              attempt_id: prepareCount === 1 ? attemptId : "a3000000-0000-0000-0000-000000000002",
              actor_id: actorId,
              reused: false,
            },
          ),
        );
      }
      if (url.endsWith("/rpc/load_inter_sandbox_dispatch")) {
        if (options.throwAt === "load") throw new Error(secret);
        return new Response(
          JSON.stringify({
            attempt_id: prepareCount === 1 ? attemptId : "a3000000-0000-0000-0000-000000000002",
            actor_id: actorId,
            environment: "sandbox",
            account: "12345678",
            token_cache_key: "tenant:sandbox:1:fingerprint",
            credentials: {
              client_id: "client",
              client_secret: secret,
              certificate: "certificate",
              private_key: secret,
            },
            charge: {
              seuNumero: "AP123",
              valorNominal: 150,
              dataVencimento: "2026-10-15",
              pagador: { cpfCnpj: "45723174000110", tipoPessoa: "JURIDICA" },
              formasRecebimento: ["BOLETO", "PIX"],
            },
          }),
          { status: options.loadStatus ?? 200 },
        );
      }
      if (url.endsWith("/oauth/v2/token")) {
        if (options.throwAt === "oauth") throw new Error(secret);
        return new Response(
          JSON.stringify({
            access_token: secret,
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: options.oauthStatus ?? 200 },
        );
      }
      if (url.endsWith("/cobranca/v3/cobrancas")) {
        if (options.throwAt === "bank") throw new Error(secret);
        return new Response(
          JSON.stringify(options.malformedBank ? {} : { codigoSolicitacao: bankId }),
          { status: options.bankStatus ?? 200 },
        );
      }
      if (url.endsWith("/rpc/finish_inter_sandbox_dispatch")) {
        const payload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            state: payload.p_outcome,
            request_id: requestId,
            bank_request_id: payload.p_bank_request,
            reused: false,
          }),
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch,
  });
  return { handler, calls };
}

const request = (body: unknown = { request_id: requestId, confirmed: true }, bearer = "user-jwt") =>
  new Request("https://edge.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });

Deno.test("requires user session and strict confirmed payload", async () => {
  const test = setup();
  assert((await test.handler(request(undefined, ""))).status === 401);
  assert((await test.handler(request({ request_id: requestId, confirmed: false }))).status === 400);
  assert(
    (
      await test.handler(
        request({
          request_id: requestId,
          confirmed: true,
          environment: "production",
        }),
      )
    ).status === 400,
  );
  assert(test.calls.length === 0);
});

for (const [code, status] of [
  ["42501", 403],
  ["23514", 409],
  ["0A000", 409],
  ["54000", 429],
  ["22023", 422],
] as const) {
  Deno.test(`maps database ${code} safely`, async () => {
    const test = setup({ prepareCode: code });
    const response = await test.handler(request());
    assert(response.status === status);
    assert(!(await response.text()).includes(secret));
    assert(test.calls.length === 1);
  });
}

for (const state of ["dispatching", "submitted", "uncertain"] as const) {
  Deno.test(`does not repeat bank POST for reused ${state}`, async () => {
    const test = setup({
      prepare: {
        state,
        request_id: requestId,
        bank_request_id: state === "submitted" ? bankId : null,
        reused: true,
      },
    });
    const response = await test.handler(request());
    assert(response.status === (state === "submitted" ? 200 : 202));
    assert(test.calls.length === 1);
  });
}

Deno.test("emits sandbox charge with mTLS, required scopes and safe payload", async () => {
  const test = setup();
  const response = await test.handler(request());
  assert(response.status === 200);
  const text = await response.text();
  assert(text.includes(bankId));
  assert(!text.includes(secret));
  const prepare = test.calls.find((call) => call.url.includes("prepare_inter_sandbox"));
  const load = test.calls.find((call) => call.url.includes("load_inter_sandbox"));
  const oauth = test.calls.find((call) => call.url.endsWith("/oauth/v2/token"));
  const bank = test.calls.find((call) => call.url.endsWith("/cobranca/v3/cobrancas"));
  const finish = test.calls.find((call) => call.url.includes("finish_inter_sandbox"));
  assert(prepare?.init?.headers && JSON.stringify(prepare.init.headers).includes("user-jwt"));
  assert(load?.init?.headers && JSON.stringify(load.init.headers).includes("service-test"));
  assert(String(oauth?.init?.body).includes("boleto-cobranca.write+boleto-cobranca.read"));
  assert(JSON.stringify(bank?.init?.headers).includes(`Bearer ${secret}`));
  assert(JSON.stringify(bank?.init?.headers).includes("12345678"));
  assert(String(bank?.init?.body).includes('"formasRecebimento":["BOLETO","PIX"]'));
  assert(String(finish?.init?.body).includes('"p_outcome":"submitted"'));
});

Deno.test("reuses OAuth token while it remains valid in the isolate", async () => {
  const test = setup();
  assert((await test.handler(request())).status === 200);
  assert((await test.handler(request())).status === 200);
  assert(test.calls.filter((call) => call.url.endsWith("/oauth/v2/token")).length === 1);
  assert(test.calls.filter((call) => call.url.endsWith("/cobranca/v3/cobrancas")).length === 2);
});

for (const options of [
  { bankStatus: 400 },
  { bankStatus: 403 },
  { bankStatus: 429 },
  { bankStatus: 500 },
  { malformedBank: true },
  { throwAt: "bank" as const },
  { throwAt: "oauth" as const },
  { throwAt: "load" as const },
]) {
  Deno.test(`finalizes safe failure ${JSON.stringify(options)}`, async () => {
    const test = setup(options);
    const response = await test.handler(request());
    const text = await response.text();
    assert(response.status >= 202);
    assert(!text.includes(secret));
    if (options.throwAt === "oauth") {
      assert(text.includes("autenticação de homologação"));
    }
    const finish = test.calls.filter((call) => call.url.includes("finish_inter_sandbox")).at(-1);
    assert(finish, "attempt must be finalized or conservatively leased");
    const body = String(finish.init?.body);
    const uncertain =
      options.bankStatus === 500 || options.malformedBank || options.throwAt === "bank";
    assert(body.includes(`"p_outcome":"${uncertain ? "uncertain" : "failed"}"`));
    if (options.throwAt === "oauth") {
      assert(body.includes('"p_error_code":"OAUTH_CONNECTION_FAILURE"'));
    }
  });
}
