import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const requireTool = createRequire(
  path.join(root, "node_modules/.cache/atomic-flow-tools/package.json"),
);
const { Client } = requireTool("pg");
const binaries = await import(
  pathToFileURL(requireTool.resolve("@embedded-postgres/windows-x64")).href
);
const cluster = await mkdtemp(path.join(tmpdir(), "apticket-storage-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
function command(binary, args) {
  const r = spawnSync(binary, args, { encoding: "utf8", windowsHide: true, timeout: 45000 });
  if (r.status !== 0) throw new Error(r.error?.message ?? r.stderr ?? "PostgreSQL command failed");
}
const clients = [];
async function connect() {
  const c = new Client({ host: "127.0.0.1", port, database: "postgres", user: "supabase_admin" });
  await c.connect();
  clients.push(c);
  return c;
}
let started = false;
try {
  command(binaries.initdb, [
    "-D",
    cluster,
    "-U",
    "supabase_admin",
    "--auth=trust",
    "--no-locale",
    "--encoding=UTF8",
  ]);
  command(binaries.pg_ctl, [
    "-D",
    cluster,
    "-l",
    path.join(cluster, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${port} -F`,
    "-w",
    "start",
  ]);
  started = true;
  const c = await connect();
  await c.query(
    "create role postgres bypassrls; create role service_role bypassrls; create role authenticated; create role anon; create schema apticket; create schema apticket_security_private; create schema storage; create schema extensions; grant usage on schema apticket to authenticated,anon,service_role;",
  );
  const schema = await readFile(
    path.join(root, "scripts/security/fixtures/full-schema/schema.sql"),
    "utf8",
  );
  for (const m of schema.matchAll(/CREATE TYPE apticket\.\w+ AS ENUM \([\s\S]*?\n\);/g))
    await c.query(m[0]);
  const tables = new Set([
    "tenants",
    "tickets",
    "messages",
    "email_pending_messages",
    "whatsapp_pending_messages",
    "stickers",
  ]);
  for (const m of schema.matchAll(/CREATE TABLE apticket\.(\w+) \([\s\S]*?\n\);/g))
    if (tables.has(m[1])) await c.query(m[0]);
  await c.query(
    "create table storage.buckets(id text primary key,name text); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,created_at timestamptz default now(),updated_at timestamptz default now(),metadata jsonb,unique(bucket_id,name)); create table apticket_security_private.ticket_attachment_bindings(tenant_id uuid,ticket_id uuid,object_id uuid,object_path text,public_readable boolean); create table apticket_security_private.scanned_upload_permits(id uuid default gen_random_uuid(),bucket_id text,object_path text,byte_length bigint,sha256 text,expires_at timestamptz);",
  );
  const migrationPath = path.join(
    root,
    "supabase/migrations/20261117190000_ticket_storage_reconciliation.sql",
  );
  const migration = await readFile(migrationPath, "utf8").catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (migration && !process.argv.includes("--baseline")) {
    await c.query(migration);
    await c.query(
      await readFile(
        path.join(root, "supabase/rollbacks/20261117190000_ticket_storage_reconciliation.sql"),
        "utf8",
      ),
    );
    await c.query(migration);
  }
  let tests = await readFile(
    path.join(root, "supabase/tests/ticket_storage_reconciliation_test.sql"),
    "utf8",
  );
  tests = tests
    .replace(/^create extension if not exists pgtap[^;]*;\r?$/gim, "")
    .replace(/^select (?:no_plan\(\)|pass\([^\r\n]+\)|\* from finish\(\));\r?$/gm, "");
  await c.query(tests);
  const tenant = "bf300000-0000-4000-8000-000000000001";
  await c.query(
    "insert into apticket.tenants(id,name,slug) values($1,'Concurrent reconciliation','concurrent-reconciliation')",
    [tenant],
  );
  for (const n of [1, 2])
    await c.query(
      "insert into storage.objects(id,bucket_id,name,created_at,updated_at) values($1,'ticket-attachments',$2,now()-interval '40 days',now()-interval '40 days')",
      [`bf600000-0000-4000-8000-00000000000${n}`, `${tenant}/pending/race-${n}.pdf`],
    );
  const writer = await connect(),
    observer = await connect();
  async function waitsOn(pid) {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      const rows = (
        await observer.query("select wait_event from pg_stat_activity where pid=$1", [pid])
      ).rows;
      if (rows[0]?.wait_event === "advisory" || rows[0]?.wait_event === "relation") return;
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error("expected database lock wait");
  }
  const insert = (connection, n) =>
    connection.query(
      "insert into apticket.email_pending_messages(tenant_id,from_email,content,attachments) values($1,'fixture@example.test','Concurrent reference',$2)",
      [tenant, JSON.stringify([{ path: `${tenant}/pending/race-${n}.pdf` }])],
    );
  await writer.query("begin");
  await insert(writer, 1);
  const pendingClaim = c.query(
    "select apticket.claim_ticket_storage_orphan($1,'bf600000-0000-4000-8000-000000000001') result",
    [tenant],
  );
  await waitsOn(c.processID);
  await writer.query("commit");
  assert.equal(
    (await pendingClaim).rows[0].result.state,
    "protected",
    "claim sees reference committed while waiting",
  );
  await c.query("begin");
  await c.query(
    "select apticket.claim_ticket_storage_orphan($1,'bf600000-0000-4000-8000-000000000002')",
    [tenant],
  );
  const late = insert(writer, 2).then(
    () => null,
    (e) => e,
  );
  await waitsOn(writer.processID);
  await c.query("commit");
  assert.equal((await late).code, "42501", "late reference is rejected after claim commits");
  await assert.rejects(
    c.query(
      "update storage.objects set updated_at=now() where id='bf600000-0000-4000-8000-000000000002'",
    ),
    (e) => e.code === "42501",
  );
  await c.query("begin isolation level repeatable read");
  await assert.rejects(
    c.query(
      "select apticket.claim_ticket_storage_orphan($1,'bf600000-0000-4000-8000-000000000001')",
      [tenant],
    ),
    (e) => e.code === "42501",
  );
  await c.query("rollback");
  await writer.query("begin isolation level repeatable read");
  await assert.rejects(insert(writer, 1), (e) => e.code === "42501");
  await writer.query("rollback");
  // An in-flight claim holds a table read lock. Rollback must wait, then refuse
  // to drop fences once that claim commits, rather than trusting an empty read.
  await c.query("begin");
  await c.query("select * from apticket_security_private.ticket_storage_cleanup_claims");
  const rollback = writer
    .query(
      await readFile(
        path.join(root, "supabase/rollbacks/20261117190000_ticket_storage_reconciliation.sql"),
        "utf8",
      ),
    )
    .then(
      () => null,
      (e) => e,
    );
  await waitsOn(writer.processID);
  await c.query("commit");
  assert.equal((await rollback).code, "23514");
  await writer.query("rollback");
  assert.ok(
    (
      await c.query(
        "select to_regclass('apticket_security_private.ticket_storage_cleanup_claims') relation",
      )
    ).rows[0].relation,
  );
  console.log(
    "PASS real concurrency: writer then claim, claim then writer, storage fence, isolation rejection and rollback serialization",
  );
  console.log(
    "PASS PostgreSQL storage: references, legacy paths, age, scope, pagination, claims, fences, permissions and rollback/reapply",
  );
} finally {
  await Promise.allSettled(clients.map((c) => c.end()));
  if (started) command(binaries.pg_ctl, ["-D", cluster, "-m", "immediate", "-w", "stop"]);
  const resolved = path.resolve(cluster);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("apticket-storage-"));
  await rm(resolved, { recursive: true, force: true });
}
