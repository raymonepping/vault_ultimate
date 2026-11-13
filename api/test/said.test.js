import { test } from 'node:test';
import assert from 'node:assert/strict';
import { said, scrub } from '../lib/said.js';

test('scrub drops tokens, passwords, keys and values at any depth', () => {
  const v = scrub({ a: { password: 'pw-synthetic', value: 'tidewell-demo', value_fp: 'abcd1234', list: [{ client_token: 't', ok: 1 }] }, secret_access_key: 's', private_key: 'k' });
  assert.deepEqual(v, { a: { value_fp: 'abcd1234', list: [{ ok: 1 }] } });
});

test("Vault's errors are kept verbatim, with who asked", () => {
  const v = said('saskia', 'POST', 'tidewell/sys/sync/destinations/gh/tidewell-github/associations/set', {
    status: 403,
    errors: ['1 error occurred: * permission denied'],
    json: null,
    requestId: null,
  });
  assert.equal(v.status, 403);
  assert.match(v.errors[0], /permission denied/);
  assert.equal(v.as, 'saskia');
  assert.equal(v.data, null);
});
