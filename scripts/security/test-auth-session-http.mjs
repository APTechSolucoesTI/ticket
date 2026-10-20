import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const startRequire = createRequire(require.resolve("@tanstack/react-start/package.json"));
const clientRequire = createRequire(startRequire.resolve("@tanstack/start-client-core/package.json"));
const { toJSON, fromCrossJSON } = await import(pathToFileURL(clientRequire.resolve("seroval")).href);
const { createDefaultSerovalPlugins } = await import(pathToFileURL(clientRequire.resolve("@tanstack/router-core/ssr/client")).href);
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const tenant = "af100000-0000-4000-8000-000000000021";
const user = "af200000-0000-4000-8000-000000000021";
const password = "Fixture password #1";
const newPassword = "Fixture password #2";
const resetToken = "synthetic-reset-token-for-tests";
const inviteToken = "synthetic-invite-token-for-tests";
const hash = value => createHash("sha256").update(value).digest("hex");
const state = { version: 0, passwordHash: await bcrypt.hash(password, 12),
  consumed: false, inviteConsumed: false, rpcError: false, active: true, financialWrites: 0 };
const profile = () => ({ id: user, tenant_id: tenant, name: "Fixture", email: "session@example.test",
  is_active: state.active, password_hash: state.passwordHash, session_version: state.version });
const chunks = "apps/web/.output/server/_ssr";
function id(name) {
  for (const file of readdirSync(chunks).filter(file => /\.[cm]?js$/.test(file))) {
    const match = readFileSync(`${chunks}/${file}`, "utf8").match(new RegExp(`id:\\s*"([^"]+)",\\s*name:\\s*"${name}"`));
    if (match) return match[1];
  }
  throw new Error(`Missing compiled function: ${name}`);
}
const app = await startLocalApp(async (request, response) => {
  const url = new URL(request.url, "http://fixture.test");
  const json = (body, status = 200) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const bearer = request.headers.authorization?.replace(/^Bearer /, "");
  if (bearer?.split(".").length === 3) {
    const claims = jwt.verify(bearer, "isolated-security-test-jwt-key");
    if ((claims.session_version ?? 0) !== state.version || !state.active) {
      return json({ code: "PT401", message: "session_revoked" }, 401);
    }
  }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  if (url.pathname.endsWith("/profiles")) {
    if (request.method === "PATCH" && body.password_hash) {
      state.passwordHash = body.password_hash;
      state.version++;
    }
    return json(profile());
  }
  if (url.pathname.endsWith("/password_resets") || url.pathname.endsWith("/invites")) {
    if (request.method === "PATCH") return state.rpcError
      ? json({ message: "fixture write failure" }, 500) : json([]);
    return json({ id: "fixture-token", profile_id: user, accepted_at: null,
      expires_at: new Date(Date.now() + 60_000).toISOString() });
  }
  if (/\/rpc\/complete_(password_reset|invite)$/.test(url.pathname)) {
    if (state.rpcError) return json({ message: "fixture write failure" }, 500);
    const invite = url.pathname.endsWith("complete_invite");
    if (body._token_hash !== hash(invite ? inviteToken : resetToken)
      || (invite ? state.inviteConsumed : state.consumed)) return json({ code: "22023" }, 400);
    if (invite) { state.inviteConsumed = true; state.active = true; }
    else state.consumed = true;
    state.version++;
    state.passwordHash = body._password_hash;
    return json(profile());
  }
  if (url.pathname.endsWith("/rpc/cancelar_medicao_contrato_confirmada")) {
    state.financialWrites++;
    return json({ id: "fixture-measurement" });
  }
  return json([]);
});

async function call(name, data, token, method = "POST") {
  const payload = JSON.stringify(toJSON({ data }));
  const url = new URL(`/_serverFn/${id(name)}`, app.origin);
  if (method === "GET") url.searchParams.set("payload", payload);
  const response = await fetch(url, { method, headers: {
    "content-type": "application/json", "x-tsr-serverFn": "true",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, ...(method === "POST" ? { body: payload } : {}) });
  return fromCrossJSON(await response.json(), { refs: new Map(), plugins: createDefaultSerovalPlugins() });
}
try {
  const login = await call("login", { email: "session@example.test", password });
  const oldToken = login.result.token;
  state.rpcError = true;
  const failed = await call("resetPassword", { token: resetToken, password: newPassword });
  assert.ok(failed.error && !failed.result?.token, "failed credential transaction must not issue a session");
  assert.equal(state.version, 0, "failed transaction must preserve the previous password/session");
  state.rpcError = false;
  const reset = await call("resetPassword", { token: resetToken, password: newPassword });
  const fresh = reset.result.token;
  assert.equal(jwt.decode(fresh).session_version, 1);
  assert.equal((await call("getMyPermissions", undefined, oldToken, "GET")).result, undefined);
  assert.deepEqual((await call("getMyPermissions", undefined, fresh, "GET")).result, []);
  const relogin = await call("login", { email: "session@example.test", password: newPassword });
  assert.equal(jwt.decode(relogin.result.token).session_version, 1, "login reads the current version");
  const replay = await call("resetPassword", { token: resetToken, password: newPassword });
  assert.ok(replay.error && !replay.result?.token);
  assert.equal(state.version, 1);
  const cancellation = await call("cancelContractMeasurement", { token: oldToken,
    measurementId: "af300000-0000-4000-8000-000000000021", password: newPassword,
    reason: "Synthetic security regression test" });
  assert.ok(cancellation.error);
  assert.equal(state.financialWrites, 0, "privileged service-role action rejects the revoked token");
  const changed = await call("changeMyPassword", { currentPassword: newPassword,
    newPassword: password, confirmPassword: password }, fresh);
  assert.equal(jwt.decode(changed.result.token).session_version, 2,
    "changing a password renews the current browser session at the updated version");
  assert.ok((await call("getMyProfile", undefined, fresh, "GET")).error,
    "the earlier session cannot use a service-role profile handler");
  assert.deepEqual((await call("getMyPermissions", undefined, changed.result.token, "GET")).result, []);
  state.active = false;
  const invitation = await call("acceptInvite", { token: inviteToken, password: newPassword });
  assert.equal(jwt.decode(invitation.result.token).session_version, 3);
  assert.equal(state.active, true);
  assert.ok((await call("acceptInvite", { token: inviteToken, password: newPassword })).error);
  console.log("PASS credential HTTP: failed persistence, reset/replay, fresh login, revoked privileged action and invite");
} finally {
  await app.close();
}
