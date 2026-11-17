import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional local tooling, never production credentials. CI runs the same SQL
// test against its complete Supabase fixture through run-full-sql.py.
const root = fileURLToPath(new URL("../../", import.meta.url));
const toolsDir =
  process.env.APTICKET_PG_TOOLS_DIR ?? path.join(root, "node_modules/.cache/atomic-flow-tools");
const requireTool = createRequire(path.join(toolsDir, "package.json"));
const { Client } = requireTool("pg");
const binaries = await import(
  pathToFileURL(requireTool.resolve("@embedded-postgres/windows-x64")).href
);
const cluster = await mkdtemp(path.join(tmpdir(), "apticket-atomic-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8", windowsHide: true, timeout: 45000 });
  if (result.status !== 0)
    throw new Error(result.error?.message ?? result.stderr ?? "PostgreSQL command failed");
}
let started = false;
const clients = [];
async function connect() {
  const client = new Client({
    host: "127.0.0.1",
    port,
    database: "postgres",
    user: "supabase_admin",
  });
  await client.connect();
  clients.push(client);
  return client;
}
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
  const client = await connect();
  const schema = await readFile(
    path.join(root, "scripts/security/fixtures/full-schema/schema.sql"),
    "utf8",
  );
  const selected = new Set([
    "tenants",
    "profiles",
    "roles",
    "permissions",
    "role_permissions",
    "user_roles",
    "user_permissions",
    "tabela_precos_avulso",
    "companies",
    "contacts",
    "contracts",
    "operating_companies",
    "sla_policies",
    "tickets",
    "messages",
  ]);
  await client.query(
    "create role postgres bypassrls; create role service_role bypassrls; create role authenticated; create role anon; create schema apticket; create schema extensions;",
  );
  for (const match of schema.matchAll(/CREATE TYPE apticket\.\w+ AS ENUM \([\s\S]*?\n\);/g))
    await client.query(match[0]);
  for (const match of schema.matchAll(/CREATE TABLE apticket\.(\w+) \([\s\S]*?\n\);/g))
    if (selected.has(match[1])) await client.query(match[0]);
  await client.query(
    "create sequence apticket.tickets_number_seq; alter table apticket.tickets alter column number set default nextval('apticket.tickets_number_seq');",
  );
  for (const match of schema.matchAll(
    /ALTER TABLE ONLY apticket\.(\w+)\n\s+ADD CONSTRAINT [\s\S]*?;/g,
  )) {
    const refs = [...match[0].matchAll(/REFERENCES apticket\.(\w+)/g)].map((item) => item[1]);
    if (
      selected.has(match[1]) &&
      refs.every((name) => selected.has(name)) &&
      !match[0].includes("REFERENCES auth.")
    )
      await client.query(match[0]);
  }
  await client.query(schema.match(/CREATE UNIQUE INDEX profiles_email_normalized_uidx[^;]+;/)[0]);
  for (const name of [
    "seed_tenant_default_roles",
    "seed_tenant_default_roles_trigger",
    "resolver_atendimento_ticket",
    "classificar_ticket_antes_insert",
  ]) {
    const definition = schema.match(
      new RegExp(`CREATE FUNCTION apticket\\.${name}\\([\\s\\S]*?^\\$\\$;`, "m"),
    );
    assert.ok(definition, name);
    await client.query(definition[0]);
  }
  await client.query(
    "create trigger tenants_seed_default_roles after insert on apticket.tenants for each row execute function apticket.seed_tenant_default_roles_trigger(); create trigger tickets_classificar_atendimento before insert on apticket.tickets for each row execute function apticket.classificar_ticket_antes_insert(); grant usage on schema apticket to service_role,authenticated,anon; grant all on all tables in schema apticket to service_role; grant all on all sequences in schema apticket to service_role;",
  );
  const migrationPath = path.join(
    root,
    "supabase/migrations/20261117120000_atomic_onboarding_portal_chat.sql",
  );
  const migration = await readFile(migrationPath, "utf8");
  await client.query(migration);
  await client.query(
    await readFile(
      path.join(root, "supabase/rollbacks/20261117120000_atomic_onboarding_portal_chat.sql"),
      "utf8",
    ),
  );
  await client.query(migration);
  let tests = await readFile(
    path.join(root, "supabase/tests/atomic_onboarding_portal_chat_test.sql"),
    "utf8",
  );
  // Strip only TAP reporting. Every DO/assert and SQL operation runs unchanged.
  tests = tests
    .replace(/^create extension if not exists pgtap[^;]*;\r?$/gim, "")
    .replace(/^select (?:no_plan\(\)|pass\([^\r\n]+\)|\* from finish\(\));\r?$/gm, "");
  await client.query(tests);
  console.log(
    "PASS PostgreSQL 17.6: actual DDL, migration rollback/reapply, SQL authorization and atomicity regressions",
  );
  if (process.argv.includes("--tickets")) {
    await client.query(
      "create schema auth; create schema apticket_auth_private; grant usage on schema auth,apticket_auth_private to authenticated,anon,service_role;",
    );
    await client.query(
      "create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$; create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;",
    );
    for (const [schemaName, name] of [
      ["apticket_auth_private", "session_is_current"],
      ["apticket", "current_tenant_id"],
      ["apticket", "get_effective_permissions"],
      ["apticket", "has_permission"],
    ]) {
      const definition = schema.match(
        new RegExp(
          `CREATE FUNCTION ${schemaName}\\.${name}\\([\\s\\S]*?AS (\\$\\w*\\$)[\\s\\S]*?\\1;`,
          "m",
        ),
      );
      assert.ok(definition, name);
      await client.query(definition[0]);
    }
    await client.query("grant select on all tables in schema apticket to authenticated;");
    const readTables = new Set(["tickets", "companies", "contacts", "profiles"]);
    for (const table of readTables)
      await client.query(`alter table apticket.${table} enable row level security`);
    for (const policy of schema.matchAll(/^CREATE POLICY [^\n]+ ON apticket\.(\w+) [^\n]+;/gm)) {
      if (
        readTables.has(policy[1]) &&
        (policy[0].includes("AS RESTRICTIVE") ||
          /^CREATE POLICY "(?:tickets select|companies select|contacts select|read profiles in tenant)"/.test(
            policy[0],
          ))
      )
        await client.query(policy[0]);
    }
    const nextMigration = await readFile(
      path.join(root, "supabase/migrations/20261117140000_ticket_pagination_metrics.sql"),
      "utf8",
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (nextMigration) {
      await client.query(nextMigration);
      await client.query(
        await readFile(
          path.join(root, "supabase/rollbacks/20261117140000_ticket_pagination_metrics.sql"),
          "utf8",
        ),
      );
      await client.query(nextMigration);
    }
    const ticketTests = (
      await readFile(path.join(root, "supabase/tests/ticket_pagination_metrics_test.sql"), "utf8")
    )
      .replace(/^create extension if not exists pgtap[^;]*;\r?$/gim, "")
      .replace(/^select (?:no_plan\(\)|pass\([^\r\n]+\)|\* from finish\(\));\r?$/gm, "");
    await client.query(ticketTests);
    console.log(
      "PASS ticket pagination/metrics: >1000 rows, RLS, literal search, stable ordering, bounded payload and rollback/reapply",
    );
  }
  const second = await connect();
  await client.query("set role service_role");
  await second.query("set role service_role");
  const sql =
    "select * from apticket.provision_tenant($1,'Concurrent owner','atomic-race@example.test',$2)";
  const results = await Promise.allSettled([
    client.query(sql, ["Race A", "$2b$12$" + "a".repeat(53)]),
    second.query(sql, ["Race B", "$2b$12$" + "a".repeat(53)]),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "23505");
  assert.equal(
    (
      await client.query(
        "select count(*)::int n from apticket.tenants where name in ('Race A','Race B')",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS concurrent signup: one complete tenant, one duplicate rejection, no orphan tenant",
  );
  const raceTenant = (
    await client.query("select id from apticket.tenants where name in ('Race A','Race B')")
  ).rows[0].id;
  const lockCompany = "af300000-0000-4000-8000-000000000050";
  const lockContact = "af200000-0000-4000-8000-000000000050";
  const lockContract = "af500000-0000-4000-8000-000000000050";
  await client.query(
    "insert into apticket.companies(id,tenant_id,name) values($1,$2,'Lock client')",
    [lockCompany, raceTenant],
  );
  await client.query(
    "insert into apticket.contacts(id,tenant_id,company_id,name,email) values($1,$2,$3,'Lock contact','lock@example.test')",
    [lockContact, raceTenant, lockCompany],
  );
  const operator = (
    await client.query(
      "insert into apticket.operating_companies(tenant_id,legal_name) values($1,'Lock operator') returning id",
      [raceTenant],
    )
  ).rows[0].id;
  await client.query(
    "insert into apticket.contracts(id,tenant_id,company_id,operating_company_id,numero_contrato,starts_at,ends_at,includes_remote,billing_type) values($1,$2,$3,$4,'000001/2026','2025-01-01','2099-12-31',true,'service_invoice')",
    [lockContract, raceTenant, lockCompany, operator],
  );
  await client.query("begin");
  try {
    await client.query("select * from apticket.create_portal_chat($1,$2,'Lock fixture',null,$3)", [
      raceTenant,
      lockContact,
      lockContract,
    ]);
    await second.query("set lock_timeout='200ms'");
    await assert.rejects(
      second.query("update apticket.contacts set is_active=false where id=$1", [lockContact]),
      (error) => error.code === "55P03",
    );
    await assert.rejects(
      second.query("update apticket.contracts set status='suspended' where id=$1", [lockContract]),
      (error) => error.code === "55P03",
    );
  } finally {
    await client.query("rollback");
  }
  console.log(
    "PASS transaction locks: concurrent contact and contract deactivation cannot cross chat creation",
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  if (started) command(binaries.pg_ctl, ["-D", cluster, "-m", "immediate", "-w", "stop"]);
  const resolved = path.resolve(cluster);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("apticket-atomic-")
  )
    throw new Error("Unsafe temporary database cleanup path");
  await rm(resolved, { recursive: true, force: true });
}
