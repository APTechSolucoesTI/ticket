"""Linux/Docker CI: synthetic SQL + real PostgREST, with no published ports/data mounts."""
import json
import pathlib
import re
import subprocess
import sys
import time

root = pathlib.Path(__file__).resolve().parents[2]
db = "apticket-appsec-session-ci-db"
rest = "apticket-appsec-session-ci-rest"
network = "apticket-appsec-session-ci"
purpose = "session-revocation-20261019"
labels = ["--label", "appsec.project=apticket", "--label", f"appsec.purpose={purpose}"]
created = []
network_created = False
admin_user = "supabase_admin"


def run(*args, data=None):
    return subprocess.check_output(args, input=data, stderr=subprocess.STDOUT)


def sql(data, database="appsec_audit"):
    return run("docker", "exec", "-i", db, "psql", "-h", "/run/postgresql", "-U", admin_user,
               "-d", database, "-At", "-v", "ON_ERROR_STOP=1", data=data)


def apply(path):
    return sql((root / path).read_bytes())


try:
    # Refuse collisions, even if a similarly named resource belongs to this suite.
    for kind, name in [("container", db), ("container", rest), ("network", network)]:
        result = subprocess.run(["docker", kind, "inspect", name], capture_output=True)
        if result.returncode == 0:
            raise RuntimeError(f"Refusing existing Docker {kind}: {name}")
    run("docker", "network", "create", "--internal", *labels, network)
    network_created = True
    run("docker", "run", "-d", "--name", db, *labels, "--network", network, "--network-alias", "appsec-db",
        "--cpus", "1", "--memory", "768m", "--user", "postgres", "--entrypoint", "/bin/bash",
        "supabase/postgres:17.6.1.136", "-c",
        "initdb -D /tmp/appsec-pg --username=supabase_admin --auth=trust --no-locale >/tmp/init.log && "
        "exec postgres -D /tmp/appsec-pg -c listen_addresses='*' -c unix_socket_directories=/run/postgresql")
    created.append(db)
    for attempt in range(120):
        ready = subprocess.run(["docker", "exec", db, "pg_isready", "-h", "/run/postgresql", "-U", "supabase_admin"], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("Disposable database did not become ready")
    sql(b"create database appsec_audit;", "postgres")
    apply("scripts/security/fixtures/session-contract.sql")
    migration = "supabase/migrations/20261019231722_session_version_revocation.sql"
    unprivileged = subprocess.run(["docker", "exec", "-i", db, "psql", "-h", "/run/postgresql",
        "-U", "postgres", "-d", "appsec_audit", "-v", "ON_ERROR_STOP=1"],
        input=(root / migration).read_bytes(), capture_output=True)
    assert unprivileged.returncode != 0 and b"Migration requires ownership privileges" in unprivileged.stderr
    assert sql(b"select count(*) from information_schema.columns where table_schema='apticket' and table_name='profiles' and column_name='session_version';").strip() == b"0"
    apply(migration)
    otp_migration = "supabase/migrations/20261020103617_portal_otp_attempt_counter_atomic.sql"
    apply(otp_migration)
    apply("supabase/rollbacks/20261020103617_portal_otp_attempt_counter_atomic.sql")
    apply(otp_migration)
    apply("supabase/rollbacks/20261019231722_session_version_revocation.sql")
    apply(migration)
    tap = apply("supabase/tests/session_revocation_test.sql").decode()
    assert not re.search(r"^not ok", tap, re.M), tap
    assert len(re.findall(r"^ok \d+", tap, re.M)) == 34, tap
    assert sql(b"select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='apticket_auth_private' and p.proowner <> 'postgres'::regrole;").strip() == b"0"
    assert sql(b"select rolsuper from pg_roles where rolname='postgres';").strip() == b"f"
    print("PASS migration privilege preflight, non-superuser function owner and 34 SQL session assertions including rollback/reapply", flush=True)
    otp_tap = apply("supabase/tests/portal_otp_attempt_counter_test.sql").decode()
    assert not re.search(r"^not ok", otp_tap, re.M), otp_tap
    assert len(re.findall(r"^ok \d+", otp_tap, re.M)) == 18, otp_tap
    print("PASS 18 SQL OTP attempt assertions, including migration rollback/reapply", flush=True)
    run("docker", "run", "-d", "--name", rest, *labels, "--network", network,
        "--cpus", "0.5", "--memory", "256m",
        "-e", "PGRST_DB_URI=postgres://authenticator@appsec-db:5432/appsec_audit",
        "-e", "PGRST_DB_SCHEMAS=apticket", "-e", "PGRST_DB_ANON_ROLE=anon",
        "-e", "PGRST_JWT_SECRET=appsec-session-http-fixture-key-at-least-32-bytes",
        "postgrest/postgrest:v14.12")
    created.append(rest)
    address = json.loads(run("docker", "inspect", rest))[0]["NetworkSettings"]["Networks"][network]["IPAddress"]
    # initdb allows localhost trust only. Authorize only this isolated test REST IP.
    run("docker", "exec", "-i", db, "sh", "-c", "cat >> /tmp/appsec-pg/pg_hba.conf",
        data=f"\nhost appsec_audit authenticator {address}/32 trust\n".encode())
    sql(b"select pg_reload_conf();")
    run("docker", "restart", rest)
    # HTTP integration probe itself polls for readiness and verifies isolation.
    output = run(sys.executable, str(root / "scripts/security/test-session-postgrest.py"), db, rest)
    print(output.decode().strip())
except subprocess.CalledProcessError as error:
    # All subprocess output comes from this synthetic environment.
    sys.stderr.write(error.output.decode(errors="replace"))
    raise
finally:
    for name in reversed(created):
        metadata = json.loads(run("docker", "inspect", name))[0]
        assert metadata["Config"]["Labels"].get("appsec.purpose") == purpose
        assert not metadata["Mounts"] and not metadata["HostConfig"].get("PortBindings")
        run("docker", "rm", "-f", name)
    if network_created:
        metadata = json.loads(run("docker", "network", "inspect", network))[0]
        assert metadata["Internal"] and metadata["Labels"].get("appsec.purpose") == purpose
        run("docker", "network", "rm", network)
