import assert from "node:assert/strict";
// Registry metadata lagged behind the official withdrawal. Never suppress an
// active advisory: reconfirm the exact withdrawal on GitHub every affected run.
export const WITHDRAWN_PICOMATCH = {
  id: "GHSA-fc5q-39xc-vjpf",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  withdrawnAt: "2026-11-18T15:38:56Z",
};
export async function verifyOfficialWithdrawal() {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/advisories/${WITHDRAWN_PICOMATCH.id}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  assert.ok(response.ok, "Official advisory withdrawal could not be verified");
  return response.json();
}
export async function assertDependencyAuditSafe(
  audit,
  verifyWithdrawal = verifyOfficialWithdrawal,
) {
  const counts = audit?.metadata?.vulnerabilities;
  assert.ok(
    !audit?.error &&
      counts &&
      typeof audit.advisories === "object" &&
      audit.advisories !== null &&
      !Array.isArray(audit.advisories),
    "Audit must contain valid metadata and advisory records",
  );
  const advisories = Object.values(audit.advisories),
    withdrawn = [];
  for (const advisory of advisories) {
    const exact =
      (advisory.module ?? advisory.module_name) === "picomatch" &&
      advisory.github_advisory_id === WITHDRAWN_PICOMATCH.id &&
      advisory.url === WITHDRAWN_PICOMATCH.url &&
      advisory.severity === "high" &&
      advisory.vulnerable_versions?.replace(/\s/g, "") === "<=4.0.7";
    assert.ok(exact, "Active dependency advisories are not permitted");
    const official = await verifyWithdrawal();
    assert.ok(
      official?.ghsa_id === WITHDRAWN_PICOMATCH.id &&
        official.withdrawn_at === WITHDRAWN_PICOMATCH.withdrawnAt &&
        official.vulnerabilities?.some(
          (v) =>
            v.package?.ecosystem === "npm" &&
            v.package?.name === "picomatch" &&
            v.vulnerable_version_range?.replace(/\s/g, "") === "<=4.0.7",
        ),
      "Exact official withdrawal must still be valid",
    );
    assert.equal(withdrawn.length, 0, "Duplicate withdrawn advisory records are invalid");
    withdrawn.push(advisory.github_advisory_id);
  }
  for (const severity of ["critical", "high", "moderate", "low", "info"]) {
    assert.ok(
      Number.isSafeInteger(counts[severity]) && counts[severity] >= 0,
      "Invalid vulnerability count",
    );
    assert.equal(
      counts[severity],
      severity === "high" ? withdrawn.length : 0,
      `No active ${severity} dependency advisories permitted`,
    );
  }
  return { withdrawn };
}
