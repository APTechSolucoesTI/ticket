import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { startLocalApp } from "./local-app.mjs";

const tenant = "ad100000-0000-4000-8000-000000000001";
const contact = "ad200000-0000-4000-8000-000000000001";
const ticket = "ad300000-0000-4000-8000-000000000001";
const company = "ad400000-0000-4000-8000-000000000001";
const otherTenant = "bd100000-0000-4000-8000-000000000001";
const codeHash = createHash("sha256").update("123456").digest("hex");
const payload = Buffer.from(
  JSON.stringify({
    contact_id: contact,
    tenant_id: tenant,
    email: "fixture@example.test",
    exp: Math.floor(Date.now() / 1000) + 300,
  }),
).toString("base64url");
const signature = createHmac("sha256", "isolated-security-test-portal-key")
  .update(payload)
  .digest("base64url");
const authorization = `Bearer ${payload}.${signature}`;
let fixture;
function reset(overrides = {}) {
  fixture = {
    active: true,
    contactError: false,
    attachments: [],
    signed: [],
    writes: 0,
    businessReads: 0,
    otpWriteError: false,
    consumed: false,
    otpReads: 0,
    consumeQueries: [],
    attempts: 0,
    attemptWaiters: [],
    ...overrides,
  };
}
reset();

const app = await startLocalApp(async (request, response) => {
  const url = new URL(request.url, "http://fixture.test");
  const json = (body, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const readBody = async () => {
    let body = "";
    for await (const chunk of request) body += chunk;
    return body ? JSON.parse(body) : {};
  };
  if (url.pathname.endsWith("/rpc/can_sign_ticket_attachment")) {
    const body = await readBody();
    assert.equal(body._tenant_id, tenant);
    assert.equal(body._ticket_id, ticket);
    assert.equal(body._contact_id, contact);
    return json(
      body._path === `${tenant}/${ticket}/fixture.pdf` ||
        body._path === `${tenant}/whatsapp-inbound/fixture.pdf`,
    );
  }
  if (url.pathname.endsWith("/rpc/increment_portal_otp_attempt")) {
    const body = await readBody();
    assert.equal(body._otp_id, "otp-fixture");
    if (fixture.otpWriteError) return json({ message: "fixture write failure" }, 500);
    if (fixture.consumed || fixture.attempts >= 5) return json(null);
    return json(++fixture.attempts);
  }
  if (url.pathname.endsWith("/contacts")) {
    assert.equal(url.searchParams.get("id"), `eq.${contact}`);
    assert.equal(url.searchParams.get("tenant_id"), `eq.${tenant}`);
    if (fixture.contactError) return json({ message: "fixture unavailable" }, 500);
    return json({
      id: contact,
      tenant_id: tenant,
      company_id: company,
      is_active: fixture.active,
      name: "Fixture",
      email: "fixture@example.test",
      can_open_tickets: true,
      is_portal_admin: false,
      is_portal_financial: false,
      companies: { name: "Fixture" },
    });
  }
  if (url.pathname.endsWith("/portal_otp_codes")) {
    if (request.method === "GET") {
      fixture.otpReads++;
      const attempts = fixture.attempts;
      if (fixture.wrongRace && fixture.otpReads <= 5) {
        await new Promise((resolve) => {
          fixture.attemptWaiters.push(resolve);
          if (fixture.attemptWaiters.length === 5)
            fixture.attemptWaiters.forEach((release) => release());
        });
      } else if (fixture.concurrent && fixture.otpReads === 1) {
        await new Promise((resolve) => {
          fixture.releaseRead = resolve;
        });
      } else if (fixture.concurrent) {
        fixture.releaseRead?.();
      }
      return json({
        id: "otp-fixture",
        contact_id: contact,
        tenant_id: tenant,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempts,
        consumed_at: null,
      });
    }
    const body = await readBody();
    if (body.attempts !== undefined) {
      fixture.attempts = body.attempts;
      return json(null);
    }
    fixture.consumeQueries.push(url.searchParams);
    if (fixture.otpWriteError) return json({ message: "fixture write failure" }, 500);
    const conditional = url.searchParams.get("consumed_at") === "is.null";
    const consumed = fixture.consumed;
    fixture.consumed = true;
    return json((conditional && consumed) || fixture.attempts >= 5 ? [] : [{ id: "otp-fixture" }]);
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    fixture.signed.push(decodeURIComponent(url.pathname.split("ticket-attachments/")[1]));
    return json({ signedURL: "/object/sign/fixture?token=fixture" });
  }
  if (url.pathname.endsWith("/tickets")) {
    if (request.method === "GET") {
      fixture.businessReads++;
      assert.equal(url.searchParams.get("tenant_id"), `eq.${tenant}`);
      assert.equal(url.searchParams.get("contact_id"), `eq.${contact}`);
      return json(
        url.searchParams.has("id")
          ? {
              id: ticket,
              tenant_id: tenant,
              contact_id: contact,
              status: "pending",
              channel: "portal",
              subject: "Fixture",
            }
          : [],
      );
    }
    return json({});
  }
  if (url.pathname.endsWith("/messages")) {
    if (request.method === "POST") {
      fixture.writes++;
      return json({ id: "message-fixture" });
    }
    return json([
      {
        id: "message-fixture",
        author_type: "contact",
        content: "Fixture",
        attachments: fixture.attachments,
      },
    ]);
  }
  if (request.method === "GET") fixture.businessReads++;
  return json([]);
});

async function post(path, body = {}, authenticated = true) {
  const headers = authenticated ? { authorization } : {};
  let data = body;
  if (!(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    data = JSON.stringify(body);
  }
  const response = await fetch(`${app.origin}/api/public/portal/${path}`, {
    method: "POST",
    headers,
    body: data,
  });
  return { status: response.status, body: await response.json() };
}
function reply() {
  const form = new FormData();
  form.set("ticket_id", ticket);
  form.set("content", "Fixture reply");
  return form;
}
const selected = process.argv[2];
try {
  if (!selected || selected === "SEC-02") {
    for (const overrides of [{ active: false }, { contactError: true }]) {
      reset(overrides);
      for (const [path, body] of [
        ["session", {}],
        ["ticket-detail", { ticket_id: ticket }],
        ["ticket-reply", reply()],
      ]) {
        const result = await post(path, body);
        assert.equal(result.status, 401, `${path}: reject inactive/unavailable contact`);
        assert.equal(fixture.writes, 0, "no message may be inserted");
        assert.equal(fixture.businessReads, 0, "authorize before privileged business reads");
      }
    }
    reset();
    assert.equal((await post("session")).status, 200);
    assert.equal((await post("ticket-detail", { ticket_id: ticket })).status, 200);
    assert.equal((await post("ticket-reply", reply())).status, 200);
    assert.equal(fixture.writes, 1, "active contact retains ability to reply");
    assert.equal((await post("ticket-detail", { ticket_id: ticket }, false)).status, 401);
    console.log("PASS SEC-02: inactive, lookup error, active, missing token");
  }
  if (!selected || selected === "SEC-03") {
    const valid = `${tenant}/${ticket}/fixture.pdf`;
    const inbound = `${tenant}/whatsapp-inbound/fixture.pdf`;
    const blocked = [
      `${tenant}/af300000-0000-4000-8000-000000000099/private.pdf`,
      `${tenant}/${ticket}/private-internal.pdf`,
      `${otherTenant}/${ticket}/fixture.pdf`,
      `${tenant}/../private.pdf`,
      `${tenant}/%2e%2e/private.pdf`,
      `${tenant}/%252e%252e/private.pdf`,
      `${tenant}\\other\\private.pdf`,
      `${tenant}//private.pdf`,
      `https://fixture.invalid/${tenant}/private.pdf`,
      `${tenant}/%2fprivate.pdf`,
      `${tenant}/private.pdf?token=fixture`,
      `${tenant}/bad\u0000name.pdf`,
      `${tenant}/bad\u007fname.pdf`,
    ];
    reset({
      attachments: [valid, inbound, ...blocked].map((path) => ({
        path,
        name: "fixture.pdf",
        size: 10,
        type: "application/pdf",
      })),
    });
    const result = await post("ticket-detail", { ticket_id: ticket });
    assert.equal(result.status, 200);
    assert.deepEqual(
      fixture.signed.sort(),
      [valid, inbound].sort(),
      "privileged signer receives only canonical paths inside the current tenant",
    );
    assert.ok(result.body.messages[0].attachments.slice(2).every((item) => item.url === null));
    console.log("PASS SEC-03: foreign tenant, traversal/encoding, URL, canonical uploads");
  }
  if (!selected || selected === "SEC-04") {
    reset({ otpWriteError: true });
    const failed = await post(
      "verify-otp",
      { email: "failure@example.test", code: "123456" },
      false,
    );
    assert.equal(failed.status, 401, "database write failure cannot create a session");
    assert.equal(failed.body.token, undefined);
    reset({ concurrent: true });
    const results = await Promise.all(
      [1, 2].map(() => post("verify-otp", { email: "race@example.test", code: "123456" }, false)),
    );
    assert.deepEqual(
      results.map((result) => result.status).sort(),
      [200, 401],
      "exactly one concurrent verifier consumes the OTP",
    );
    assert.equal(results.filter((result) => result.body.token).length, 1);
    for (const query of fixture.consumeQueries) {
      assert.equal(query.get("consumed_at"), "is.null");
      assert.ok(query.get("expires_at")?.startsWith("gt."));
      assert.equal(query.get("attempts"), "lt.5");
    }
    console.log("PASS SEC-04: failed persistence and concurrent single-use consumption");
    reset({ wrongRace: true });
    const rejected = await Promise.all(
      Array.from({ length: 5 }, () =>
        post("verify-otp", { email: "attempt-race@example.test", code: "000000" }, false),
      ),
    );
    assert.ok(rejected.every((result) => result.status === 401));
    const exhausted = await post(
      "verify-otp",
      { email: "attempt-race@example.test", code: "123456" },
      false,
    );
    assert.equal(
      exhausted.status,
      401,
      "five racing wrong guesses must block even a later correct code",
    );
    assert.equal(exhausted.body.token, undefined);
    assert.equal(fixture.attempts, 5, "concurrent guesses must not lose increments");
    console.log("PASS SEC-04: concurrent wrong guesses exhaust the existing five-attempt limit");
  }
} finally {
  await app.close();
}
