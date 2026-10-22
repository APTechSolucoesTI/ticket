import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const start = createRequire(require.resolve("@tanstack/react-start/package.json"));
const client = createRequire(start.resolve("@tanstack/start-client-core/package.json"));
const { toJSON, fromCrossJSON } = await import(pathToFileURL(client.resolve("seroval")).href);
const { createDefaultSerovalPlugins } = await import(
  pathToFileURL(client.resolve("@tanstack/router-core/ssr/client")).href
);
const ids = new Map();
for (const file of readdirSync("apps/web/.output/server/_ssr").filter((file) =>
  /\.[cm]?js$/.test(file),
)) {
  for (const match of readFileSync(`apps/web/.output/server/_ssr/${file}`, "utf8").matchAll(
    /id:\s*"([^"]+)",\s*name:\s*"([^"]+)"/g,
  ))
    ids.set(match[2], match[1]);
}
let lookups = 0,
  otpLookups = 0,
  completions = 0,
  unavailable = false;
const calls = [],
  buckets = new Map();
const backend = async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const path = new URL(request.url, "http://fixture.test").pathname;
  const json = (data, status = 200) =>
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  if (path.endsWith("/profiles")) {
    lookups++;
    // All login/recovery identities are absent. Signup's duplicate profile
    // stops before any tenant insertion or external side effect.
    return json(request.url.includes("signup%40") ? { id: "duplicate" } : null);
  }
  if (path.endsWith("/contacts")) {
    otpLookups++;
    return json([]);
  }
  if (/\/rpc\/complete_(invite|password_reset)$/.test(path)) {
    completions++;
    assert.match(body._token_hash, /^[a-f0-9]{64}$/);
    return json({ code: "22023", message: "Synthetic invalid token" }, 400);
  }
  throw new Error("Unexpected integration access: " + path);
};
const options = {
  rateBuckets: buckets,
  onRateLimitCall: (payload) => calls.push(payload),
  rateLimitUnavailable: () => unavailable,
};
const one = await startLocalApp(backend, options);
const two = await startLocalApp(backend, options);
async function invoke(app, name, data, origin = "198.51.100.10", prefix = "203.0.113.1") {
  assert.ok(ids.has(name), name);
  const response = await fetch(`${app.origin}/_serverFn/${ids.get(name)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tsr-serverFn": "true",
      "x-forwarded-for": `${prefix}, ${origin}`,
    },
    body: JSON.stringify(toJSON({ data })),
  });
  const result = fromCrossJSON(await response.json(), {
    refs: new Map(),
    plugins: createDefaultSerovalPlugins(),
  });
  return { status: response.status, retry: response.headers.get("retry-after"), ...result };
}
function denied(result) {
  assert.equal(result.status, 429);
  assert.ok(result.error && !result.result?.token);
  assert.ok(Number(result.retry) > 0);
}
try {
  const before = lookups;
  const attempts = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      invoke(
        index % 2 ? one : two,
        "login",
        {
          email: index % 2 ? "Shared@Example.test" : "shared@example.test",
          password: "incorrect",
        },
        `198.51.100.${index + 20}`,
      ),
    ),
  );
  assert.equal(
    attempts.filter((result) => result.status === 429).length,
    2,
    "shared identity quota across two web processes",
  );
  assert.equal(lookups - before, 10, "denied attempts never query profiles or bcrypt");
  const originStart = lookups;
  for (let index = 0; index < 100; index++) {
    const result = await invoke(
      one,
      "login",
      { email: `origin-${index}@example.test`, password: "incorrect" },
      "198.51.100.200",
      `203.0.113.${(index % 250) + 1}`,
    );
    assert.notEqual(result.status, 429);
  }
  denied(
    await invoke(
      two,
      "login",
      { email: "last@example.test", password: "incorrect" },
      "198.51.100.200",
      "192.0.2.250",
    ),
  );
  assert.equal(
    lookups - originStart,
    100,
    "forged forwarding prefixes do not reset the origin quota",
  );
  for (let index = 0; index < 5; index++)
    assert.deepEqual(
      (await invoke(one, "requestPasswordReset", { email: "absent@example.test" })).result,
      { ok: true },
    );
  denied(await invoke(two, "requestPasswordReset", { email: "ABSENT@example.test" }));
  for (const name of ["resetPassword", "acceptInvite"]) {
    const before = completions;
    for (let index = 0; index < 5; index++)
      assert.notEqual(
        (
          await invoke(one, name, {
            token: "synthetic-invalid-credential-token",
            password: "Synthetic password #1",
          })
        ).status,
        429,
      );
    denied(
      await invoke(two, name, {
        token: "synthetic-invalid-credential-token",
        password: "Synthetic password #1",
      }),
    );
    assert.equal(completions - before, 5, "limit precedes credential transaction");
  }
  const signupStart = lookups;
  for (let index = 0; index < 5; index++)
    await invoke(one, "signUpTenant", {
      name: "Fixture",
      company: "Fixture",
      email: "signup@example.test",
      password: "Synthetic password #1",
    });
  denied(
    await invoke(two, "signUpTenant", {
      name: "Fixture",
      company: "Fixture",
      email: "signup@example.test",
      password: "Synthetic password #1",
    }),
  );
  assert.equal(lookups - signupStart, 5);
  for (let index = 0; index < 6; index++) {
    const response = await fetch(
      `${index % 2 ? one.origin : two.origin}/api/public/portal/request-otp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${index + 100}`,
        },
        body: JSON.stringify({ email: "otp-absent@example.test" }),
      },
    );
    assert.equal(response.status, index < 5 ? 200 : 429);
  }
  assert.equal(otpLookups, 5);
  unavailable = true;
  const outageStart = lookups;
  denied(await invoke(one, "login", { email: "store-outage@example.test", password: "incorrect" }));
  assert.equal(lookups, outageStart, "store outage fails closed before credentials");
  assert.ok(calls.every((call) => /^[a-f0-9]{64}$/.test(call._key_hash)));
  assert.ok(calls.some((call) => call._limit === 5 && call._window_ms === 60 * 60 * 1000));
  assert.ok(calls.some((call) => call._limit === 10 && call._window_ms === 15 * 60 * 1000));
  assert.ok(!JSON.stringify(calls).includes("@example.test"));
  console.log(
    "PASS authentication limits: shared identity/origin quotas, all five handlers, forwarding spoofing and store outage",
  );
} finally {
  await Promise.all([one.close(), two.close()]);
}
