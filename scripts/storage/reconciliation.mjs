import assert from "node:assert/strict";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const states = new Set(["candidate", "referenced", "recent", "invalid"]);
function integer(value, min, max) {
  assert.ok(Number.isInteger(value) && value >= min && value <= max, "storage_options_invalid");
}
export function storageOrigin(value) {
  const url = new URL(value);
  assert.ok(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "storage_origin_invalid",
  );
  return url.origin;
}
function scopedPath(path, tenant, strict = true) {
  assert.ok(
    typeof path === "string" && (path === tenant || path.startsWith(`${tenant}/`)),
    "storage_path_invalid",
  );
  if (strict)
    assert.ok(
      path.length > tenant.length + 1 &&
        [...path].length <= 1024 &&
        !/(^|\/)\.\.?(\/|$)|[%?#\\\u0000-\u001f\u007f]|\/\//.test(path),
      "storage_path_invalid",
    );
}
function validateRow(row, tenant) {
  assert.ok(row && uuid.test(row.id) && states.has(row.state), "storage_row_invalid");
  scopedPath(row.path, tenant, row.state !== "invalid");
  for (const date of [row.createdAt, row.updatedAt])
    assert.ok(
      date === null || (typeof date === "string" && Number.isFinite(Date.parse(date))),
      "storage_date_invalid",
    );
}
function validateManifest(manifest, origin) {
  assert.ok(
    manifest &&
      manifest.version === 1 &&
      manifest.bucket === "ticket-attachments" &&
      uuid.test(manifest.tenant),
    "storage_manifest_invalid",
  );
  assert.equal(manifest.origin, storageOrigin(origin), "storage_manifest_destination_mismatch");
  integer(manifest.retentionDays, 7, 3650);
  assert.ok(
    typeof manifest.generatedAt === "string" &&
      Number.isFinite(Date.parse(manifest.generatedAt)) &&
      typeof manifest.truncated === "boolean",
    "storage_manifest_invalid",
  );
  assert.ok(
    Array.isArray(manifest.objects) && manifest.objects.length <= 50000,
    "storage_manifest_invalid",
  );
  const ids = new Set(),
    paths = new Set();
  for (const row of manifest.objects) {
    validateRow(row, manifest.tenant);
    assert.ok(!ids.has(row.id) && !paths.has(row.path), "storage_manifest_duplicate");
    ids.add(row.id);
    paths.add(row.path);
  }
}
export async function auditStorage(
  client,
  { tenant, origin, days = 30, pageSize = 100, maxObjects = 10000 },
) {
  assert.ok(uuid.test(tenant), "storage_tenant_invalid");
  origin = storageOrigin(origin);
  integer(days, 7, 3650);
  integer(pageSize, 1, 500);
  integer(maxObjects, 1, 50000);
  const objects = [],
    ids = new Set();
  let after = null,
    truncated = false;
  while (objects.length < maxObjects) {
    const limit = Math.min(pageSize, maxObjects - objects.length);
    const { data, error } = await client.rpc("audit_ticket_storage", {
      _tenant: tenant,
      _after: after,
      _days: days,
      _limit: limit,
    });
    if (error || !Array.isArray(data) || data.length > limit)
      throw new Error("storage_audit_failed");
    for (const row of data) {
      validateRow(row, tenant);
      assert.ok(
        !ids.has(row.id) &&
          (after === null || Buffer.compare(Buffer.from(row.path), Buffer.from(after)) > 0),
        "storage_audit_cursor_invalid",
      );
      objects.push(row);
      ids.add(row.id);
      after = row.path;
    }
    if (data.length < limit) break;
    if (objects.length === maxObjects) truncated = true;
  }
  return {
    version: 1,
    bucket: "ticket-attachments",
    origin,
    tenant,
    retentionDays: days,
    generatedAt: new Date().toISOString(),
    truncated,
    objects,
  };
}
export async function applyManifest(client, manifest, { origin }) {
  validateManifest(manifest, origin);
  const result = {
    tenant: manifest.tenant,
    bucket: manifest.bucket,
    examined: 0,
    deletedOrAbsent: 0,
    protected: 0,
    missing: 0,
  };
  for (const row of manifest.objects.filter((row) => row.state === "candidate")) {
    const { data, error } = await client.rpc("claim_ticket_storage_orphan", {
      _tenant: manifest.tenant,
      _id: row.id,
      _days: manifest.retentionDays,
    });
    result.examined++;
    if (error || !data) throw new Error("storage_claim_failed");
    if (data.state === "protected" || data.state === "missing") {
      result[data.state]++;
      continue;
    }
    if (
      data.state !== "claimed" ||
      data.id !== row.id ||
      data.path !== row.path ||
      data.bucket !== manifest.bucket
    )
      throw new Error("storage_claim_invalid");
    const removed = await client.storage.from(manifest.bucket).remove([row.path]);
    if (removed.error || !Array.isArray(removed.data)) throw new Error("storage_delete_failed");
    result.deletedOrAbsent++;
  }
  return result;
}
