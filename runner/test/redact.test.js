import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor } from '../lib/redact.js';

// Synthetic values only: shaped like secrets, never real ones.
const FAKE = {
  vault: 'hvs.CAESIFAKEFAKEFAKEFAKEFAKEFAKE0123',
  jwt: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.ZmFrZXNpZ25hdHVyZWZha2U', // gitleaks:allow (synthetic: the payload is {"sub":"fake"})
  b64: 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh',
};

test('each secret shape is redacted', () => {
  const r = createRedactor();
  assert.equal(r(`got ${FAKE.vault} back`), 'got hvs.[redacted] back');
  assert.equal(r(`bearer ${FAKE.jwt}`), 'bearer [redacted jwt]');
  assert.equal(r('Unseal Key 1: abcdef'), 'Unseal Key 1: [redacted]');
  assert.equal(r('PGPASSWORD=hunter2 psql'), 'PGPASSWORD=[redacted] psql');
  assert.equal(r('"secret_id": "abc-def"'), '"secret_id": "[redacted]"');
  assert.equal(r(`VAULT_LICENSE=${FAKE.b64}`), 'VAULT_LICENSE=[redacted]');
  assert.equal(r(`blob ${FAKE.b64}`), 'blob [redacted]');
  assert.equal(r(`id ${'ab12'.repeat(10)}`), 'id [redacted hex]');
});

test('ordinary output passes unchanged', () => {
  const r = createRedactor();
  for (const line of ['[+] Running 3/3', 'vpip-vault_1  Started', 'phase deliver: ok (12 s)', '/Users/me/Documents/VSC/HashiCorp/Vault/vault_pipeline']) assert.equal(r(line), line);
});

test('a PEM private key block is dropped whole', () => {
  const r = createRedactor();
  const out = ['before', '-----BEGIN EC PRIVATE KEY-----', 'MHcCAQEEIFAKE', 'more', '-----END EC PRIVATE KEY-----', 'after'].map(r);
  assert.deepEqual(out, ['before', '[redacted private key]', null, null, null, 'after']);
});
