import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

// Fixtures only. Never load .env files or connect these tests to real Supabase.
export async function startLocalApp(backend = (_request, response) => {
  response.writeHead(500).end();
}) {
  const rateBuckets = new Map();
  const upstream = createServer(async (request, response) => {
    if (request.url === "/rest/v1/rpc/consume_security_rate_limit") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { _key_hash: key, _limit: limit, _window_ms: windowMs } = JSON.parse(body);
      const now = Date.now(), previous = rateBuckets.get(key);
      const bucket = previous && previous.expires > now ? previous : { count: 0, expires: now + windowMs };
      bucket.count++;
      rateBuckets.set(key, bucket);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        allowed: bucket.count <= limit,
        retry_after_seconds: bucket.count <= limit ? 0 : Math.ceil((bucket.expires - now) / 1000),
      }));
      return;
    }
    return backend(request, response);
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const app = spawn(process.execPath, ["apps/web/.output/server/index.mjs"], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      SUPABASE_URL: upstreamUrl,
      SUPABASE_PUBLISHABLE_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
      JWT_SECRET: "isolated-security-test-jwt-key",
      PORTAL_SESSION_SECRET: "isolated-security-test-portal-key",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  const capture = chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-64 * 1024); };
  app.stdout.on("data", capture);
  app.stderr.on("data", capture);
  const exited = once(app, "exit");
  const origin = `http://127.0.0.1:${port}`;
  async function close() {
    if (app.exitCode === null) app.kill();
    await exited;
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (app.exitCode !== null) throw new Error("Local fixture application exited");
      try {
        await fetch(`${origin}/api/public/portal/session`, { method: "OPTIONS" });
        return { origin, close, diagnostics: () => diagnostics };
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error("Local fixture application did not start; build the web app first");
  } catch (error) {
    await close();
    throw error;
  }
}
