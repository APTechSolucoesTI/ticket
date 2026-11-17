// Redis protocol fixture and Nest lifecycle, loopback only; no Redis daemon or dotenv.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { RedisIoAdapter } = requireApi("./dist/channels/chat/redis-io.adapter.js");
const { RedisService } = requireApi("./dist/queue/redis.service.js");
const { startApplication } = requireApi("./dist/runtime/application-lifecycle.js");
const { NestFactory } = requireApi("@nestjs/core");
const { Module, Global, Inject, Injectable } = requireApi("@nestjs/common");
const { ConfigService } = requireApi("@nestjs/config");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function checkedUrl(value) {
  const url = new URL(value);
  assert.ok(url.protocol === "redis:" && url.hostname === "127.0.0.1");
  return url.href;
}
const report = (event) => new Promise((resolve) => process.send?.({ event }, () => resolve()));

async function phaseChild() {
  const url = checkedUrl(process.env.LIFECYCLE_FIXTURE_REDIS_URL);
  const client = {
    status: "ready",
    quit: async () => {
      await report("redis_quit");
      client.status = "end";
      return "OK";
    },
    disconnect: () => {
      client.status = "end";
    },
  };
  const shared = Object.assign(Object.create(RedisService.prototype), { client });
  class SharedModule {}
  Global()(SharedModule);
  Module({
    providers: [
      { provide: RedisService, useValue: shared },
      { provide: ConfigService, useValue: { get: () => url } },
    ],
    exports: [RedisService, ConfigService],
  })(SharedModule);
  class Consumer {
    constructor(redis) {
      this.redis = redis;
    }
    async onApplicationShutdown() {
      await delay(40);
      assert.equal(this.redis.client.status, "ready");
      await report("consumer_drained");
    }
  }
  Inject(RedisService)(Consumer, undefined, 0);
  Injectable()(Consumer);
  class ConsumersModule {}
  Module({ providers: [Consumer] })(ConsumersModule);
  class RootModule {}
  Module({ imports: [SharedModule, ConsumersModule] })(RootModule);
  const app = await NestFactory.create(RootModule, { logger: false });
  const adapter = new RedisIoAdapter(app);
  await startApplication(app, adapter, 0);
  process.on("message", (message) => {
    if (message?.type === "shutdown") process.emit("SIGTERM");
  });
  await report("ready");
}

function parseCommand(buffer) {
  let position = 0;
  const line = () => {
    const end = buffer.indexOf("\r\n", position);
    if (end < 0) return null;
    const value = buffer.toString("utf8", position, end);
    position = end + 2;
    return value;
  };
  const header = line();
  if (header === null) return null;
  assert.equal(header[0], "*");
  const args = [];
  for (let index = 0; index < Number(header.slice(1)); index++) {
    const length = line();
    if (length === null) return null;
    assert.equal(length[0], "$");
    const size = Number(length.slice(1));
    if (buffer.length < position + size + 2) return null;
    args.push(buffer.toString("utf8", position, position + size));
    position += size + 2;
  }
  return { args, used: position };
}

