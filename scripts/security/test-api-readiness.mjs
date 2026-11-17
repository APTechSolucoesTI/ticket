// Actual SDKs and sockets, all destinations loopback and all credentials synthetic.
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const Redis = requireApi("ioredis").default;
const { ReadinessService } = requireApi("./dist/health/readiness.service.js");
const { SupabaseService } = requireApi("./dist/supabase/supabase.service.js");
const sockets = new Set(),
  requests = [];
let hangDatabase = false,
  databaseResponse,
  healthStatus = 200,
  hangHealth = false,
  probe;
const upstream = createHttpServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  if (url.pathname === "/health/ready") {
    if (!hangHealth)
      response
        .writeHead(healthStatus, { "content-type": "application/json" })
        .end(JSON.stringify({ ok: healthStatus === 200 }));
    return;
  }
  requests.push({
    method: request.method,
    path: url.pathname,
    search: url.searchParams,
    headers: request.headers,
  });
  if (hangDatabase) {
    databaseResponse = response;
    return;
  }
  response.writeHead(200, { "content-type": "application/json" }).end();
});
const tcp = createTcpServer({ allowHalfOpen: true }, (socket) => {
  sockets.add(socket);
  socket.on("data", () => undefined);
  socket.on("error", () => undefined);
  socket.on("close", () => sockets.delete(socket));
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
await listen(upstream);
await listen(tcp);
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
const config = { get: (key) => (key === "SUPABASE_URL" ? upstreamUrl : "synthetic-service-key") };
const supabase = new SupabaseService(config);
const main = {
  status: "ready",
  duplicate: (options) => {
    probe = new Redis(`redis://127.0.0.1:${tcp.address().port}`, options);
    return probe;
  },
};
async function runHealthCommand(code) {
  const child = spawn(process.execPath, ["-e", code], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PORT: String(upstream.address().port),
    },
    stdio: "ignore",
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
try {
  const start = Date.now();
  const report = await new ReadinessService({ client: main }, supabase).check();
  assert.deepEqual(report, { ok: false, checks: { database: "up", redis: "down" } });
  assert.ok(Date.now() - start < 3500, "unresponsive Redis is bounded");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(
    probe.stream.destroyed,
    true,
    "probe socket must be destroyed at the deadline, even if peer remains half-open",
  );
  assert.equal(requests[0].method, "HEAD");
  assert.equal(requests[0].path, "/rest/v1/tenants");
  assert.equal(requests[0].search.get("limit"), "0");
  assert.equal(requests[0].headers["accept-profile"], "apticket");
  hangDatabase = true;
  main.status = "end";
  assert.deepEqual(await new ReadinessService({ client: main }, supabase).check(), {
    ok: false,
    checks: { database: "down", redis: "down" },
  });
  for (let attempt = 0; attempt < 20 && !databaseResponse?.destroyed; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(
    databaseResponse.destroyed,
    true,
    "PostgREST request must be cancelled at the deadline",
  );
  const dockerfile = await readFile(new URL("../../apps/api/Dockerfile", import.meta.url), "utf8");
  const command = dockerfile.match(/^\s+CMD node -e "([^"\r\n]+)"/m)?.[1];
  assert.ok(command, "Docker health command");
  assert.equal(await runHealthCommand(command), 0);
  healthStatus = 503;
  assert.equal(await runHealthCommand(command), 1);
  hangHealth = true;
  const healthStart = Date.now();
  assert.equal(await runHealthCommand(command), 1);
  assert.ok(Date.now() - healthStart < 5000, "container check must time out");
  console.log(
    "PASS actual SDK/HTTP: HEAD limit zero, half-open Redis socket destroyed, PostgREST aborted, Docker check 200/503/timeout",
  );
} finally {
  probe?.disconnect();
  probe?.stream?.destroy();
  for (const socket of sockets) socket.destroy();
  upstream.closeAllConnections();
  await Promise.all([
    new Promise((resolve) => upstream.close(resolve)),
    new Promise((resolve) => tcp.close(resolve)),
  ]);
}
