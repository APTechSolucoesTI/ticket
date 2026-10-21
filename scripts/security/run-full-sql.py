"""Reproducible full SQL suite. Synthetic rows, no external network or host volumes.

The checked-in baseline contains DDL, grants and reference catalogs only. It was
exported after migration 20261020103617 and scanned before inclusion. Never load
customer rows, production Vault keys, environment files or database passwords.
"""
import json
import pathlib
import re
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'scripts/security/fixtures/full-schema'
NAME = 'apticket-appsec-full-ci'
PURPOSE = 'full-sql-isolation-20261021'
BASELINE = '20261020103617'
created = False


def run(*args, data=None):
    return subprocess.check_output(args, input=data, stderr=subprocess.STDOUT)


def sql(data, database='appsec_audit'):
    return run('docker', 'exec', '-i', NAME, 'psql', '-h', '/run/postgresql',
               '-U', 'supabase_admin', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', data=data)


def apply(path):
    return sql(path.read_bytes())


try:
    if subprocess.run(['docker', 'inspect', NAME], capture_output=True).returncode == 0:
        raise RuntimeError('Refusing existing container: ' + NAME)
    run('docker', 'run', '-d', '--name', NAME, '--network', 'none',
        '--label', 'appsec.project=apticket', '--label', 'appsec.purpose=' + PURPOSE,
        '--cpus', '1.5', '--memory', '1536m', '--user', 'postgres', '--entrypoint', 'bash',
        'supabase/postgres:17.6.1.136', '-c',
        "printf '#!/bin/sh\necho 0000000000000000000000000000000000000000000000000000000000000000\n' > /tmp/getkey; "
        'chmod 700 /tmp/getkey; '
        'initdb -D /tmp/appsec-pg --username=supabase_admin --auth=trust --no-locale >/tmp/init.log && '
        "exec postgres -D /tmp/appsec-pg -c listen_addresses='' "
        '-c unix_socket_directories=/run/postgresql '
        '-c shared_preload_libraries=pg_cron,pg_net,pgsodium,supabase_vault '
        '-c pgsodium.getkey_script=/tmp/getkey -c vault.getkey_script=/tmp/getkey '
        '-c cron.database_name=appsec_audit -c cron.launch_active_jobs=off')
    created = True
    for _ in range(120):
        if subprocess.run(['docker', 'exec', NAME, 'pg_isready', '-h', '/run/postgresql',
                           '-U', 'supabase_admin'], capture_output=True).returncode == 0:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Disposable database readiness timeout')
    sql(b'create database appsec_audit;', 'postgres')
    for name in ['bootstrap.sql', 'schema.sql', 'auth-helpers.sql', 'bootstrap-extra.sql', 'catalog-seed.sql', 'reference-data.sql']:
        apply(FIXTURE / name)
    apply(ROOT / 'scripts/security/fixtures/sql-test-helpers.sql')
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if path.name.split('_')[0] <= BASELINE:
            continue
        if path.name.startswith('20261021201338_'):
            before = ROOT / 'scripts/security/fixtures/attachment-backfill-before.sql'
            after = ROOT / 'scripts/security/fixtures/attachment-backfill-after.sql'
            tap = sql(b'begin;\n' + before.read_bytes() + path.read_bytes() + after.read_bytes() + b'\nrollback;').decode()
            assert not re.search(r'^not ok|^# Looks like', tap, re.M), tap
            assert len(re.findall(r'^ok \d+', tap, re.M)) == 4, tap
            print('PASS 4 legacy attachment backfill assertions', flush=True)
        sql(b'begin;\n' + path.read_bytes() + b'\ncommit;')
        rollback = ROOT / 'supabase/rollbacks' / path.name
        if not rollback.exists():
            raise RuntimeError('Incremental migration requires rollback fixture: ' + path.name)
        sql(b'begin;\n' + rollback.read_bytes() + b'\ncommit;')
        sql(b'begin;\n' + path.read_bytes() + b'\ncommit;')
        print('PASS migration rollback/reapply:', path.name, flush=True)
    assert sql(b"select rolsuper from pg_roles where rolname='postgres';").strip() == b'f'
    assert sql(b"show cron.launch_active_jobs;").strip() == b'off'
    failures = []
    assertions = 0
    coverage = {}
    paths = sorted((ROOT / 'supabase/tests').glob('*.sql'))
    for path in paths:
        content = path.read_text(encoding='utf-8')
        # The original domain suite must finish first; matrix rows/roles are
        # isolated within its transaction and are discarded by its own rollback.
        match = list(re.finditer(r'\brollback\s*;', content, re.I))
        if not match:
            raise RuntimeError('Fixture must end with ROLLBACK: ' + path.name)
        position = match[-1].start()
        probe = (ROOT / 'scripts/security/fixtures/foreign-crud-matrix.sql').read_text(encoding='utf-8')
        content = content[:position] + probe + '\n' + content[position:]
        result = subprocess.run(['docker', 'exec', '-i', NAME, 'psql', '-h', '/run/postgresql',
                                 '-U', 'supabase_admin', '-d', 'appsec_audit', '-At',
                                 '-v', 'ON_ERROR_STOP=1'], input=content.encode(), capture_output=True)
        output = result.stdout.decode(errors='replace')
        passed = len(re.findall(r'^ok \d+', output, re.M))
        assertions += passed
        for line in output.splitlines():
            if line.startswith('APPSEC_CRUD_MATRIX:'):
                for row in json.loads(line.split(':', 1)[1]):
                    previous = coverage.get(row['table'])
                    if previous is None or row['own_visible'] > previous['own_visible']:
                        coverage[row['table']] = row
        failed = result.returncode or re.search(r'^not ok|^# Looks like', output, re.M)
        if failed:
            failures.append(path.name)
            # All output is from synthetic fixtures, with no production connection.
            print('FAIL', path.name, flush=True)
            print('\n'.join(line for line in output.splitlines() if line.startswith(('not ok', '#'))))
            print(result.stderr.decode(errors='replace')[-2500:])
        else:
            print('PASS', path.name, passed, 'assertions', flush=True)
    if failures:
        raise RuntimeError('SQL suite failed: ' + ', '.join(failures))
    print('Cross-tenant CRUD coverage:', json.dumps(coverage, sort_keys=True), flush=True)
    print(f'PASS complete SQL suite: {len(paths)} files, {assertions} TAP assertions', flush=True)
except subprocess.CalledProcessError as error:
    print(error.output.decode(errors='replace'))
    raise
finally:
    if created:
        metadata = json.loads(run('docker', 'inspect', NAME))[0]
        assert metadata['Config']['Labels'].get('appsec.purpose') == PURPOSE
        assert metadata['HostConfig']['NetworkMode'] == 'none'
        assert not metadata['Mounts'] and not metadata['HostConfig'].get('PortBindings')
        run('docker', 'rm', '-f', NAME)
