import test from "node:test";
import assert from "node:assert/strict";
import { assertDependencyAuditSafe, WITHDRAWN_PICOMATCH } from "./dependency-audit-policy.mjs";
const row = {
  module_name: "picomatch",
  github_advisory_id: WITHDRAWN_PICOMATCH.id,
  url: WITHDRAWN_PICOMATCH.url,
  severity: "high",
  vulnerable_versions: "<=4.0.7",
};
const primary = {
  ghsa_id: WITHDRAWN_PICOMATCH.id,
  withdrawn_at: WITHDRAWN_PICOMATCH.withdrawnAt,
  vulnerabilities: [
    { package: { ecosystem: "npm", name: "picomatch" }, vulnerable_version_range: "<= 4.0.7" },
  ],
};
const report = (rows = [], counts = {}) => ({
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts } },
  advisories: Object.fromEntries(rows.map((r, i) => [i, r])),
});
test("zero findings needs no withdrawal network lookup", async () => {
  let called = false;
  await assertDependencyAuditSafe(report(), async () => {
    called = true;
  });
  assert.equal(called, false);
});
test("exact retired advisory is accepted only with current official confirmation and raw count retained", async () => {
  const raw = report([row], { high: 1 }),
    before = structuredClone(raw);
  const result = await assertDependencyAuditSafe(raw, async () => primary);
  assert.equal(result.withdrawn.length, 1);
  assert.deepEqual(raw, before);
});
test("all active severities still fail even with misleading zero metadata", async () => {
  for (const severity of ["critical", "high", "moderate", "low"]) {
    await assert.rejects(
      assertDependencyAuditSafe(
        report([{ ...row, github_advisory_id: "GHSA-other", severity }]),
        async () => primary,
      ),
    );
  }
});
test("reactivated or differently withdrawn advisory fails closed", async () => {
  for (const change of [
    { withdrawn_at: null },
    { withdrawn_at: "2026-11-19T00:00:00Z" },
    { ghsa_id: "GHSA-other" },
    { vulnerabilities: [] },
  ])
    await assert.rejects(
      assertDependencyAuditSafe(report([row], { high: 1 }), async () => ({
        ...primary,
        ...change,
      })),
    );
});
test("wrong package, range or URL never uses the retirement exception", async () => {
  for (const change of [
    { module_name: "other" },
    { vulnerable_versions: "<=5.0.0" },
    { url: "https://other.test/withdrawn" },
  ])
    await assert.rejects(
      assertDependencyAuditSafe(report([{ ...row, ...change }], { high: 1 }), async () => primary),
    );
});
test("unverified withdrawal and registry errors fail closed", async () => {
  await assert.rejects(
    assertDependencyAuditSafe(report([row], { high: 1 }), async () => {
      throw new Error("upstream unavailable");
    }),
  );
  await assert.rejects(
    assertDependencyAuditSafe({ error: { message: "registry down" } }, async () => primary),
  );
  await assert.rejects(assertDependencyAuditSafe(report([], { high: 1 }), async () => primary));
});
test("another finding cannot hide alongside the retired entry", async () => {
  await assert.rejects(
    assertDependencyAuditSafe(
      report([row, { ...row, module_name: "other", github_advisory_id: "GHSA-other" }], {
        high: 2,
      }),
      async () => primary,
    ),
  );
});
test("duplicate retirement entries and malformed advisory arrays fail closed", async () => {
  await assert.rejects(
    assertDependencyAuditSafe(report([row, row], { high: 2 }), async () => primary),
  );
  await assert.rejects(
    assertDependencyAuditSafe({ ...report(), advisories: [] }, async () => primary),
  );
});
