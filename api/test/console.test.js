// The console's guards: an unknown act, an act out of order, a foreign lease
// id, a path in the body, the reset's single-use confirmation, GitHub's
// staleness; the event list cleans what it keeps; OIDC state is single use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actToRun, noParameters, createLeaseList, createConfirmations, githubStale, rotationAllowed } from '../lib/console.js';
import { createEvents, clean, scrub } from '../lib/events.js';
import { createOidc } from '../lib/oidc.js';
import { Refused } from '../lib/session.js';

test('acts: 1 to 6 only, and only the next one', () => {
  assert.equal(actToRun('3', 2), 3);
  for (const bad of ['0', '7', 'x', '1;rm', '../2', '', undefined]) assert.throws(() => actToRun(bad, 0), (e) => e instanceof Refused && e.status === 404);
  assert.throws(() => actToRun('4', 2), (e) => e.status === 409 && /run act 3 next/.test(e.message));
  assert.throws(() => actToRun('6', 6), (e) => e.status === 404 || /every act has run/.test(e.message));
});

test('a body with any field is refused: paths never come from a request', () => {
  noParameters({});
  noParameters(undefined);
  assert.throws(() => noParameters({ path: 'sys/leases/revoke-prefix/database' }), (e) => e.status === 400);
});

test('only a lease the console listed, and only for a while', () => {
  let t = 0;
  const l = createLeaseList({ ttlMs: 1000, now: () => t });
  l.remember('database/creds/booking/AbCdEf123456');
  assert.equal(l.check('database/creds/booking/AbCdEf123456'), 'database/creds/booking/AbCdEf123456');
  assert.throws(() => l.check('database/creds/booking/Other0000000'), (e) => e.status === 403);
  l.remember('database/creds/booking/YsNipbkTd40y0Z5gk.Ab12C'); // the namespace suffix
  assert.equal(l.check('database/creds/booking/YsNipbkTd40y0Z5gk.Ab12C'), 'database/creds/booking/YsNipbkTd40y0Z5gk.Ab12C');
  l.remember('sys/leases/../ldap/x'); // not a booking lease: never listed
  assert.throws(() => l.check('sys/leases/../ldap/x'), (e) => e.status === 403);
  t = 2000;
  assert.throws(() => l.check('database/creds/booking/AbCdEf123456'), (e) => e.status === 403);
});

test('the reset confirmation is single use and expires', () => {
  let t = 0;
  const c = createConfirmations({ ttlMs: 100, now: () => t });
  const k = c.issue();
  c.take(k);
  assert.throws(() => c.take(k), (e) => e.status === 403);
  const k2 = c.issue();
  t = 200;
  assert.throws(() => c.take(k2), (e) => e.status === 403);
  assert.throws(() => c.take('guess'), (e) => e.status === 403);
});

test('GitHub evidence older than Vault last change is stale', () => {
  assert.deepEqual(githubStale('2026-11-13T15:00:00Z', '2026-11-13T15:01:00Z'), { stale: true, why: "read 2026-11-13T15:00:00Z, before Vault's last change 2026-11-13T15:01:00Z" });
  assert.deepEqual(githubStale('2026-11-13T15:02:00Z', '2026-11-13T15:01:00Z'), { stale: false });
  assert.equal(githubStale(null, null).stale, true);
});

test('events drop secret fields and redact token-shaped text, at any depth', () => {
  const e = createEvents(2, () => 't');
  e.add({ what: 'rotate', vault: { request_id: 'r1', data: { value: 'hunter2', version: 3 } }, note: 'token hvs.CAESIFAKEFAKEFAKEFAKEFAKE0123 used' });
  const [ev] = e.list();
  assert.equal(JSON.stringify(ev).includes('hunter2'), false);
  assert.equal(JSON.stringify(ev).includes('FAKEFAKE'), false);
  assert.equal(ev.vault.data.version, 3);
  e.add({ a: 1 });
  e.add({ b: 2 });
  assert.equal(e.list().length, 2, 'bounded');
  assert.deepEqual(clean({ password: 'x', ok: 'y' }), { ok: 'y' });
});

test('OIDC: PKCE on the way out; a state is used once and expires', async () => {
  let t = 0;
  const calls = [];
  const fetcher = async (url, opts) => { calls.push({ url, body: String(opts.body) }); return { ok: true, json: async () => ({ access_token: 'kc-at' }) }; };
  const o = createOidc({ publicUrl: 'https://localhost:14203/realms/tidewell', internalUrl: 'https://keycloak:8443/realms/tidewell', redirectUri: 'https://localhost:14201/auth/callback', fetcher, now: () => t });
  const u = new URL(o.start());
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('client_id'), 'tidewell-console');
  const state = u.searchParams.get('state');
  assert.equal(await o.finish(state, 'code-1'), 'kc-at');
  assert.match(calls[0].body, /code_verifier=/);
  await assert.rejects(o.finish(state, 'code-1'), (e) => e.status === 400);
  const s2 = new URL(o.start()).searchParams.get('state');
  t = 700_000;
  await assert.rejects(o.finish(s2, 'code-2'), (e) => e.status === 400);
});

test('scrub drops tokens, passwords, keys and values at any depth', () => {
  const v = scrub({ a: { password: 'pw-synthetic', value: 'tidewell-demo', value_fp: 'abcd1234', list: [{ client_token: 't', ok: 1 }] }, secret_access_key: 's', private_key: 'k' });
  assert.deepEqual(v, { a: { value_fp: 'abcd1234', list: [{ ok: 1 }] } });
});

test('the deploy token is rotated only once act 1 brought it into Vault', () => {
  assert.throws(() => rotationAllowed(0), (e) => e.status === 409 && /act 1/.test(e.message));
  rotationAllowed(1);
  rotationAllowed(6);
});
