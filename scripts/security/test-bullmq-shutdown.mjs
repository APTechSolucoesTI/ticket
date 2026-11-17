// Real BullMQ/Nest/Redis integration. Only unique synthetic queue/key names.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { Queue } = requireApi("bullmq");
const Redis = requireApi("ioredis");
const { NestFactory } = requireApi("@nestjs/core");
const { Module, Inject, Injectable } = requireApi("@nestjs/common");
const { ConfigModule } = requireApi("@nestjs/config");
const { BullModule, Processor, WorkerHost } = requireApi("@nestjs/bullmq");
const { QueueModule } = requireApi("./dist/queue/queue.module.js");
const { RedisService } = requireApi("./dist/queue/redis.service.js");
const { RedisIoAdapter } = requireApi("./dist/channels/chat/redis-io.adapter.js");
const { startApplication } = requireApi("./dist/runtime/application-lifecycle.js");
const url = new URL(process.env.APTICKET_TEST_REDIS_URL ?? "redis://127.0.0.1:6379");
assert.ok(
  url.protocol === "redis:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password,
  "loopback fixture without credentials required",
);
async function within(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const send = (event) => new Promise((resolve) => process.send?.({ event }, () => resolve()));

async function childMain() {
  const name = process.env.LIFECYCLE_QUEUE_NAME,
    key = process.env.LIFECYCLE_RATE_KEY;
  assert.ok(/^lifecycle-test-[a-f0-9-]+$/.test(name));
  assert.ok(/^test:apticket:lifecycle:[a-f0-9-]+$/.test(key));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  process.on("message", (message) => {
    if (message?.type === "release") release();
    else if (message?.type === "shutdown") process.emit("SIGTERM");
  });
  class DrainWorker extends WorkerHost {
    constructor(shared) {
      super();
      this.shared = shared;
    }
    async process() {
      await send("active");
      await pending;
      assert.equal((await this.shared.checkRateLimit(key, 1, 60)).allowed, true);
      await send("job_drained");
    }
  }
  Inject(RedisService)(DrainWorker, undefined, 0);
  Injectable()(DrainWorker);
  Processor(name)(DrainWorker);
  class ShutdownMarker {
    async beforeApplicationShutdown() {
      await send("shutdown_started");
    }
  }
  class RootModule {}
  Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => ({ REDIS_URL: url.href })],
      }),
      QueueModule,
      BullModule.registerQueue({ name }),
    ],
    providers: [DrainWorker, ShutdownMarker],
  })(RootModule);
  const app = await NestFactory.create(RootModule, { logger: false });
  await startApplication(app, new RedisIoAdapter(app), 0);
  await send("ready");
}

async function parentMain() {
  const id = randomUUID(),
    name = `lifecycle-test-${id}`,
    key = `test:apticket:lifecycle:${id}`;
  const raw = new Redis(url.href, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    disconnectTimeout: 0,
  });
  raw.on("error", () => undefined);
  const queue = new Queue(name, { connection: raw });
  queue.on("error", () => undefined);
  let child;
  try {
    await within(queue.waitUntilReady(), 3000, "test Redis unavailable");
    const events = [],
      bus = new EventEmitter();
    let diagnostics = "";
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker-child"], {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        APTICKET_TEST_REDIS_URL: url.href,
        LIFECYCLE_QUEUE_NAME: name,
        LIFECYCLE_RATE_KEY: key,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stderr.on("data", (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-8192);
    });
    child.on("message", (message) => {
      events.push(message.event);
      bus.emit(message.event);
      if (message.event === "shutdown_started") child.send({ type: "release" });
    });
    const exited = once(child, "exit");
    const event = async (name) => {
      if (events.includes(name)) return;
      await within(
        Promise.race([
          once(bus, name),
          exited.then(() => {
            throw new Error(diagnostics || "worker child exited");
          }),
        ]),
        10000,
        `missing ${name}`,
      );
    };
    await event("ready");
    await queue.add("drain", {}, { jobId: "drain", removeOnComplete: false, removeOnFail: false });
    await event("active");
    if (process.platform === "win32") child.send({ type: "shutdown" });
    else child.kill("SIGTERM");
    const termination = await within(exited, 10000, "worker failed to drain on SIGTERM");
    // Nest re-sends SIGTERM after successful hooks. A hook error exits with code 1.
    // Windows does not preserve POSIX termination signals; Linux CI checks this contract.
    if (process.platform !== "win32")
      assert.deepEqual(termination, [null, "SIGTERM"], diagnostics || "unexpected worker exit");
    assert.ok(
      events.includes("job_drained"),
      "active job must use shared Redis while shutting down",
    );
    const job = await queue.getJob("drain");
    assert.ok(job);
    assert.equal(await job.getState(), "completed");
    console.log(
      "PASS real BullMQ: SIGTERM waits for active job, shared Redis remains available and job is completed",
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    try {
      await within(
        (async () => {
          const client = await queue.client;
          await client.del(key);
          await queue.obliterate({ force: true });
        })(),
        2000,
        "cleanup timeout",
      );
    } catch {
      /* Only this test's UUID namespace may remain after an infrastructure failure. */
    }
    try {
      await within(queue.close(), 2000, "queue close timeout");
    } catch {
      /* The owned client is disconnected below even if initialization never finished. */
    } finally {
      raw.disconnect();
    }
  }
}
if (process.argv.includes("--worker-child")) await childMain();
else await parentMain();
