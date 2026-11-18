import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional local tools only. This runner always creates its own loopback
// PostgreSQL cluster; it cannot accept a remote URL or production credentials.
// Bootstrap copied from test-atomic-workflows-postgres.mjs to keep this
// performance experiment independent of its atomic/storage workflows.
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

  for (const index of schema.matchAll(
    /^CREATE (?:UNIQUE )?INDEX [^;]+ ON apticket\.(\w+) [^;]+;/gm,
  )) {
    if (selected.has(index[1]) && !index[0].includes("profiles_email_normalized_uidx"))
      await client.query(index[0]);
  }
  for (const name of [
    "20261117120000_atomic_onboarding_portal_chat.sql",
    "20261117140000_ticket_pagination_metrics.sql",
    "20261117180000_dashboard_latest_query.sql",
  ])
    await client.query(await readFile(path.join(root, "supabase/migrations", name), "utf8"));
  const baseline = (
    await client.query(
      "select pg_get_functiondef('apticket.get_ticket_metrics(integer)'::regprocedure) definition",
    )
  ).rows[0].definition;
  const migrationName = "20261117200000_dashboard_grouped_metrics.sql";
  if (!process.argv.includes("--baseline")) {
    const migration = await readFile(path.join(root, "supabase/migrations", migrationName), "utf8");
    await client.query(migration);
    await client.query(
      await readFile(path.join(root, "supabase/rollbacks", migrationName), "utf8"),
    );
    assert.equal(
      (
        await client.query(
          "select pg_get_functiondef('apticket.get_ticket_metrics(integer)'::regprocedure) definition",
        )
      ).rows[0].definition,
      baseline,
      "rollback must restore the previous function exactly",
    );
    await client.query(migration);
  }
  const candidate = (
    await client.query(
      "select pg_get_functiondef('apticket.get_ticket_metrics(integer)'::regprocedure) definition",
    )
  ).rows[0].definition;
  function withoutTap(sql) {
    return sql
      .replace(/^create extension if not exists pgtap[^;]*;\r?$/gim, "")
      .replace(/^select (?:no_plan\(\)|pass\([^\r\n]+\)|\* from finish\(\));\r?$/gm, "");
  }
  await client.query(
    withoutTap(
      await readFile(path.join(root, "supabase/tests/ticket_pagination_metrics_test.sql"), "utf8"),
    ),
  );
  console.log("PASS existing ticket pagination, authorization and latest regressions");
  const aggregateTests = withoutTap(
    await readFile(path.join(root, "supabase/tests/ticket_metrics_aggregate_test.sql"), "utf8"),
  );
  assert.ok(/rollback;\s*$/.test(aggregateTests), "the independent CI fixture must roll back");
  await client.query(aggregateTests);
  console.log(
    "PASS PostgreSQL: existing ticket regressions and complete aggregate JSON equality for 7/14/30 days, fractional durations, empty/subset RLS and other tenant",
  );
  // Recreate the same fixture distribution at larger scale after the complete
  // independent SQL test has rolled back. Only setup is retained in this local
  // cluster; CI keeps its smaller, transactionally isolated equivalence test.
  await client.query("set apticket.test_metrics_rows='50000'");
  const marker = "-- RESOURCE_FIXTURE_READY:";
  assert.equal(
    aggregateTests.split(marker).length,
    2,
    "resource fixture setup has one explicit boundary",
  );
  await client.query(aggregateTests.slice(0, aggregateTests.indexOf(marker)) + "\ncommit;");
  // EXPLAIN a PL/pgSQL call alone only reports Result. Extract the actual
  // unchanged aggregate statement from each real installed function instead.
  function aggregateSql(definition) {
    const match = definition.match(/\n with ([\s\S]*?) into result from stats;/);
    assert.ok(match, "installed aggregate statement is present");
    let query = `with ${match[1]} from stats`;
    const parameters = {
      v_tenant: "$1::uuid",
      v_now: "$2::timestamptz",
      v_day: "$3::date",
      v_start: "$4::timestamptz",
      v_previous: "$5::timestamptz",
      _period_days: "$6::integer",
    };
    for (const [name, value] of Object.entries(parameters))
      query = query.replace(new RegExp(`\\b${name}\\b`, "g"), value);
    return query;
  }
  const session = (
    await client.query(
      "select p.tenant_id,statement_timestamp() as instant,(statement_timestamp() at time zone 'America/Sao_Paulo')::date::text as day,jsonb_build_object('sub',p.id,'tenant_id',p.tenant_id,'app','apticket','role','authenticated','session_version',p.session_version)::text as claims from apticket.profiles p where email='metrics-main@example.test'",
    )
  ).rows[0];
  await client.query("select set_config('request.jwt.claims',$1,false)", [session.claims]);
  await client.query("set role authenticated; set work_mem='1MB'; set jit=off");
  const report = {
    postgres: (await client.query("select version() version")).rows[0].version,
    fixture: {
      mainTenantRows: 50006,
      otherTenantRows: 6,
      historyDays: 730,
      workMem: "1MB",
      samples: 1,
      warmup: false,
      timezone: "America/Sao_Paulo",
      indexes: "versioned indexes for selected fixture tables",
    },
    limitation:
      "Synthetic local PostgreSQL only; timing is not a production estimate. RLS functions/policies are selected from the versioned schema, not the full Supabase stack.",
    periods: [],
  };
  function cteScans(plan, result = []) {
    if (plan["Node Type"] === "CTE Scan")
      result.push({
        name: plan["CTE Name"],
        rows: plan["Actual Rows"],
        loops: plan["Actual Loops"],
      });
    for (const child of plan.Plans ?? []) cteScans(child, result);
    return result;
  }
  for (const period of [7, 14, 30]) {
    const bounds = (
      await client.query(
        "select ($1::date-($2::int-1))::timestamp at time zone 'America/Sao_Paulo' as start,($1::date-(2*$2::int-1))::timestamp at time zone 'America/Sao_Paulo' as previous",
        [session.day, period],
      )
    ).rows[0];
    const parameters = [
      session.tenant_id,
      session.instant,
      session.day,
      bounds.start,
      bounds.previous,
      period,
    ];
    const measurements = { period, baseline: [], candidate: [] };
    // Resource evidence, not a latency benchmark: one actual plan per query.
    for (let sample = 0; sample < 1; sample++) {
      for (const [label, definition] of [
        ["baseline", baseline],
        ["candidate", candidate],
      ]) {
        const explained = (
          await client.query(
            `explain (analyze,buffers,format json) ${aggregateSql(definition)}`,
            parameters,
          )
        ).rows[0]["QUERY PLAN"][0];
        measurements[label].push({
          milliseconds: explained["Execution Time"],
          tempWrittenBlocks: explained.Plan["Temp Written Blocks"] ?? 0,
          cteScans: cteScans(explained.Plan),
          explain: explained,
        });
      }
    }
    report.periods.push(measurements);
    console.log(
      JSON.stringify({
        period,
        ...Object.fromEntries(
          ["baseline", "candidate"].map((label) => [
            label,
            measurements[label].map(({ explain, ...summary }) => summary),
          ]),
        ),
      }),
    );
  }
  const outputAt = process.argv.indexOf("--output");
  if (outputAt >= 0) {
    assert.ok(process.argv[outputAt + 1], "--output requires a local JSON path");
    const output = path.resolve(process.argv[outputAt + 1]);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  }
  for (const measurement of report.periods)
    for (const sample of measurement.candidate) {
      assert.equal(
        sample.tempWrittenBlocks,
        0,
        "representative aggregate must avoid spilling historical materialization to temporary storage",
      );
      assert.ok(
        sample.cteScans.length > 0 &&
          sample.cteScans.every((scan) => scan.rows <= (measurement.period + 1) ** 2),
        "intermediate rows reprocessed by the calendar must be bounded by calendar bucket pairs",
      );
    }
  console.log(
    "PASS representative resource budget: no temporary writes and bounded intermediate calendar rows; exact rollback/reapply verified",
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
