#!/usr/bin/env python3
"""One-shot, window-gated PostgreSQL minor maintenance for the existing host.

Run on the Supabase host. No credentials or customer rows leave that host.
Rollback replaces binaries only, retaining ALL writes in the same PGDATA.
Cold backup restoration is deliberately a separate disaster-recovery action.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

TARGET = 'supabase/postgres:17.11.0.006@sha256:c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2'
SOURCE = 'supabase/postgres:17.6.1.136'
ROOT = Path('/opt/supabase/supabase-project')
EVIDENCE = Path('/home/administrador/backups/apticket/postgres-maint-20261022')
REHEARSAL_ROOT = Path('/tmp/apticket-pg-maint-20261022/rehearsal')
MANIFEST = '5c2af52082c9536d473b58dbb802edd631615827f07d4e26f9280c6207db3f76'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def replace_image(text, source, target):
    pattern = r'(?m)^    image: ' + re.escape(source) + r'[ \t]*$'
    if len(re.findall(pattern, text)) != 1:
        raise RuntimeError('Expected exactly one unchanged database image declaration')
    return re.sub(pattern, lambda _: '    image: ' + target, text)


class Maintenance:
    def __init__(self, args):
        self.args = args
        self.rehearsal = args.rehearsal_project is not None
        self.root = Path(args.rehearsal_project) if self.rehearsal else ROOT
        self.container = 'apticket-pg-maint-rehearsal' if self.rehearsal else 'supabase-db'
        self.base = self.root / 'maintenance-artifacts' if self.rehearsal else EVIDENCE / 'window-execution'
        self.base.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.base, 0o700)
        self.artifacts = self.base / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + str(os.getpid()))
        self.artifacts.mkdir(mode=0o700)
        self.step = 0
        self.original = ''
        self.changed = False
        self.stopped = False

    def command(self, *command, timeout=120, input_bytes=None, private_output=False):
        self.step += 1
        log = self.artifacts / f'{self.step:03d}.log'
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            result = subprocess.run(command, input=input_bytes, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE if private_output else output, timeout=timeout)
            output.write(b'Private operational metadata kept in memory only.\n' if private_output else result.stdout)
        if result.returncode:
            raise RuntimeError(f'Maintenance command {self.step} failed; protected diagnostic retained')
        return result.stdout

    def sql(self, query, database='postgres'):
        return self.command('docker', 'exec', self.container, 'psql', '-X', '-U',
                            'supabase_admin', '-d', database, '-At', '-v',
                            'ON_ERROR_STOP=1', '-c', query).decode().strip()

    def compose(self, *args):
        return self.command('docker', 'compose', '--project-directory', str(self.root),
                            '-f', str(self.root / 'docker-compose.yml'), *args, timeout=240)

    def state(self, name, **metadata):
        data = {'state': name, 'utc': dt.datetime.now(dt.timezone.utc).isoformat(), **metadata}
        target = self.artifacts / 'status.json'
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as out:
            json.dump(data, out, indent=2)
        print(json.dumps(data), flush=True)

    def catalog(self):
        # Count-only Vault access forces decryption without returning its values.
        return json.loads(self.sql("""select json_build_object(
          'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='apticket' and c.relkind='r'),
          'vault',(select count(decrypted_secret) from vault.decrypted_secrets),
          'databases',(select count(*) from pg_database where datallowconn and not datistemplate),
          'rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='apticket' and c.relkind='r' and c.relrowsecurity));"""))

    def preflight(self):
        assert self.root.is_absolute() and self.root.resolve() == self.root
        if self.rehearsal:
            assert self.root == REHEARSAL_ROOT
        else:
            assert (EVIDENCE / 'restore-tested-1711').is_file()
            assert digest(EVIDENCE / 'physical-backup' / 'backup_manifest') == MANIFEST
        info = json.loads(self.command('docker', 'inspect', self.container, private_output=True))[0]
        assert info['Config']['Image'] == SOURCE
        if self.rehearsal:
            assert info['HostConfig']['NetworkMode'] == 'none'
            assert info['Config']['Labels']['appsec.purpose'] == 'postgres-maintenance-rehearsal-20261022'
        else:
            data = [m for m in info['Mounts'] if m['Destination'] == '/var/lib/postgresql/data']
            key = [m for m in info['Mounts'] if m['Destination'] == '/etc/postgresql-custom']
            assert len(data) == len(key) == 1
            assert data[0]['Source'] == str(ROOT / 'volumes/db/data')
            assert key[0]['Name'] == 'supabase_db-config'
        assert self.sql('show server_version;').startswith('17.6')
        assert self.sql("select count(*) from pg_tablespace where spcname not in ('pg_default','pg_global');") == '0'
        # The cluster hosts other applications: inspect every connectable DB.
        # Stop for a new compatibility requirement rather than guessing a reindex.
        databases = self.sql('select datname from pg_database where datallowconn and not datistemplate;').splitlines()
        for database in databases:
            assert self.sql("select count(*) from pg_extension where extname in ('ltree','btree_gist');",database) == '0'
            assert self.sql("select count(*) from pg_collation where collprovider in ('c','i') and collversion is distinct from pg_collation_actual_version(oid);",database) == '0'
            assert self.sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prokind='f' and p.prosrc ~* 'cipher-algo[[:space:]]*=[[:space:]]*(bf|blowfish|cast5)';",database) == '0'
        self.command('docker', 'image', 'inspect', TARGET)
        assert shutil.disk_usage(self.artifacts).free >= 10 * 1024**3
        self.original = (self.root / 'docker-compose.yml').read_text()
        replace_image(self.original, SOURCE, TARGET)
        self.baseline = self.catalog()
        self.key = self.command('docker','exec',self.container,
                                '/usr/lib/postgresql/bin/pgsodium_getkey.sh',private_output=True).strip()
        if not self.rehearsal:
            assert self.key == (EVIDENCE/'pgsodium-root.key').read_bytes().strip()
        assert self.baseline['tables'] == 118
        self.state('preflight-passed', catalog=self.baseline)

    def set_image(self, source, target):
        path = self.root / 'docker-compose.yml'
        updated = replace_image(path.read_text(), source, target)
        temporary = path.with_name('docker-compose.apticket-maintenance.tmp')
        with temporary.open('x') as stream:
            stream.write(updated)
        os.chmod(temporary, path.stat().st_mode & 0o777)
        os.replace(temporary, path)

    def ready(self, version):
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            try:
                if self.sql('show server_version;').startswith(version):
                    assert self.catalog() == self.baseline
                    assert self.command('docker','exec',self.container,
                      '/usr/lib/postgresql/bin/pgsodium_getkey.sh',private_output=True).strip() == self.key
                    assert self.sql("select pg_is_in_recovery();") == 'f'
                    return
            except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError):
                pass
            time.sleep(3)
        raise RuntimeError('Database readiness deadline exceeded')

    def app_health(self):
        if self.rehearsal:
            return
        for name, port, route in [('apticket-backend-o1zrvz',3001,'/health'),('apticket-frontend-1cpi3r',3000,'/auth')]:
            ids = self.command('docker','ps','-q','--filter','name='+name+'.').decode().split()
            assert ids
            rows=json.loads(self.command('docker','inspect',*ids,private_output=True))
            container=max(rows,key=lambda row:row['Created'])['Id']
            source="""(async()=>{for(let n=0;n<30;n++){try{
              const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(5000)});
              if(r.status===200)return;
            }catch{}await new Promise(r=>setTimeout(r,2000));}process.exitCode=1;})()"""
            self.command('docker','exec',container,'node','-e',source,
                         f'http://127.0.0.1:{port}{route}',timeout=100)
        # Real PostgREST round trip with a nonexistent UUID; never returns users.
        source="""(async()=>{const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
          const r=await fetch(base+'/rest/v1/profiles?select=id&id=eq.00000000-0000-0000-0000-000000000000&limit=1',
          {headers:{apikey:key,Authorization:'Bearer '+key,'Accept-Profile':'apticket'},signal:AbortSignal.timeout(15000)});
          if(r.status!==200||(await r.json()).length!==0)process.exitCode=1;
          for(const path of ['/auth/v1/health','/storage/v1/status']){
            const health=await fetch(base+path,{headers:{apikey:key,Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
            if(health.status!==200)process.exitCode=1;
          }
        })().catch(()=>process.exitCode=1)"""
        self.command('docker','exec',container,'node','-e',source,timeout=30)

    def execute(self):
        now = dt.datetime.now(dt.timezone.utc)
        start, end = (dt.datetime.fromisoformat(v) for v in (self.args.window_start,self.args.window_end))
        assert start.tzinfo and end.tzinfo and start <= now < end
        assert end - now >= dt.timedelta(minutes=30)
        self.preflight()
        for name in ('docker-compose.yml','.env'):
            source = self.root / name
            if source.is_file():
                dest=self.artifacts / ('before-'+name.replace('.','-'))
                shutil.copyfile(source,dest);os.chmod(dest,0o600)
        self.state('stopping-database')
        try:
            self.stopped = True
            self.compose('stop','-t','60','db')
            # Database is stopped before copying all data and the Vault key volume.
            # Helpers have no network, read-only source mounts and no published ports.
            backup_command = """set -eu
            pg_controldata /var/lib/postgresql/data | grep -Eq 'Database cluster state: *shut down$'
            cd /
            tar -cf /backup/cold-cluster.tar var/lib/postgresql/data etc/postgresql-custom
            chown "$1:$2" /backup/cold-cluster.tar
            chmod 600 /backup/cold-cluster.tar
            """
            self.command('docker','run','--rm','--network','none','--read-only','--memory','1g',
              '--cpus','1.5','--user','0','--volumes-from',self.container+':ro',
              '--mount','type=bind,src='+str(self.artifacts)+',dst=/backup',
              '--entrypoint','/bin/sh',TARGET,'-c',backup_command,'archive',str(os.getuid()),str(os.getgid()),timeout=600)
            archive=self.artifacts/'cold-cluster.tar'
            archive_hash=digest(archive)
            self.command('tar','-tf',str(archive),timeout=120)
            self.state('cold-backup-verified',sha256=archive_hash,bytes=archive.stat().st_size)
            if dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=20) >= end:
                raise RuntimeError('Insufficient remaining maintenance window')
            self.set_image(SOURCE,TARGET);self.changed=True
            self.compose('up','-d','--no-deps','db')
            self.ready('17.11')
            if self.args.rehearsal_fail_after_ready:
                assert self.rehearsal
                self.sql("create schema if not exists appsec_maintenance_rehearsal; create table if not exists appsec_maintenance_rehearsal.retained_writes(marker text); insert into appsec_maintenance_rehearsal.retained_writes values('written-on-17.11-before-binary-rollback');")
                raise RuntimeError('Rehearsal application readiness failure')
            self.app_health()
            self.state('complete',version='17.11',catalog=self.baseline,backup_sha256=archive_hash)
        except BaseException:
            self.state('rolling-back-binaries-only')
            # Minor releases share a data format. Never restore an older snapshot
            # after clients could have resumed writing: retain current PGDATA.
            if self.changed:
                self.compose('stop','-t','60','db')
                self.set_image(TARGET,SOURCE)
            if self.stopped:
                self.compose('up','-d','--no-deps','db')
                self.ready('17.6')
            self.state('rolled-back',version='17.6',retained_current_pgdata=True)
            raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--window-start')
    parser.add_argument('--window-end')
    parser.add_argument('--rehearsal-project')
    parser.add_argument('--rehearsal-fail-after-ready',action='store_true')
    args=parser.parse_args()
    if not __debug__:
        raise RuntimeError('Optimized Python disables required maintenance assertions')
    assert not args.rehearsal_fail_after_ready or args.rehearsal_project
    task=Maintenance(args)
    with (task.base/'execution.lock').open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.execute:
            assert args.window_start and args.window_end
            task.execute()
        else:
            task.preflight()


if __name__=='__main__':
    try:
        main()
    except BaseException as error:
        print(json.dumps({'state':'failed','reason':type(error).__name__}),flush=True)
        raise SystemExit(1)
