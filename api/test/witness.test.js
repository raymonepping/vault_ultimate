// The witness's one judgement that needs no target: an unreachable target is
// unknown (works null), a refusal is a refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { failure, envValue } from '../lib/witness.js';

test('network failures are unknown, refusals are refused', () => {
  assert.equal(failure(Object.assign(new Error('connect ECONNREFUSED 10.89.28.60:5432'), { code: 'ECONNREFUSED' }), 't').works, null);
  assert.equal(failure(new Error('LDAP: no answer within 8000 ms'), 't').works, null);
  assert.equal(failure(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 't').works, null);
  const r = failure(new Error('password authentication failed for user "booking_app"'), 't');
  assert.deepEqual(r, { works: false, tried: 't', answer: 'password authentication failed for user "booking_app"', lifetime: null });
});

test('envValue reads KEY=VALUE lines, nothing else', () => {
  assert.equal(envValue('# c\nDB_PASSWORD=x=y\nDB_USER=a', 'DB_PASSWORD'), 'x=y');
  assert.equal(envValue('XDB_PASSWORD=1', 'DB_PASSWORD'), null);
  assert.equal(envValue(null, 'A'), null);
});
