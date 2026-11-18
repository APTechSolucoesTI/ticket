// Real operator CLI + SDK against a loopback HTTP fixture. No dotenv/business data.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const tenant = "bf100000-0000-4000-8000-000000000001",
  id = "bf200000-0000-4000-8000-000000000001";
const objectPath = `${tenant}/pending/fixture.pdf`,
  key = "synthetic-storage-service-key-for-http-only";
const requests = [];
let protectedNow = false;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.apikey, key);
    assert.equal(req.headers.authorization, `Bearer ${key}`);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ path: req.url, method: req.method, body });
    let data;
    if (req.url === "/rest/v1/rpc/audit_ticket_storage") {
      assert.equal(req.headers["content-profile"], "apticket");
      assert.equal(body._tenant, tenant);
      data = [
        {
          id,
          path: objectPath,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          state: "candidate",
        },
      ];
    } else if (req.url === "/rest/v1/rpc/claim_ticket_storage_orphan") {
      assert.equal(body._tenant, tenant);
      assert.equal(body._id, id);
      data = protectedNow
        ? { state: "protected" }
        : { state: "claimed", id, path: objectPath, bucket: "ticket-attachments" };
    } else if (req.url === "/storage/v1/object/ticket-attachments") {
      assert.equal(req.method, "DELETE");
      assert.deepEqual(body, { prefixes: [objectPath] });
      data = [];
    } else throw new Error("unexpected fixture route");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"message":"fixture rejected request"}');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const temp = await mkdtemp(path.join(tmpdir(), "apticket-storage-cli-"));
let child;
async function run(args, expected = 0) {
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../storage/reconcile-ticket-storage.mjs", import.meta.url)), ...args],
    {
      cwd: temp,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        APTICKET_STORAGE_URL: url,
        APTICKET_STORAGE_SERVICE_KEY: key,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let text = "";
  child.stdout.on("data", (chunk) => {
    text += chunk;
  });
  child.stderr.on("data", (chunk) => {
    text += chunk;
  });
  let timer;
  try {
    const [code] = await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("CLI timeout")), 15000);
      }),
    ]);
    assert.equal(code, expected, text);
    assert.ok(!text.includes(key), "credentials must never be printed");
  } finally {
    clearTimeout(timer);
  }
}
try {
  const manifest = path.join(temp, "manifest.json"),
    result = path.join(temp, "result.json");
  await run(["--tenant", tenant, "--report", manifest]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  const inventory = JSON.parse(await readFile(manifest, "utf8"));
  assert.equal(inventory.objects.length, 1);
  await run(["--apply", manifest, "--report", result]);
  assert.equal(JSON.parse(await readFile(result, "utf8")).deletedOrAbsent, 1);
  assert.deepEqual(
    requests.map((r) => r.path),
    [
      "/rest/v1/rpc/audit_ticket_storage",
      "/rest/v1/rpc/claim_ticket_storage_orphan",
      "/storage/v1/object/ticket-attachments",
    ],
  );
  protectedNow = true;
  await run(["--apply", manifest, "--report", path.join(temp, "protected.json")]);
  assert.equal(requests.length, 4, "new reference prevents DELETE");
  const bad = path.join(temp, "bad.json");
  await writeFile(bad, JSON.stringify({ ...inventory, origin: "https://other.example.test" }));
  await run(["--apply", bad, "--report", path.join(temp, "bad-result.json")], 1);
  assert.equal(requests.length, 4, "destination mismatch makes no API call");
  await run(["--tenant", tenant, "--report", manifest], 1);
  assert.equal(requests.length, 4, "report overwrite is refused before API call");
  console.log(
    "PASS real CLI/SDK HTTP: read-only default, scoped RPC/schema, claimed Storage DELETE, protected/stale manifest, destination and report overwrite guards, no credential output",
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("apticket-storage-cli-"));
  await rm(resolved, { recursive: true, force: true });
}
