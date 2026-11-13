// The witness's OCSP and LDAP encoders, checked against a second
// implementation: openssl builds a throwaway CA, two certificates, the
// requests and a responder's answers in a temporary directory at test time
// (no certificate or key is committed: the secret scanners refuse them).
// Without openssl the OCSP cases are skipped, the LDAP ones still run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { ocspRequest, ocspStatus, ldapBind, ldapBindResult, tlv, read } from '../lib/der.js';

function fixtures() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  const d = mkdtempSync(join(tmpdir(), 'ocsp-'));
  const ossl = (...a) => execFileSync('openssl', a, { cwd: d, stdio: ['ignore', 'pipe', 'ignore'] });
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes'];
  ossl('req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Witness Test CA', '-days', '30');
  const index = [];
  for (const n of ['good', 'revoked']) {
    ossl('req', ...ec, '-keyout', `${n}.key`, '-out', `${n}.csr`, '-subj', `/CN=${n}.test`);
    ossl('x509', '-req', '-in', `${n}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${n}.pem`, '-days', '7');
    const serial = ossl('x509', '-in', `${n}.pem`, '-noout', '-serial').toString().trim().split('=')[1];
    index.push(n === 'good' ? `V\t301231000000Z\t\t${serial}\tunknown\t/CN=good.test` : `R\t301231000000Z\t261113120000Z\t${serial}\tunknown\t/CN=revoked.test`);
  }
  writeFileSync(join(d, 'index.txt'), `${index.join('\n')}\n`);
  for (const n of ['good', 'revoked']) {
    ossl('ocsp', '-issuer', 'ca.pem', '-cert', `${n}.pem`, '-no_nonce', '-reqout', `${n}.req`);
    ossl('ocsp', '-index', 'index.txt', '-rsigner', 'ca.pem', '-rkey', 'ca.key', '-CA', 'ca.pem', '-reqin', `${n}.req`, '-respout', `${n}.resp`, '-ndays', '1');
  }
  return (f) => readFileSync(join(d, f));
}

const fx = fixtures();
const skip = fx ? false : 'openssl is not installed';
const spki = fx && new X509Certificate(fx('ca.pem')).publicKey.export({ type: 'spki', format: 'der' });

for (const n of ['good', 'revoked']) {
  test(`the OCSP request for ${n}.pem is byte for byte openssl's`, { skip }, () => {
    assert.deepEqual(ocspRequest(new X509Certificate(fx(`${n}.pem`)).raw, spki), fx(`${n}.req`));
  });
}

test("the OCSP answers from openssl's responder: good, and revoked with its time", { skip }, () => {
  assert.deepEqual(ocspStatus(fx('good.resp')), { status: 'good' });
  assert.deepEqual(ocspStatus(fx('revoked.resp')), { status: 'revoked', revoked_at: '2026-11-13T12:00:00Z' });
});

test('an unsuccessful OCSP response says why', () => {
  assert.deepEqual(ocspStatus(Buffer.from('30030a0106', 'hex')), { status: 'error', response_status: 'unauthorized' });
});

test('LDAP simple bind request (RFC 4511 layout)', () => {
  const b = ldapBind('cn=a', 'pw');
  assert.equal(b.toString('hex'), '301202010160' + '0d' + '020103' + '040463' + '6e3d61' + '80027077');
});

test('LDAP bind result: success, invalid credentials, incomplete', () => {
  const res = (code, diag) => tlv(0x30, tlv(0x02, Buffer.from([1])), tlv(0x61, tlv(0x0a, Buffer.from([code])), tlv(0x04, Buffer.alloc(0)), tlv(0x04, Buffer.from(diag))));
  assert.deepEqual(ldapBindResult(res(0, '')), { code: 0, diagnostic: '' });
  assert.deepEqual(ldapBindResult(res(49, '')), { code: 49, diagnostic: '' });
  assert.equal(ldapBindResult(res(0, '').subarray(0, 5)), null);
});

test('long-form lengths round-trip', () => {
  const big = tlv(0x04, Buffer.alloc(300, 1));
  assert.deepEqual(read(big), { tag: 0x04, header: 0, start: 4, end: 304 });
});
