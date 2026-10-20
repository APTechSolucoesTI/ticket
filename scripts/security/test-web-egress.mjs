import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const startRequire = createRequire(require.resolve("@tanstack/react-start/package.json"));
const clientRequire = createRequire(startRequire.resolve("@tanstack/start-client-core/package.json"));
const { toJSON, fromCrossJSON } = await import(pathToFileURL(clientRequire.resolve("seroval")).href);
const { createDefaultSerovalPlugins } = await import(pathToFileURL(clientRequire.resolve("@tanstack/router-core/ssr/client")).href);
const jwt = require("jsonwebtoken");
const tenant = "af100000-0000-4000-8000-000000000061";
let privateConnections = 0, profileReads = 0, permissionReads = 0;
const target = createServer((_req, res) => res.end('{"privateFixture":true}'));
target.on("connection", () => privateConnections++);
await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
const app = await startLocalApp((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  if (request.url.startsWith("/rest/v1/profiles")) {
    profileReads++;
    response.end(JSON.stringify({ tenant_id: tenant, is_active: true }));
  } else if (request.url.startsWith("/rest/v1/rpc/has_permission")) {
    permissionReads++;
    response.end("true");
  } else response.end("[]");
});
try {
  let id;
  for (const file of readdirSync("apps/web/.output/server/_ssr").filter(name => /\.[cm]?js$/.test(name))) {
    const match = readFileSync(`apps/web/.output/server/_ssr/${file}`, "utf8").match(/id:\s*"([^"]+)",\s*name:\s*"testUazapiConnection"/);
    if (match) { id = match[1]; break; }
  }
  assert.ok(id, "Build must contain the real connection test server function");
  const token = jwt.sign({ role: "authenticated", app: "apticket", tenant_id: tenant,
    aud: "authenticated", email: "fixture@example.test" }, "isolated-security-test-jwt-key",
    { subject: "af200000-0000-4000-8000-000000000061", expiresIn: "5m" });
  const response = await fetch(`${app.origin}/_serverFn/${id}`, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json", "x-tsr-serverFn": "true",
  }, body: JSON.stringify(toJSON({ data: { base_url: `http://127.0.0.1:${target.address().port}`, token: "fixture-provider-token" } })) });
  assert.match(response.headers.get("content-type") ?? "", /application\/json/, app.diagnostics());
  const result = fromCrossJSON(await response.json(), { refs: new Map(), plugins: createDefaultSerovalPlugins() });
  assert.ok(result.error && !result.result?.ok);
  assert.ok(profileReads > 0 && permissionReads > 0, "trusted internal Supabase calls and authorization still work");
  assert.equal(privateConnections, 0, "web connection test must reject private TCP destinations");
  console.log("PASS compiled web: external SSRF blocked while trusted internal Supabase requests remain available");
} finally {
  await app.close();
  target.closeAllConnections();
  await new Promise(resolve => target.close(resolve));
}