async function fixtures() {
  let mode = "hang";
  const sockets = new Set(),
    commands = [];
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let command;
      while ((command = parseCommand(buffer))) {
        buffer = buffer.subarray(command.used);
        const name = command.args[0].toUpperCase();
        commands.push(command.args);
        if (mode === "hang" || name === "QUIT") continue;
          if(name === "HELLO")socket.write("%2\r\n+server\r\n+redis\r\n+proto\r\n:3\r\n");
          else if (name === "INFO") {
          const info = "redis_version:7.2.0\r\nloading:0\r\n";
          socket.write(`$${Buffer.byteLength(info)}\r\n${info}\r\n`);
        } else socket.write(name === "PING" ? "+PONG\r\n" : "+OK\r\n");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `redis://fixture-user:fixture-pass@127.0.0.1:${server.address().port}/4`;
  const context = { get: () => ({ get: () => url }) };
  let adapter, shared, child;
  const temp = await mkdtemp(path.join(tmpdir(), "apticket-lifecycle-"));
  try {
    adapter = new RedisIoAdapter(context);
    const start = Date.now();
    await assert.rejects(adapter.connectToRedis(), /chat_redis_startup_failed/);
    assert.ok(Date.now() - start < 6500, "startup must be bounded");
    await adapter.dispose();
    for (const socket of sockets) socket.destroy();
    mode = "ready";
    adapter = new RedisIoAdapter(context);
    await Promise.all([adapter.connectToRedis(), adapter.connectToRedis()]);
    const owned = [...adapter.clients];
    assert.equal(owned.length, 2);
    assert.ok(
      commands.some(
        (args) =>
          (args[0].toUpperCase() === "AUTH" && args[1] === "fixture-user" && args[2] === "fixture-pass") ||
          (args[0].toUpperCase() === "HELLO" && args[2] === "AUTH" && args[3] === "fixture-user" && args[4] === "fixture-pass"),
      ),
    );
    assert.ok(commands.some((args) => args[0].toUpperCase() === "SELECT" && args[1] === "4"));
    await adapter.dispose();
    await delay(60);
    assert.ok(owned.every((client) => client.stream.destroyed));
    shared = new RedisService({ get: () => url });
    shared.client.on("error", () => undefined);
    if (shared.client.status !== "ready") await once(shared.client, "ready");
    const stop = Date.now();
    await shared.onApplicationShutdown();
    await delay(60);
    assert.ok(Date.now() - stop < 3000, "QUIT must be bounded");
    assert.equal(shared.client.stream.destroyed, true);
    const events = [];
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--phase-child"], {
      cwd: temp,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        LIFECYCLE_FIXTURE_REDIS_URL: url,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk;
    });
    let readyResolve;
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    child.on("message", (message) => {
      events.push(message.event);
      if (message.event === "ready") readyResolve();
    });
    const exited = once(child, "exit");
    let timer;
    try {
      await Promise.race([
        ready,
        exited.then(() => {
          throw new Error(diagnostics || "child exited before ready");
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("child startup timed out")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (process.platform === "win32") child.send({ type: "shutdown" });
    else child.kill("SIGTERM");
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("child shutdown timed out")), 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.ok(events.includes("consumer_drained"));
    assert.ok(events.indexOf("redis_quit") > events.indexOf("consumer_drained"));
    // Actual production entry point: empty cwd prevents reading a user's .env.
    mode = "hang";
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../../apps/api/dist/main.js", import.meta.url))],
      {
        cwd: temp,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: "test",
          PORT: "3001",
          SUPABASE_URL: "http://127.0.0.1:1",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key-for-lifecycle",
          JWT_SECRET: "synthetic-jwt-key-for-lifecycle",
          SECRETS_ENCRYPTION_KEY: "0".repeat(64),
          REDIS_URL: url,
          CLAMAV_HOST: "127.0.0.1",
          SWAGGER_ENABLED: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const failedStart = Date.now();
    const failure = once(child, "exit");
    let failureTimer;
    let code;
    try {
      [code] = await Promise.race([
        failure,
        new Promise((_, reject) => {
          failureTimer = setTimeout(
            () => reject(new Error("production startup remained pending")),
            11000,
          );
        }),
      ]);
    } finally {
      clearTimeout(failureTimer);
    }
    assert.equal(code, 1);
    assert.ok(output.includes("api_startup_failed"));
    assert.ok(!output.includes("fixture-pass"));
    assert.ok(Date.now() - failedStart < 11000);
    console.log(
      "PASS lifecycle: bounded Redis startup, credentials/database preserved, Pub/Sub disposal, bounded QUIT, Nest signal ordering and fatal bootstrap cleanup",
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await adapter?.dispose();
    shared?.client.disconnect();
    shared?.client.stream?.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("apticket-lifecycle-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
if (process.argv.includes("--phase-child")) await phaseChild();
else await fixtures();
