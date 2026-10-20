"""Synthetic-only integration test. Requires two labelled, isolated containers."""
import base64
import concurrent.futures
import hashlib
import hmac
import json
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

db, rest = sys.argv[1:3]
purpose = "session-revocation-20261019"
secret = "appsec-session-http-fixture-key-at-least-32-bytes"


def inspect(name):
    value = json.loads(subprocess.check_output(["docker", "inspect", name]))[0]
    assert name.startswith("apticket-appsec-session-"), "Test-only container prefix required"
    assert value["Config"]["Labels"].get("appsec.project") == "apticket"
    assert value["Config"]["Labels"].get("appsec.purpose") == purpose
    assert not value["Mounts"], "Never attach production volumes"
    assert not value["HostConfig"].get("PortBindings"), "No published test ports"
    return value


database, api = inspect(db), inspect(rest)
networks = set(database["NetworkSettings"]["Networks"]) & set(api["NetworkSettings"]["Networks"])
assert len(networks) == 1
network = networks.pop()
assert json.loads(subprocess.check_output(["docker", "network", "inspect", network]))[0]["Internal"]
assert f"PGRST_JWT_SECRET={secret}" in api["Config"]["Env"], "Synthetic signing key required"
origin = "http://" + api["NetworkSettings"]["Networks"][network]["IPAddress"] + ":3000"


def sql(statement):
    return subprocess.check_output([
        "docker", "exec", db, "psql", "-h", "/run/postgresql", "-U", "supabase_admin",
        "-d", "appsec_audit", "-At", "-v", "ON_ERROR_STOP=1", "-c", statement,
    ], text=True).strip()


def jwt(subject=None, tenant=None, version=None, app="apticket", role="authenticated"):
    payload = {"role": role, "aud": "authenticated", "exp": int(time.time()) + 300}
    if subject:
        payload.update(sub=subject, tenant_id=tenant, app=app, email="fixture@example.test")
    if version is not None:
        payload["session_version"] = version
    encode = lambda data: base64.urlsafe_b64encode(data).rstrip(b"=")
    body = encode(b'{"alg":"HS256","typ":"JWT"}') + b"." + encode(json.dumps(payload).encode())
    return (body + b"." + encode(hmac.new(secret.encode(), body, hashlib.sha256).digest())).decode()


