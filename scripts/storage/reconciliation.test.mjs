import test from "node:test";
import assert from "node:assert/strict";
import { auditStorage, applyManifest } from "./reconciliation.mjs";
const tenant = "bf100000-0000-4000-8000-000000000001";
const row = (n, state = "candidate") => ({
  id: `bf200000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  path: `${tenant}/pending/${n}.pdf`,
  state,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const origin = "https://fixture.example.test";
function fixture(pages = [[row(1)]]) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, args) => {
        calls.push([name, args]);
        return name === "audit_ticket_storage"
          ? { data: pages.shift() ?? [], error: null }
          : {
              data: {
                state: "claimed",
                bucket: "ticket-attachments",
                id: args._id,
                path: row(1).path,
              },
              error: null,
            };
      },
      storage: {
        from: (bucket) => ({
          remove: async (paths) => {
            calls.push(["remove", bucket, paths]);
            return { data: [], error: null };
          },
        }),
      },
    },
  };
}
test("audit is read only and paginates by last path", async () => {
  const f = fixture([[row(1), row(2, "referenced")], [row(3)], []]);
  const m = await auditStorage(f.client, { tenant, origin, pageSize: 2 });
  assert.equal(m.objects.length, 3);
  assert.equal(f.calls[1][1]._after, row(2).path);
  assert.ok(f.calls.every((c) => c[0] === "audit_ticket_storage"));
  assert.equal(m.truncated, false);
});
test("audit rejects errors and nonprogressing or foreign pages", async () => {
  for (const pages of [[[row(1), row(1)]], [[{ ...row(1), path: "other/path" }]]]) {
    const f = fixture(pages);
    await assert.rejects(auditStorage(f.client, { tenant, origin, pageSize: 2 }));
  }
  const f = fixture();
  f.client.rpc = async () => ({ data: null, error: { message: "secret" } });
  await assert.rejects(auditStorage(f.client, { tenant, origin }), /storage_audit_failed/);
});
test("audit caps inventory and labels truncation", async () => {
  const f = fixture([[row(1), row(2)]]);
  const m = await auditStorage(f.client, { tenant, origin, pageSize: 2, maxObjects: 2 });
  assert.equal(m.truncated, true);
});
test("audit reports and advances past invalid legacy names without deleting them", async () => {
  const bad = { ...row(1, "invalid"), path: tenant };
  const long = { ...row(2, "invalid"), path: `${tenant}/${"x".repeat(1100)}` };
  const f = fixture([[bad], [long], []]);
  const m = await auditStorage(f.client, { tenant, origin, pageSize: 1 });
  assert.equal(m.objects.length, 2);
  assert.equal(f.calls[2][1]._after, long.path);
  f.calls.length = 0;
  await applyManifest(f.client, m, { origin });
  assert.equal(f.calls.length, 0);
});
test("Unicode path length matches PostgreSQL characters rather than UTF-16 units", async () => {
  const f = fixture([[{ ...row(1), path: `${tenant}/${"😀".repeat(600)}` }]]);
  assert.equal((await auditStorage(f.client, { tenant, origin })).objects.length, 1);
});
test("apply rechecks candidates and never deletes referenced entries", async () => {
  const f = fixture([[row(1), row(2, "referenced")]]);
  const m = await auditStorage(f.client, { tenant, origin });
  f.calls.length = 0;
  const r = await applyManifest(f.client, m, { origin });
  assert.deepEqual(
    f.calls.map((c) => c[0]),
    ["claim_ticket_storage_orphan", "remove"],
  );
  assert.equal(r.deletedOrAbsent, 1);
});
test("stale candidate protected at claim time is not deleted", async () => {
  const f = fixture();
  const m = await auditStorage(f.client, { tenant, origin });
  f.calls.length = 0;
  f.client.rpc = async () => ({ data: { state: "protected" }, error: null });
  const r = await applyManifest(f.client, m, { origin });
  assert.equal(r.protected, 1);
  assert.equal(f.calls.length, 0);
});
test("manifest destination, scope and duplicates validated before I/O", async () => {
  const f = fixture();
  const m = await auditStorage(f.client, { tenant, origin });
  for (const bad of [
    { ...m, origin: "https://other.test" },
    { ...m, bucket: "other" },
    { ...m, retentionDays: 1 },
    { ...m, objects: [row(1), row(1)] },
    { ...m, objects: [{ ...row(1), path: `${tenant}/../x` }] },
  ]) {
    f.calls.length = 0;
    await assert.rejects(applyManifest(f.client, bad, { origin }));
    assert.equal(f.calls.length, 0);
  }
});
test("ambiguous or mismatched claim must not delete", async () => {
  const f = fixture();
  const m = await auditStorage(f.client, { tenant, origin });
  for (const data of [
    { state: "claimed", id: row(1).id, path: "wrong", bucket: "ticket-attachments" },
    null,
    { state: "unknown" },
  ]) {
    f.calls.length = 0;
    f.client.rpc = async () => ({ data, error: null });
    await assert.rejects(applyManifest(f.client, m, { origin }));
    assert.equal(f.calls.length, 0);
  }
});
test("delete failure reports generic failure without releasing claim", async () => {
  const f = fixture();
  const m = await auditStorage(f.client, { tenant, origin });
  f.calls.length = 0;
  f.client.storage.from = () => ({
    remove: async () => ({ data: null, error: { message: "credential-secret" } }),
  });
  await assert.rejects(applyManifest(f.client, m, { origin }), /storage_delete_failed/);
  assert.equal(f.calls[0][0], "claim_ticket_storage_orphan");
  assert.equal(f.calls.length, 1);
});
