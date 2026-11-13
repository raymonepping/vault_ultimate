import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { jwksVerifier, equalSecret } from '../lib/tokens.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims, kid = 'k1') {
  const s = `${b64u({ alg: 'RS256', typ: 'JWT', kid })}.${b64u(claims)}`;
  return `${s}.${sign('RSA-SHA256', Buffer.from(s), privateKey).toString('base64url')}`;
}
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const now = () => 1000;
const v = jwksVerifier({ jwksUrl: 'https://kc/certs', issuer: 'https://kc/realms/t', fetchImpl, now });

test('a token signed by the realm key, right issuer and audience, verifies', async () => {
  const c = await v(jwt({ iss: 'https://kc/realms/t', aud: ['tidewell-vault'], exp: 2000, preferred_username: 'teun' }), { audience: 'tidewell-vault' });
  assert.equal(c.preferred_username, 'teun');
});

test('wrong issuer, wrong audience, expired and unknown key are refused', async () => {
  await assert.rejects(v(jwt({ iss: 'https://evil', aud: 'tidewell-vault', exp: 2000 })), /issuer/);
  await assert.rejects(v(jwt({ iss: 'https://kc/realms/t', aud: 'other', exp: 2000 }), { audience: 'tidewell-vault' }), /audience/);
  await assert.rejects(v(jwt({ iss: 'https://kc/realms/t', aud: 'tidewell-vault', exp: 10 })), /expired/);
  await assert.rejects(v(jwt({ iss: 'https://kc/realms/t', exp: 2000 }, 'k9')), /unknown signing key/);
});

test('a tampered payload is refused', async () => {
  const t = jwt({ iss: 'https://kc/realms/t', aud: 'tidewell-vault', exp: 2000, groups: ['bookings'] }).split('.');
  t[1] = b64u({ iss: 'https://kc/realms/t', aud: 'tidewell-vault', exp: 2000, groups: ['platform'] });
  await assert.rejects(v(t.join('.')), /bad signature/);
});

test('equalSecret compares in constant time and refuses empty values', () => {
  assert.equal(equalSecret('abc', 'abc'), true);
  assert.equal(equalSecret('abc', 'abd'), false);
  assert.equal(equalSecret('', ''), false);
  assert.equal(equalSecret('abc', undefined), false);
});