def request(path, token, data=None, method=None):
    headers = {"Authorization": "Bearer " + token, "Accept-Profile": "apticket",
               "Content-Profile": "apticket", "Content-Type": "application/json"}
    req = urllib.request.Request(origin + path, headers=headers,
                                 data=None if data is None else json.dumps(data).encode(), method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


assert sql("select count(*) from apticket.profiles") == "0", "Business tables must start empty"
a, b = "af200000-0000-4000-8000-000000000011", "af200000-0000-4000-8000-000000000012"
ta, tb = "af100000-0000-4000-8000-000000000011", "af100000-0000-4000-8000-000000000012"
try:
    sql(f"""
    insert into apticket.tenants(id,name,slug) values ('{ta}','HTTP fixture A','appsec-http-a'),('{tb}','HTTP fixture B','appsec-http-b');
    insert into apticket.profiles(id,tenant_id,name,email,password_hash,is_active) values
      ('{a}','{ta}','Fixture A','http-a@example.test','$2b$12$'||repeat('a',53),true),
      ('{b}','{tb}','Fixture B','http-b@example.test','$2b$12$'||repeat('a',53),true);
    insert into apticket.password_resets(profile_id,token_hash,expires_at) values
      ('{a}',repeat('a',64),now()+interval '1 hour'),('{a}',repeat('b',64),now()+interval '1 hour');
    insert into apticket.contacts(id,tenant_id,name,email) values
      ('af500000-0000-4000-8000-000000000041','{ta}','OTP fixture','otp-http@example.test');
    insert into apticket.portal_otp_codes(id,tenant_id,contact_id,email,code_hash,expires_at) values
      ('af400000-0000-4000-8000-000000000041','{ta}','af500000-0000-4000-8000-000000000041','otp-http@example.test',repeat('d',64),now()+interval '1 hour');
    create function apticket.appsec_session_probe() returns integer language sql security definer set search_path=pg_catalog as 'select count(*)::integer from apticket.profiles';
    grant execute on function apticket.appsec_session_probe() to authenticated,anon;
    create function apticket_auth_private.appsec_slow_password() returns trigger language plpgsql as 'begin perform pg_sleep(0.25); return new; end';
    create trigger appsec_slow_password before update of password_hash on apticket.profiles for each row execute function apticket_auth_private.appsec_slow_password();
    notify pgrst,'reload schema';
    """)
    old_a, old_b, service = jwt(a, ta), jwt(b, tb), jwt(role="service_role")
    for attempt in range(60):
        try:
            status, result = request("/rpc/appsec_session_probe", old_a)
            if status == 200:
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    assert status == 200 and result == 2, "Fixture SECURITY DEFINER RPC must be reachable before reset"
    assert request("/tenants?select=id", old_a) == (200, [{"id": ta}])
    barrier = threading.Barrier(2)

    def reset_once():
        barrier.wait()
        return request("/rpc/complete_password_reset", service, {
            "_token_hash": "a" * 64, "_password_hash": "$2b$12$" + "b" * 53})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        replies = list(executor.map(lambda _: reset_once(), range(2)))
    assert sorted(status for status, _ in replies) == [200, 400], "Only one racing reset may commit"
    assert sql(f"select session_version from apticket.profiles where id='{a}'") == "1"
    fresh = jwt(a, ta, 1)
    for path in ["/tenants?select=id", "/rpc/appsec_session_probe"]:
        status, result = request(path, old_a)
        assert status == 401 and result["code"] == "PT401", "Revoked JWT must be rejected before RLS/RPC"
    assert request("/tenants?select=id", fresh) == (200, [{"id": ta}])
    assert request("/tenants?select=id", old_b) == (200, [{"id": tb}])
    assert request(f"/tenants?select=id&id=eq.{tb}", fresh) == (200, [])
    assert request("/rpc/appsec_session_probe", fresh) == (200, 2)
    assert request("/rpc/appsec_session_probe", jwt(role="anon")) == (200, 2)
    assert request("/rpc/appsec_session_probe", jwt(b, tb, 999, app="other-app")) == (200, 2)
    assert request("/profiles?select=session_version", fresh)[0] == 403
    assert request(f"/profiles?id=eq.{a}", fresh, {"session_version": 0}, "PATCH")[0] == 403
    assert request("/rpc/complete_password_reset", fresh, {
        "_token_hash": "b" * 64, "_password_hash": "$2b$12$" + "c" * 53})[0] == 403
    assert request("/rpc/complete_password_reset", service, {
        "_token_hash": "b" * 64, "_password_hash": "$2b$12$" + "c" * 53})[0] == 400
    assert request("/tenants?select=id", jwt(a, ta, 0))[0] == 401
    assert request("/tenants?select=id", jwt(a, ta, 2))[0] == 401
    assert request("/tenants?select=id", jwt(a, tb, 1))[0] == 401
    otp_id = "af400000-0000-4000-8000-000000000041"
    barrier = threading.Barrier(5)

    def wrong_guess():
        barrier.wait()
        return request("/rpc/increment_portal_otp_attempt", service, {"_otp_id": otp_id})

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        guesses = list(executor.map(lambda _: wrong_guess(), range(5)))
    assert all(status == 200 for status, _ in guesses)
    assert sorted(value for _, value in guesses) == [1, 2, 3, 4, 5], "Concurrent increments must not be lost"
    assert request("/rpc/increment_portal_otp_attempt", service, {"_otp_id": otp_id}) == (200, None)
    assert sql(f"select attempts from apticket.portal_otp_codes where id='{otp_id}'") == "5"
    assert request("/rpc/increment_portal_otp_attempt", fresh, {"_otp_id": otp_id})[0] == 403
    anon_status, anon_error = request("/rpc/increment_portal_otp_attempt", jwt(role="anon"), {"_otp_id": otp_id})
    assert anon_status == 401 and anon_error["code"] == "42501", (anon_status, anon_error)
    print("PASS real PostgREST: five racing OTP increments, cap and restricted invocation")
    print("PASS real PostgREST: concurrent single-use reset, revoked/fresh JWT, tenant isolation, privileged RPC, grants, other apps and anonymous flows")
finally:
    sql(f"""
    drop trigger if exists appsec_slow_password on apticket.profiles;
    drop function if exists apticket_auth_private.appsec_slow_password();
    drop function if exists apticket.appsec_session_probe();
    begin;
    set local session_replication_role=replica;
    set local client_min_messages=warning;
    truncate apticket.tenants cascade;
    commit;
    """)
