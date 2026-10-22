#!/usr/bin/env python3
"""Install/run only the authorized 22 October maintenance, not recurring backups."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import pwd
import subprocess

BASE = Path('/home/administrador/backups/apticket/postgres-maint-20261022')
START = dt.datetime.fromisoformat('2026-10-22T23:00:00-03:00')
END = dt.datetime.fromisoformat('2026-10-23T05:00:00-03:00')
MARKER = '# apticket-postgres-minor-20261022-once'


def crontab():
    result = subprocess.run(['crontab','-l'],capture_output=True,text=True)
    if result.returncode and 'no crontab for' not in result.stderr.lower():
        raise RuntimeError('Unable to inspect operator crontab')
    return result.stdout.splitlines()


def write_crontab(lines):
    subprocess.run(['crontab','-'],input=('\n'.join(lines)+'\n').encode(),check=True)


def file_hash(name):
    return hashlib.sha256((BASE/name).read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--run',action='store_true')
    args=parser.parse_args()
    if not __debug__:
        raise RuntimeError('Optimized Python is not supported')
    assert args.install != args.run
    assert pwd.getpwuid(os.getuid()).pw_name == 'administrador'
    assert BASE.resolve() == BASE and BASE.stat().st_mode & 0o077 == 0
    config_path=BASE/'scheduled-job.json'
    if args.install:
        assert dt.datetime.now(dt.timezone.utc)<START
        # Resolve the host's actual local timezone; no reliance on CRON_TZ support.
        local=START.astimezone()
        config={
          'start':START.isoformat(),'end':END.isoformat(),
          'files':{name:file_hash(name) for name in ['run-postgres-window.py','postgres-minor-maintenance.py']},
        }
        fd=os.open(config_path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as out:json.dump(config,out,indent=2)
        output=BASE/'scheduled-status.log'
        fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600);os.close(fd)
        entry=f'{local.minute} {local.hour} {local.day} {local.month} * /usr/bin/python3 {BASE}/run-postgres-window.py --run >> {output} 2>&1 {MARKER}'
        lines=[line for line in crontab() if MARKER not in line]
        write_crontab([*lines,entry])
        assert sum(MARKER in line for line in crontab())==1
        print(json.dumps({'state':'scheduled','start':START.isoformat(),'end':END.isoformat(),'one_shot':True,'other_cron_entries_preserved':True}))
    else:
        config=json.loads(config_path.read_text())
        assert config['start']==START.isoformat() and config['end']==END.isoformat()
        assert all(file_hash(name)==sha for name,sha in config['files'].items())
        # Remove only our marker before running. Failure cannot leave a yearly job.
        write_crontab([line for line in crontab() if MARKER not in line])
        result=subprocess.run(['/usr/bin/python3',str(BASE/'postgres-minor-maintenance.py'),
          '--execute','--window-start',START.isoformat(),'--window-end',END.isoformat()])
        raise SystemExit(result.returncode)


if __name__=='__main__':
    main()
