import { createHandler } from "./handler.ts";

const requestId = "10000000-0000-4000-8000-000000000001";
const attemptId = "20000000-0000-4000-8000-000000000002";
const actorId = "30000000-0000-4000-8000-000000000003";
const bankId = "40000000-0000-4000-8000-000000000004";
const eventId = "50000000-0000-4000-8000-000000000005";
const secret = "secret-never-return";
const assert: (condition: unknown, message?: string) => asserts condition = (
  condition,
  message = "assertion failed",
) => {
  if (!condition) throw new Error(message);
};

type SetupOptions = {
  prepared?: Record<string, unknown>;
  bankStatus?: number;
  situation?: string;
  environment?: "sandbox" | "production";
  throwAt?: "oauth" | "bank";
};

function setup(options: SetupOptions = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = createHandler({
    supabaseUrl: "https://db.test",
    anonKey: "anon-test",
    serviceKey: "service-test",
    now: () => 1_000_000,
    createClient: () => ({ close() {} }),
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/rpc/prepare_inter_charge_sync")) {
        return new Response(
          JSON.stringify(
            options.prepared ?? {
              state: "syncing",
              attempt_id: attemptId,
              actor_id: actorId,
              reused: false,
            },
          ),
        );
      }
      if (url.endsWith("/rpc/prepare_inter_charge_sync_from_webhook")) {
        return new Response(
          JSON.stringify(
            options.prepared ?? {
              state: "syncing",
              attempt_id: attemptId,
              actor_id: actorId,
              reused: false,
            },
          ),
        );
      }
      if (url.endsWith("/rpc/load_inter_charge_sync")) {
        return new Response(
          JSON.stringify({
            attempt_id: attemptId,
            actor_id: actorId,
            environment: options.environment ?? "sandbox",
            account: "12345678",
            bank_request_id: bankId,
            token_cache_key: `${requestId}-${Math.random()}`,
            credentials: {
              client_id: "client",
              client_secret: secret,
              certificate: "certificate",
              private_key: "key",
            },
          }),
        );
      }
      if (url.endsWith("/oauth/v2/token")) {
        if (options.throwAt === "oauth") throw new Error(secret);
        return new Response(
          JSON.stringify({ access_token: secret, expires_in: 3600 }),
        );
      }
      if (url.includes(`/cobranca/v3/cobrancas/${bankId}`)) {
        if (options.throwAt === "bank") throw new Error(secret);
        return new Response(
          JSON.stringify({
            cobranca: {
              codigoSolicitacao: bankId,
              situacao: options.situation ?? "A_RECEBER",
              dataSituacao: "2026-09-10",
              valorTotalRecebido: null,
            },
            boleto: {
              nossoNumero: "123",
              codigoBarras: "456",
              linhaDigitavel: "789",
            },
            pix: { txid: "tx", pixCopiaECola: "pix" },
          }),
          { status: options.bankStatus ?? 200 },
        );
      }
      if (url.endsWith("/rpc/finish_inter_charge_sync")) {
        return new Response(JSON.stringify({ state: "synced", reused: false }));
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch,
  });
  return { handler, calls };
}

const request = (
  body: unknown = { request_id: requestId },
  bearer = "user-jwt",
) =>
  new Request("https://edge.test", {
    method: "POST",
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    body: JSON.stringify(body),
  });

Deno.test("requires authenticated valid request", async () => {
  const test = setup();
  assert((await test.handler(request(undefined, ""))).status === 401);
  assert(
    (await test.handler(request({ request_id: "invalid" }))).status === 400,
  );
  assert(test.calls.length === 0);
});

Deno.test("accepts webhook mode only with the service credential", async () => {
  const user = setup();
  const internalBody = {
    request_id: requestId,
    source: "webhook",
    event_id: eventId,
  };
  assert((await user.handler(request(internalBody))).status === 400);
  assert(user.calls.length === 0);

  const service = setup({ environment: "production" });
  const response = await service.handler(request(internalBody, "service-test"));
  assert(response.status === 200);
  assert(
    service.calls.some((call) =>
      call.url.endsWith("/rpc/prepare_inter_charge_sync_from_webhook")
    ),
  );
  assert(
    service.calls.some((call) =>
      call.url.startsWith("https://cdpj.partners.bancointer.com.br/")
    ),
  );
});

Deno.test("reuses a recent synchronization without calling Inter", async () => {
  const test = setup({
    prepared: { state: "synced", bank_status: "A_RECEBER", reused: true },
  });
  const response = await test.handler(request());
  assert(response.status === 200);
  assert(test.calls.length === 1);
});

Deno.test("queries Inter V3 and persists only normalized fields", async () => {
  const test = setup({ situation: "RECEBIDO" });
  const response = await test.handler(request());
  const text = await response.text();
  assert(response.status === 200);
  assert(!text.includes(secret));
  const bank = test.calls.find((call) =>
    call.url.includes(`/cobranca/v3/cobrancas/${bankId}`)
  );
  const finish = test.calls.find((call) =>
    call.url.endsWith("/rpc/finish_inter_charge_sync")
  );
  assert(bank?.init?.method === "GET");
  assert(JSON.stringify(bank?.init?.headers).includes("12345678"));
  const finishBody = String(finish?.init?.body);
  assert(finishBody.includes('"p_outcome":"synced"'));
  assert(finishBody.includes('"situacao":"RECEBIDO"'));
  assert(!finishBody.includes('"pagador"'));
});

Deno.test("records deterministic Inter query rejection", async () => {
  const test = setup({ bankStatus: 404 });
  const response = await test.handler(request());
  assert(response.status === 404);
  const finish = test.calls.find((call) =>
    call.url.endsWith("/rpc/finish_inter_charge_sync")
  );
  assert(
    String(finish?.init?.body).includes('"p_error_code":"INTER_QUERY_404"'),
  );
});

for (const throwAt of ["oauth", "bank"] as const) {
  Deno.test(`keeps synchronization safe on ${throwAt} connection failure`, async () => {
    const test = setup({ throwAt });
    const response = await test.handler(request());
    const text = await response.text();
    assert(response.status === 503);
    assert(!text.includes(secret));
    const finish = test.calls.find((call) =>
      call.url.endsWith("/rpc/finish_inter_charge_sync")
    );
    assert(String(finish?.init?.body).includes('"p_outcome":"failed"'));
  });
}
