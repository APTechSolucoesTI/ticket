#!/usr/bin/env python3
"""Encrypt a maintenance archive and verify its copy on the approved CIFS mount.

The random passphrase stays in a protected server file; the operator also keeps
an independent Windows DPAPI-protected recovery copy outside this repository.
No plaintext database/configuration archive is written to the shared directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid

BASE = Path('/home/administrador/backups/apticket/postgres-maint-20261022')
MOUNT = Path('/dev/backup')
REMOTE = 'APTicket/postgres-maint-20261022'
KEY = BASE / 'remote-backup.key'
GNUPG_HOME = BASE / 'gpg-home'
IMAGE = 'supabase/postgres:17.11.0.006@sha256:c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2'


def digest(path):
    value=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):value.update(block)
    return value.hexdigest()


def run(*command, **kwargs):
    result=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs)
    if result.returncode:raise RuntimeError(f'Backup {command[0]} exited {result.returncode}; no production data changed')
    return result.stdout


def helper(command, *args, source=None):
    mounts=['--mount','type=bind,src='+str(MOUNT)+',dst=/remote']
    if source:mounts+=['--mount','type=bind,src='+str(source)+',dst=/input,readonly']
    return run('docker','run','--rm','--network','none','--read-only','--user','0',
      '--memory','256m','--cpus','1',*mounts,'--entrypoint','sh',IMAGE,'-c',command,'backup',*args,timeout=600)


def check():
    assert KEY.is_file() and KEY.stat().st_mode & 0o077==0 and len(KEY.read_bytes().strip())>=64
    GNUPG_HOME.mkdir(mode=0o700,exist_ok=True)
    assert GNUPG_HOME.stat().st_mode & 0o077==0
    data=json.loads(run('findmnt','-T',str(MOUNT),'-J','-o','TARGET,SOURCE,FSTYPE'))['filesystems']
    assert len(data)==1 and data[0]['target']==str(MOUNT) and data[0]['fstype']=='cifs'
    assert data[0]['source']=='//192.168.3.52/aptech/Banco'
    probe='.apticket-probe-'+uuid.uuid4().hex
    helper('set -eu; mkdir -p /remote/'+REMOTE+'; p=/remote/'+REMOTE+'/$1; (set -C; : > "$p"); rm -- "$p"',probe)


def copy(source):
    source=source.resolve()
    assert source.is_relative_to(BASE) and source.is_file() and source.suffix=='.tar'
    check()
    encrypted=source.with_name(source.stem+'-'+uuid.uuid4().hex[:12]+'.tar.gpg')
    run('gpg','--batch','--no-options','--homedir',str(GNUPG_HOME),'--pinentry-mode','loopback','--passphrase-file',str(KEY),
      '--symmetric','--cipher-algo','AES256','--s2k-digest-algo','SHA256',
      '--s2k-count','65011712','--compress-algo','none','--output',str(encrypted),str(source),timeout=600)
    encrypted.chmod(0o600)
    plain_hash=digest(source)
    # Verify complete decryption and the integrity check without emitting bytes.
    process=subprocess.Popen(['gpg','--batch','--no-options','--homedir',str(GNUPG_HOME),'--pinentry-mode','loopback',
      '--passphrase-file',str(KEY),'--decrypt',str(encrypted)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    value=hashlib.sha256()
    for block in iter(lambda:process.stdout.read(1024*1024),b''):value.update(block)
    assert process.wait(timeout=60)==0 and value.hexdigest()==plain_hash
    cipher_hash=digest(encrypted)
    name=encrypted.name
    # CIFS dirty page cache can exceed a constrained helper's memory. Flush each
    # bounded 8 MiB batch; expose the final filename only after hash validation.
    copy_command='''set -eu
    target=/remote/'''+REMOTE+'''/$1
    partial="$target.partial"
    test ! -e "$target"; test ! -e "$partial"
    (set -C; : > "$partial")
    size=$(stat -c %s /input/"$1")
    offset=0
    while [ $((offset * 1048576)) -lt "$size" ]; do
      dd if=/input/"$1" of="$partial" bs=1048576 count=8 skip="$offset" seek="$offset" conv=notrunc,fsync status=none
      offset=$((offset + 8))
    done
    actual=$(sha256sum "$partial")
    test "${actual%% *}" = "$2"
    mv "$partial" "$target"
    sha256sum "$target"
    '''
    result=helper(copy_command,name,cipher_hash,source=encrypted.parent)
    assert result.decode().split()[0]==cipher_hash
    # A detached share must never be mistaken for a local backup directory.
    data=json.loads(run('findmnt','-T',str(MOUNT),'-J','-o','TARGET,SOURCE,FSTYPE'))['filesystems']
    assert data[0]['target']==str(MOUNT) and data[0]['fstype']=='cifs'
    receipt={'destination':str(MOUNT)+'/'+REMOTE+'/'+name,'ciphertext_sha256':cipher_hash,
      'plaintext_sha256':plain_hash,'cipher':'GnuPG AES256, iterated S2K SHA256, integrity checked',
      'bytes':encrypted.stat().st_size,'decryption_verified':True,'remote_copy_verified':True}
    target=source.with_suffix('.remote-copy.json')
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out:json.dump(receipt,out,indent=2)
    print(json.dumps(receipt),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--source')
    args=parser.parse_args()
    if not __debug__:raise RuntimeError('Optimized Python is not supported')
    assert args.check != bool(args.source)
    if args.check:
        check();print('Approved remote backup mount, key permissions and write probe verified.')
    else:copy(Path(args.source))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'backup':'failed','reason':type(error).__name__,'detail':str(error)}),flush=True)
        raise SystemExit(1)
