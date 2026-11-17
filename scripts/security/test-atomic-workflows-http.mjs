import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const startRequire = createRequire(require.resolve("@tanstack/react-start/package.json"));
const clientRequire = createRequire(
  startRequire.resolve("@tanstack/start-client-core/package.json"),
);
const { toJSON, fromCrossJSON } = await import(
  pathToFileURL(clientRequire.resolve("seroval")).href
);
const { createDefaultSerovalPlugins } = await import(
  pathToFileURL(clientRequire.resolve("@tanstack/router-core/ssr/client")).href
);
const bcrypt = require("bcryptjs");
const tenant = "af100000-0000-4000-8000-000000000040";
const contact = "af200000-0000-4000-8000-000000000040";
const company = "af300000-0000-4000-8000-000000000040";
const ticket = "af400000-0000-4000-8000-000000000040";
let failure = "";
let tenantWrites = 0;
let ticketWrites = 0;
let messageWrites = 0;
let signupPayload;
const profile = {
  id: contact,
  tenant_id: tenant,
  name: "Fixture owner",
  email: "atomic@example.test",
  session_version: 0,
};
const app = await startLocalApp(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const path = new URL(request.url, "http://fixture.test").pathname;
  const json = (value, status = 200) =>
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  if (path.endsWith("/rpc/provision_tenant")) {
    assert.equal(request.headers.apikey, "fixture-service");
    signupPayload = body;
    if (failure === "profile")
      return json({ code: "P0001", message: "private internal fixture failure" }, 500);
    if (failure === "duplicate")
      return json({ code: "23505", message: "private unique index name" }, 409);
    tenantWrites++;
    return json(profile);
  }
  if (path.endsWith("/rpc/create_portal_chat")) {
    assert.equal(request.headers.apikey, "fixture-service");
    assert.equal(body._tenant_id, tenant);
    assert.equal(body._contact_id, contact);
    if (failure === "message")
      return json({ code: "P0001", message: "private message constraint" }, 500);
    if (body._contract_id) return json({ code: "22023", message: "portal_contract_invalid" }, 400);
    ticketWrites++;
    messageWrites++;
    return json({ ticket_id: ticket, number: 7 });
  }
  // Legacy endpoints reproduce partial commits before the atomic RPC is used.
  if (path.endsWith("/tenants")) {
    tenantWrites++;
    return json({ id: tenant });
  }
  if (path.endsWith("/profiles"))
    return request.method === "GET"
      ? json(null)
      : failure === "profile"
        ? json({ message: "private internal fixture failure" }, 500)
        : json(profile);
  if (path.endsWith("/roles")) return json({ id: company });
  if (path.endsWith("/user_roles")) return json(null);
  if (path.endsWith("/contacts"))
    return json({
      id: contact,
      tenant_id: tenant,
      company_id: company,
      is_active: true,
      can_open_tickets: true,
    });
  if (path.endsWith("/contracts")) return json([]);
  if (path.endsWith("/tickets")) {
    ticketWrites++;
    return json({ id: ticket, number: 7 });
  }
  if (path.endsWith("/messages")) {
    if (failure === "message") return json({ message: "private message constraint" }, 500);
    messageWrites++;
    return json(null);
  }
  return json([]);
});

function functionId(name) {
  const base = "apps/web/.output/server/_ssr";
  for (const file of readdirSync(base).filter((file) => /\.[cm]?js$/.test(file))) {
    const match = readFileSync(`${base}/${file}`, "utf8").match(
      new RegExp(`id:\\s*"([^"]+)",\\s*name:\\s*"${name}"`),
    );
    if (match) return match[1];
  }
  throw new Error(`Missing compiled server function: ${name}`);
}
async function signup(email) {
  const response = await fetch(`${app.origin}/_serverFn/${functionId("signUpTenant")}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tsr-serverFn": "true" },
    body: JSON.stringify(
      toJSON({
        data: {
          company: "Fixture company",
          name: "Fixture owner",
          email,
          password: "Synthetic password #1",
        },
      }),
    ),
  });
  return fromCrossJSON(await response.json(), {
    refs: new Map(),
    plugins: createDefaultSerovalPlugins(),
  });
}
const sessionBody = Buffer.from(
  JSON.stringify({
    contact_id: contact,
    tenant_id: tenant,
    email: profile.email,
    exp: Math.floor(Date.now() / 1000) + 300,
  }),
).toString("base64url");
const signature = createHmac("sha256", "isolated-security-test-portal-key")
  .update(sessionBody)
  .digest("base64url");
async function chat(message, extra = {}) {
  return fetch(`${app.origin}/api/public/portal/chat-start`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionBody}.${signature}`,
    },
    body: JSON.stringify({ message, ...extra }),
  });
}

try {
  if (process.argv[2] !== "chat") {
    failure = "profile";
    const failed = await signup("failure@example.test");
    assert.ok(failed.error && !failed.result?.token);
    assert.equal(tenantWrites, 0, "failed signup must not leave a tenant committed");
    assert.ok(
      !JSON.stringify(failed).includes("private internal"),
      "internal database errors stay server-side",
    );
    failure = "duplicate";
    const duplicate = await signup("duplicate@example.test");
    assert.ok(duplicate.error && !duplicate.result?.token);
    assert.equal(tenantWrites, 0);
    failure = "";
    const created = await signup("atomic@example.test");
    assert.ok(created.result?.token);
    assert.equal(tenantWrites, 1);
    assert.deepEqual(Object.keys(signupPayload).sort(), [
      "_company_name",
      "_email",
      "_name",
      "_password_hash",
    ]);
    assert.ok(await bcrypt.compare("Synthetic password #1", signupPayload._password_hash));
    assert.equal(bcrypt.getRounds(signupPayload._password_hash), 12);
    console.log(
      "PASS atomic signup HTTP: failed persistence, duplicate and server-only hashed payload",
    );
  }

  failure = "message";
  const failedChat = await chat("Initial fixture message");
  assert.equal(failedChat.status, 500, "failed initial message must not acknowledge chat creation");
  assert.equal(ticketWrites, 0, "failed initial message must not leave a committed ticket");
  assert.ok(!(await failedChat.text()).includes("private message"));
  failure = "";
  assert.equal((await chat("Initial fixture message")).status, 201);
  assert.equal(ticketWrites, 1);
  assert.equal(messageWrites, 1);
  assert.equal((await chat(" ")).status, 400);
  assert.equal((await chat("Hello", { contract_id: company })).status, 400);
  assert.equal(ticketWrites, 1, "invalid submissions must not create tickets");
  console.log(
    "PASS atomic chat HTTP: persistence failure, success, blank text and invalid explicit contract",
  );
} finally {
  await app.close();
}
