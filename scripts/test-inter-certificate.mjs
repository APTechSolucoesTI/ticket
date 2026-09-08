import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { validateInterCertificate } from '../apps/web/src/lib/inter-certificate.server.ts';
const directory = mkdtempSync(join(tmpdir(), 'apticket-inter-cert-test-'));
try {
  execFileSync(process.env.OPENSSL_BIN || 'openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=APTicket test'], {stdio:'ignore'});
  const certificate = readFileSync(join(directory,'cert.pem'),'utf8');
  const key = readFileSync(join(directory,'key.pem'),'utf8');
  assert.ok(validateInterCertificate(certificate,key).fingerprint);
  assert.throws(() => validateInterCertificate('bad','bad'));
  assert.throws(() => validateInterCertificate(certificate,certificate));
  assert.throws(() => validateInterCertificate(certificate,key,Date.now()+86400000*2));
  assert.throws(() => validateInterCertificate(certificate,key,0));
  console.log('PASS 5 certificate validation cases');
} finally {
  const target=resolve(directory);
  if (!target.startsWith(resolve(tmpdir())+sep) || !basename(target).startsWith('apticket-inter-cert-test-')) throw new Error('Unsafe temporary path');
  rmSync(target,{recursive:true});
}
