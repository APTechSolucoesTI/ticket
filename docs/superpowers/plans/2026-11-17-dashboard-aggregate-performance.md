# Dashboard aggregate performance implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Execute inline in the authorized feature workspace; the parent agent performs the final review. Do not commit, deploy, or contact production.

**Goal:** Reduce intermediate historical rows repeatedly processed by dashboard metrics, preserving every public JSON value and RLS boundary.

**Architecture:** Group visible tickets by their creation/completion calendar buckets before materializing intermediate results. All historical status, SLA and duration statistics remain exact. Compare the actual aggregate statements with EXPLAIN (ANALYZE, BUFFERS) in disposable PostgreSQL 17.6.

**Tech Stack:** PostgreSQL, SQL, Node.js optional local PostgreSQL tools.

**Spec:** `docs/security/consulta-recentes-dashboard-20261117.md`, section 5, and parent task scope.

## Global constraints

- New migration `20261117200000`; never edit an existing migration.
- Keep SECURITY INVOKER, session tenant, permission checks, RLS, calendar boundaries, latest ordering and JSON contract.
- No production latency claims, schema indexes without representative evidence, environment secrets or external connections.

## Review focus

- Zero visible rows must preserve zero counts, null average and the complete empty calendar.
- Invalid/absent completion timestamps must retain the original duration and volume rules.
- Calendar bounds remain inclusive and use America/Sao_Paulo.
- Grouped numeric sums must preserve exact average precision, including fractional durations.
- Different tenants and related-table RLS must preserve complete JSON equality.

### Task 1: Regression and resource evidence

Files: new `supabase/tests/ticket_metrics_aggregate_test.sql` and `scripts/security/test-ticket-metrics-performance.mjs`.

- [x] Build a disposable real PostgreSQL runner from the existing fixture setup; no changes to the shared atomic runner.
- [x] Capture the existing function under a test-only name and compare every JSON field for 7/14/30 days with diverse historical fixtures, empty sets and RLS.
- [x] Measure the extracted aggregate statement with fixed parameters, 1 MB work_mem, and EXPLAIN ANALYZE BUFFERS. Require no temporary writes and a bounded intermediate materialization on the representative fixture. Run baseline first and observe the resource failure.

### Task 2: Bounded aggregate materialization

Files: new migration/rollback `20261117200000_dashboard_grouped_metrics.sql` and specific security evidence document.

- [x] Group by current-period creation/completion day; collapse all out-of-period timestamps to NULL buckets. Aggregate all historical statistics within groups, then sum the compact groups.
- [x] Preserve numeric AVG via sum of exact duration sums divided by total valid samples; retain NULL when no sample exists.
- [x] Run the SQL regressions, existing ticket SQL tests, performance harness and exact rollback/reapply check. Record actual plans, fixture distribution and limits.
- [x] Parent and fresh-context SQL reviewer checked the final source, rollback, oracle and evidence. API/web typechecks, security lint, 172 API tests and API build passed; Storage/CLI and PostgreSQL checks passed separately. No product deployment or remote SQL suite was run.

Execution evidence (18/11): baseline RED wrote 253 temporary blocks for 50.006 rows; initial timestamp-expression grouping also failed (sort, 307–308 blocks). Ruling: join an explicit bounded calendar before grouping so the planner can estimate its small cardinality. No optimizer setting or product work_mem change. Final PostgreSQL 17.6 run exited 0: 36/74/158 groups, 0 temporary blocks, one ticket scan, full JSON equality, exact rollback/reapply. Evidence and timing limits: `docs/security/dashboard-agregacoes-20261118.md`. Author performed scope review; parent owns independent final review and branch-wide checks.
