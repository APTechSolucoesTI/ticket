// Real Redis, synthetic keys only. Never load dotenv or accept remote hosts.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const requireApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const { RedisService } = requireApi("./dist/queue/redis.service.js");
const url = new URL(process.env.APTICKET_TEST_REDIS_URL ?? "redis://127.0.0.1:6379");
assert.ok(
  url.protocol === "redis:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    !url.username &&
    !url.password,
  "Only a loopback test Redis without credentials is allowed",
);
const service = new RedisService({ get: () => url.href });
const client = service.client;
client.on("error", () => undefined);
const prefix = `test:apticket:rate:${randomUUID()}:`;
const keys = ["burst", "orphan", "window", "expiry", "zero"].map((name) => prefix + name);
try {
  await new Promise((resolve, reject) => {
    if (client.status === "ready") {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("loopback_test_redis_not_ready"));
    }, 3000);
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("loopback_test_redis_unavailable"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", ready);
      client.off("error", failed);
    };
    client.once("ready", ready);
    client.once("error", failed);
  });
  const burst = await Promise.all(
    Array.from({ length: 100 }, () => service.checkRateLimit(keys[0], 10, 60)),
  );
  assert.equal(burst.filter((result) => result.allowed).length, 10);
  assert.equal(await client.get(keys[0]), "100");
  assert.ok((await client.ttl(keys[0])) > 0);
  await client.set(keys[1], "7");
  assert.equal(await client.ttl(keys[1]), -1);
  assert.deepEqual(await service.checkRateLimit(keys[1], 2, 60), {
    allowed: false,
    retryAfterSeconds: 60,
  });
  assert.ok((await client.ttl(keys[1])) > 0);
  await client.set(keys[4], "0", "EX", 10);
  const zeroBefore = await client.pttl(keys[4]);
  await service.checkRateLimit(keys[4], 2, 60);
  assert.ok(
    (await client.pttl(keys[4])) <= zeroBefore,
    "an existing zero counter must preserve its expiry",
  );
  await client.set(keys[2], "5", "EX", 60);
  const before = await client.pttl(keys[2]);
  await service.checkRateLimit(keys[2], 2, 120);
  assert.ok((await client.pttl(keys[2])) <= before, "valid windows must not slide");
  assert.equal((await service.checkRateLimit(keys[3], 1, 1)).allowed, true);
  assert.equal((await service.checkRateLimit(keys[3], 1, 1)).allowed, false);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await service.checkRateLimit(keys[3], 1, 1)).allowed, true);
  console.log(
    "PASS real Redis: 100 concurrent calls, exact quota, orphan repair, fixed expiry and next window",
  );
} finally {
  if (client.status === "ready") await client.del(...keys).catch(() => undefined);
  client.disconnect();
}
