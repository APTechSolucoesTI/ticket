# Isolated SQL baseline

Structural snapshot of the APTicket and private schemas after migration
`20261020103617`, plus Storage DDL and APTicket policies. This contains no
customer rows, production credentials, role passwords or Vault root key.
Gitleaks 8.30.1 scanned the exported SQL before inclusion. The global permission
and automation-trigger catalogs and bucket settings are structural reference
data. National holidays are replayed from the published migration.

`run-full-sql.py` creates a disposable PostgreSQL container with no network,
published ports or host volumes. A synthetic Vault key allows encryption tests;
cron jobs are registered but execution is disabled. Role attributes, function
owners, RLS, constraints and triggers remain active. The test helper schema is
exclusive to this environment and is never migrated to production.

Run on Linux with Docker: `python3 scripts/security/run-full-sql.py`.
Incremental migrations after the baseline are applied, reversed and reapplied.
The runner attempts every SQL file and fails on setup errors or TAP failures.
It removes only its own labeled container, and refuses a name collision.

Keep the baseline immutable as migrations are added. Replacing it requires a
fresh DDL-only export, removal of unrelated application policies, secret scan,
review of owners/grants and an update to the documented baseline version.

Coverage limits: historical domain tests and the core CRUD matrix exercise real
RLS with positive and negative controls. Catalog checks cover all current
tables/views but do not prove every business flow, every RPC, or full CRUD on
every table. Realtime and external providers need separate integration tests.
