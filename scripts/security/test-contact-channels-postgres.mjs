import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Local disposable PostgreSQL. The complete Supabase fixture also discovers
// supabase/tests/contact_required_channel_test.sql through run-full-sql.py.
const root = fileURLToPath(new URL("../../", import.meta.url));
const toolsDir =
  process.env.APTICKET_PG_TOOLS_DIR ?? path.join(root, "node_modules/.cache/atomic-flow-tools");
const requireTool = createRequire(path.join(toolsDir, "package.json"));
const { Client } = requireTool("pg");
const binaries = await import(
  pathToFileURL(requireTool.resolve("@embedded-postgres/windows-x64")).href
);
const cluster = await mkdtemp(path.join(tmpdir(), "apticket-contact-channels-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8", windowsHide: true, timeout: 45000 });
  if (result.status !== 0)
    throw new Error(result.error?.message ?? result.stderr ?? "PostgreSQL command failed");
}

const client = new Client({
  host: "127.0.0.1",
  port,
  database: "postgres",
  user: "supabase_admin",
});
let started = false;
let connected = false;
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
  await client.connect();
  connected = true;
  client.on("notice", (notice) => {
    if (notice.message.startsWith("PASS")) console.log(notice.message);
  });
  await client.query(`
    create role postgres bypassrls;
    create role service_role bypassrls;
    create role authenticated;
    create role anon;
    create schema apticket;
    create schema apticket_auth_private;
    create schema auth;
  `);
  await client.query(
    await readFile(
      path.join(root, "scripts/security/fixtures/full-schema/auth-helpers.sql"),
      "utf8",
    ),
  );
  const schema = (
    await readFile(path.join(root, "scripts/security/fixtures/full-schema/schema.sql"), "utf8")
  ).replaceAll("\r\n", "\n");
  for (const match of schema.matchAll(/CREATE TYPE apticket\.\w+ AS ENUM \([\s\S]*?\n\);/g))
    await client.query(match[0]);
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
    "contact_companies",
  ]);
  for (const match of schema.matchAll(/CREATE TABLE apticket\.(\w+) \([\s\S]*?\n\);/g)) {
    if (selected.has(match[1])) await client.query(match[0]);
  }
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
  for (const name of [
    "apticket_auth_private.session_is_current",
    "apticket.current_tenant_id",
    "apticket.get_effective_permissions",
    "apticket.has_permission",
    "apticket.seed_tenant_default_roles",
    "apticket.seed_tenant_default_roles_trigger",
    "apticket.set_contact_companies",
  ]) {
    const definition = schema.match(
      new RegExp(
        `CREATE FUNCTION ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\bAS (\\$[a-z_]*\\$)[\\s\\S]*?\\1;`,
      ),
    );
    assert.ok(definition, name);
    await client.query(definition[0]);
  }
  await client.query(`
    create trigger tenants_seed_default_roles after insert on apticket.tenants
      for each row execute function apticket.seed_tenant_default_roles_trigger();
    insert into apticket.permissions(module,action)
      values('contatos','view'),('contatos','create'),('contatos','edit'),('contatos','delete');
    grant usage on schema apticket,auth,apticket_auth_private to authenticated,postgres;
    grant select on all tables in schema apticket to authenticated,postgres;
    grant insert,update,delete on apticket.contacts,apticket.contact_companies to authenticated;
  `);
  for (const table of ["contacts", "contact_companies"]) {
    await client.query(`alter table apticket.${table} enable row level security`);
    for (const match of schema.matchAll(
      new RegExp(`CREATE POLICY [^\\n]+ ON apticket\\.${table} [^\\n]+;`, "g"),
    ))
      await client.query(match[0]);
  }
  const secondary = await readFile(
    path.join(root, "supabase/migrations/20261006115145_contact_secondary_channels.sql"),
    "utf8",
  );
  await client.query(
    secondary.slice(
      secondary.indexOf("create schema if not exists"),
      secondary.indexOf("notify pgrst"),
    ),
  );

  const migrationPath = path.join(
    root,
    "supabase/migrations/20261118120000_contacts_require_channel.sql",
  );
  const migration = await readFile(migrationPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (migration && !process.argv.includes("--baseline")) await client.query(migration);
  await client.query(
    await readFile(path.join(root, "supabase/tests/contact_required_channel_test.sql"), "utf8"),
  );
  await client.query(
    await readFile(path.join(root, "supabase/tests/contact_secondary_channels_test.sql"), "utf8"),
  );
  async function validated(name) {
    const result = await client.query(
      "select convalidated from pg_constraint where conrelid='apticket.contacts'::regclass and conname=$1",
      [name],
    );
    return result.rows[0]?.convalidated;
  }
  assert.equal(
    await validated("contacts_channel_required"),
    true,
    "clean databases validate the new constraint",
  );
  const rollback = await readFile(
    path.join(root, "supabase/rollbacks/20261118120000_contacts_require_channel.sql"),
    "utf8",
  );
  await client.query(rollback);
  assert.equal(
    await validated("contacts_registered_email_required"),
    true,
    "clean rollback validates the former constraint",
  );
  await client.query(migration);
  await client.query(`
    insert into apticket.tenants(id,name,slug)
      values('cd100000-0000-4000-8000-000000000003','Legacy channel lifecycle','legacy-channel-lifecycle');
    insert into apticket.companies(id,tenant_id,name)
      values('cd300000-0000-4000-8000-000000000003','cd100000-0000-4000-8000-000000000003','Rollback phone client');
    insert into apticket.contacts(id,tenant_id,company_id,name,phone)
      values('cd400000-0000-4000-8000-000000000003','cd100000-0000-4000-8000-000000000003',
        'cd300000-0000-4000-8000-000000000003','Registered phone only','11911114141');
  `);
  const contactsBeforeRollback = (
    await client.query("select row_to_json(c) data from apticket.contacts c order by id")
  ).rows;
  const identifiersBeforeRollback = (
    await client.query(
      "select * from apticket_contact_private.identifiers order by tenant_id,kind,value",
    )
  ).rows;
  await client.query(rollback);
  assert.equal(
    await validated("contacts_registered_email_required"),
    false,
    "rollback preserves forward phone-only contacts",
  );
  assert.deepEqual(
    (await client.query("select row_to_json(c) data from apticket.contacts c order by id")).rows,
    contactsBeforeRollback,
  );
  assert.deepEqual(
    (
      await client.query(
        "select * from apticket_contact_private.identifiers order by tenant_id,kind,value",
      )
    ).rows,
    identifiersBeforeRollback,
  );
  await assert.rejects(
    client.query(
      "update apticket.contacts set name='Old rule must reject this update' where id='cd400000-0000-4000-8000-000000000003'",
    ),
    (error) => error.code === "23514" && error.constraint === "contacts_registered_email_required",
  );
  await client.query(`
    insert into apticket.contacts(id,tenant_id,name)
      values('cd400000-0000-4000-8000-000000000004','cd100000-0000-4000-8000-000000000003','Legacy draft without channel');
  `);
  const contactsBeforeMigration = (
    await client.query("select row_to_json(c) data from apticket.contacts c order by id")
  ).rows;
  await client.query(migration);
  assert.equal(
    await validated("contacts_channel_required"),
    false,
    "legacy empty drafts leave the constraint NOT VALID",
  );
  assert.deepEqual(
    (await client.query("select row_to_json(c) data from apticket.contacts c order by id")).rows,
    contactsBeforeMigration,
  );
  await assert.rejects(
    client.query(
      "update apticket.contacts set name='Legacy update requires a channel' where id='cd400000-0000-4000-8000-000000000004'",
    ),
    (error) => error.code === "23514" && error.constraint === "contacts_channel_required",
  );
  await assert.rejects(
    client.query(
      "update apticket.contacts set company_id='cd300000-0000-4000-8000-000000000003' where id='cd400000-0000-4000-8000-000000000004'",
    ),
    (error) => error.code === "23514" && error.constraint === "contacts_channel_required",
  );
  await assert.rejects(
    client.query(
      "insert into apticket.contacts(tenant_id,name) values('cd100000-0000-4000-8000-000000000003','New empty draft')",
    ),
    (error) => error.code === "23514" && error.constraint === "contacts_channel_required",
  );
  await client.query(
    "update apticket.contacts set phone='11900004141' where id='cd400000-0000-4000-8000-000000000004'",
  );
  assert.equal(
    (
      await client.query(
        "select value from apticket_contact_private.identifiers where contact_id='cd400000-0000-4000-8000-000000000004'",
      )
    ).rows[0]?.value,
    "5511900004141",
    "legacy draft can be corrected with a real channel",
  );
  await client.query(rollback);
  await client.query(migration);
  assert.equal(
    await validated("contacts_channel_required"),
    true,
    "reapply validates after legacy channels are corrected",
  );
  console.log(
    "PASS PostgreSQL contact channels migration: clean validation, legacy preservation, update enforcement, rollback and reapply",
  );
  console.log("PASS PostgreSQL contact channels SQL tests");
} finally {
  if (connected) await client.end();
  if (started) command(binaries.pg_ctl, ["-D", cluster, "-m", "immediate", "-w", "stop"]);
  const resolved = path.resolve(cluster);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith("apticket-contact-channels-"));
  await rm(resolved, { recursive: true, force: true });
}
