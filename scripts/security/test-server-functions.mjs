import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { startLocalApp } from "./local-app.mjs";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const startRequire = createRequire(webRequire.resolve("@tanstack/react-start/package.json"));
const clientRequire = createRequire(startRequire.resolve("@tanstack/start-client-core/package.json"));
const { toJSON } = await import(pathToFileURL(clientRequire.resolve("seroval")).href);
const chunks = "apps/web/.output/server/_ssr";
function functionId(name) {
  for (const file of readdirSync(chunks)) {
    if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue;
    const match = readFileSync(`${chunks}/${file}`, "utf8")
      .match(new RegExp(`id:\\s*"([^"]+)",\\s*name:\\s*"${name}"`));
    if (match) return match[1];
  }
  throw new Error(`Compiled server function not found: ${name}`);
}

const app = await startLocalApp();
try {
  const marker = "appsec-response-injection-fixture";
  const injection = {
    data: {},
    result: {
      status: 200,
      headers: { "content-type": "text/html" },
      body: `<html><script>/*${marker}*/</script></html>`,
    },
  };
  for (const [method, name] of [["GET", "getMyPermissions"], ["POST", "login"]]) {
    for (const isServerFn of [false, true]) {
      const url = new URL(`/_serverFn/${functionId(name)}`, app.origin);
      const headers = { "content-type": "application/json" };
      if (isServerFn) headers["x-tsr-serverFn"] = "true";
      const payload = JSON.stringify(toJSON(injection));
      if (method === "GET") url.searchParams.set("payload", payload);
      const response = await fetch(url, {
        method, headers, ...(method === "POST" ? { body: payload } : {}),
      });
      const body = await response.text();
      assert.ok(!body.includes(marker), `${method}: injected result must not escape a failed handler`);
      assert.ok(!(response.headers.get("content-type") ?? "").includes("text/html"),
        `${method}: failed server function must not become executable HTML`);
    }
  }
  console.log("PASS server function response injection: GET/POST, navigation/RPC");
} finally {
  await app.close();
}
