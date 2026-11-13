import test from 'node:test';
import assert from 'node:assert/strict';
import { lifetime, duration, leakWindow, ACTS, tidy } from '../src/format.js';

test('lifetimes: never, a replacement, nothing but residuals, unknown', () => {
  assert.deepEqual(lifetime({ never: true, id: 'keycloak-ldap-bind' }), { text: 'never', sub: 'keycloak-ldap-bind: no end date, no rotation' });
  assert.deepEqual(lifetime({ seconds: 3498, id: 'booking-tls-key', replacement: true }), { text: '58 min', sub: 'booking-tls-key, what replaced it' });
  assert.equal(lifetime({ seconds: 0, id: null }).sub, 'nothing standing but residuals');
  assert.equal(lifetime(null).text, 'unknown');
});

test('durations read like a person says them', () => {
  assert.equal(duration(49), '49 s');
  assert.equal(duration(900), '15 min');
  assert.equal(duration(31536000), '365 days');
});

test('leak windows: open with a plus, closed to the second', () => {
  assert.equal(leakWindow({ open: true, seconds: 30 }).text, '30 s+');
  assert.equal(leakWindow({ open: false, seconds: 49, closed_at: '2026-11-13T14:23:30Z' }).text, '49 s');
  assert.equal(leakWindow(undefined).text, 'none yet');
});

test('seven acts, 0 to 6, each says what it removes', () => {
  assert.deepEqual(ACTS.map((a) => a.n), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(ACTS.every((a) => a.removes && a.how));
});

test("Vault's error wrapper is tidied, the words kept", () => {
  assert.equal(tidy('2 errors occurred: * CEILING_POLICY_DENIED: actor ceiling policy denied permission * permission denied'), 'CEILING_POLICY_DENIED: actor ceiling policy denied permission; permission denied');
});
