import { createClientDocumentsUploadHandler } from "./handler.ts";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
const tenant = "ae100000-0000-4000-8000-000000000001";
const company = "ae200000-0000-4000-8000-000000000001";
const user = "ae300000-0000-4000-8000-000000000001";
const caller = "synthetic." + btoa(JSON.stringify({ sub: user })) + ".fixture";
function fixture(
  options: {
    permitted?: boolean;
    scanStatus?: number;
    configured?: boolean;
    publishStatus?: number;
  } = {},
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "https://db.example.test",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
    SUPABASE_ANON_KEY: "fixture-public-key",
    APTICKET_API_URL: "https://app.example.test/backend",
  };
  const handler = createClientDocumentsUploadHandler({
    env: (name) =>
      name === "APTICKET_API_URL" && options.configured === false
        ? undefined
        : env[name],
    fetch: (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      let body: unknown = [], status = 200;
      if (url.includes("/rpc/has_permission")) {
        body = options.permitted !== false;
      } else if (url.includes("/rest/v1/profiles")) {
        body = [{ tenant_id: tenant }];
      } else if (url.includes("/rest/v1/companies")) {
        body = [{ id: company, tenant_id: tenant }];
      } else if (url.endsWith("/files/upload")) {
        assert(
          init?.body instanceof FormData,
          "scanner API receives multipart",
        );
        assert(init.body.get("bucket") === "client-documents");
        assert(
          String(init.body.get("path")).startsWith(`${tenant}/${company}/`),
        );
        assert(
          new Headers(init.headers).get("authorization") === `Bearer ${caller}`,
          "forward user JWT, never service credential",
        );
        assert(init.redirect === "error");
        status = options.scanStatus ?? 201;
        body = { path: init.body.get("path") };
      } else if (url.endsWith("/rest/v1/client_documents")) {
        status = options.publishStatus ?? 201;
        body = [{ id: "fixture-document" }];
      } else if (
        url.includes("/storage/v1/object/") && init?.method === "DELETE"
      ) body = {};
      else throw new Error("Unexpected network dependency: " + url);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { handler, calls };
}
function uploadRequest(authenticated = true) {
  const form = new FormData();
  form.set("company_id", company);
  form.set("competencia", "2026-10-01");
  form.set("document_type", "fatura");
  form.append(
    "files",
    new File(["%PDF-1.4\nSynthetic fixture\n%%EOF"], "fixture.pdf", {
      type: "application/pdf",
    }),
  );
  return new Request("https://edge.example.test/upload", {
    method: "POST",
    headers: authenticated
      ? { Authorization: `Bearer ${caller}`, apikey: "fixture-public-key" }
      : {},
    body: form,
  });
}
Deno.test("client documents require authentication and permission before multipart processing", async () => {
  const absent = fixture();
  assert((await absent.handler(uploadRequest(false))).status === 401);
  assert(absent.calls.length === 0);
  const denied = fixture({ permitted: false });
  assert((await denied.handler(uploadRequest())).status === 403);
  assert(denied.calls.length === 1);
});
Deno.test("client documents delegate bytes to the scanner API before publishing metadata", async () => {
  const f = fixture();
  assert((await f.handler(uploadRequest())).status === 201);
  const scan = f.calls.findIndex((call) => call.url.endsWith("/files/upload"));
  const publish = f.calls.findIndex((call) =>
    call.url.endsWith("/rest/v1/client_documents")
  );
  assert(scan >= 0 && publish > scan);
  assert(
    !f.calls.some((call) =>
      call.url.includes("/storage/v1/object/") && call.init?.method === "POST"
    ),
  );
});
Deno.test("infected files, scanner outage and missing configuration never publish document metadata", async () => {
  for (const scanStatus of [400, 503]) {
    const f = fixture({ scanStatus });
    assert((await f.handler(uploadRequest())).status >= 400);
    assert(
      !f.calls.some((call) => call.url.endsWith("/rest/v1/client_documents")),
    );
  }
  const f = fixture({ configured: false });
  assert((await f.handler(uploadRequest())).status === 503);
  assert(!f.calls.some((call) => call.url.endsWith("/files/upload")));
});
Deno.test("failed publication cleans up only the paths uploaded in that request", async () => {
  const f = fixture({ publishStatus: 422 });
  assert((await f.handler(uploadRequest())).status === 422);
  const removals = f.calls.filter((call) => call.init?.method === "DELETE");
  assert(removals.length === 1);
  assert(removals[0].url.includes(`${tenant}/${company}/`));
});
