import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { startLocalApp } from "./local-app.mjs";
const tenant = "bd100000-0000-4000-8000-000000000001",
  company = "bd200000-0000-4000-8000-000000000001",
  actor = "bd300000-0000-4000-8000-000000000001",
  created = "bd300000-0000-4000-8000-000000000002";
const payload = Buffer.from(
  JSON.stringify({
    contact_id: actor,
    tenant_id: tenant,
    email: "admin@example.test",
    exp: Math.floor(Date.now() / 1000) + 300,
  }),
).toString("base64url");
const auth = `Bearer ${payload}.${createHmac("sha256", "isolated-security-test-portal-key").update(payload).digest("base64url")}`;
let stored = null,
  writes = 0,
  emailChecks = 0,
  otherReads = 0;
const app = await startLocalApp(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  const json = (data) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  if (!url.pathname.endsWith("/contacts")) {
    otherReads++;
    return json([]);
  }
  assert.equal(url.searchParams.get("tenant_id") ?? `eq.${tenant}`, `eq.${tenant}`);
  if (req.method === "POST" || req.method === "PATCH") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const data = JSON.parse(raw);
    writes++;
    if (req.method === "POST") {
      assert.equal(data.tenant_id, tenant);
      assert.equal(data.company_id, company);
      stored = { id: created, secondary_emails: [], secondary_phones: [], ...data };
    } else {
      assert.equal(url.searchParams.get("company_id"), `eq.${company}`);
      stored = { ...stored, ...data };
    }
    return json({ id: created });
  }
  if (url.searchParams.has("email")) {
    emailChecks++;
    assert.notEqual(url.searchParams.get("email"), "ilike.");
    return json(null);
  }
  if (url.searchParams.get("id") === `eq.${created}`) return json(stored);
  return json({
    id: actor,
    tenant_id: tenant,
    company_id: company,
    is_active: true,
    is_portal_admin: true,
  });
});
const fields = {
  name: "Contato por telefone",
  email: "",
  phone: "(11) 98888-7777",
  job_title: null,
  can_open_tickets: true,
  receives_csat: true,
  is_portal_admin: false,
  is_portal_financial: false,
  is_active: true,
};
async function save(body, method = "POST") {
  return fetch(`${app.origin}/api/public/portal/contacts`, {
    method,
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
try {
  let response = await save(fields);
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal((await response.json()).invited, null);
  assert.equal(stored.email, null);
  assert.equal(stored.phone, "5511988887777");
  assert.equal(emailChecks, 0);
  assert.equal(otherReads, 0, "phone-only must not load email settings/send invitation");
  const count = writes;
  for (const invalid of [
    { ...fields, phone: "" },
    { ...fields, phone: " " },
    { ...fields, email: "invalid" },
    { ...fields, phone: "123" },
    { ...fields, email: null, phone: null },
  ]) {
    response = await save(invalid);
    assert.equal(response.status, 400);
    assert.equal(writes, count);
  }
  response = await save({ ...fields, id: created, phone: "" }, "PATCH");
  assert.equal(response.status, 400);
  assert.equal(writes, count, "last channel cannot be removed");
  stored.secondary_phones = ["5511977776666"];
  response = await save({ ...fields, id: created, phone: "" }, "PATCH");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(stored.email, null);
  assert.equal(stored.phone, null);
  assert.deepEqual(
    stored.secondary_phones,
    ["5511977776666"],
    "PATCH preserves existing secondary channels",
  );
  response = await fetch(`${app.origin}/api/public/portal/contacts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  assert.equal(response.status, 403);
  console.log(
    "PASS portal contact HTTP: phone-only creation, normalized/null fields, no empty invite/duplicate lookup, validation, preserve secondaries, reject removal of final channel and authentication",
  );
} finally {
  await app.close();
}
