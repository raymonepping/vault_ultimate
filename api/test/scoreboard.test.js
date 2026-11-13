// The scoreboard on recorded witness runs: the act 0 baseline, a run in the
// middle of the migration, and an after run. Shapes as lib/witness.js writes
// them (values never appear; only answers, lifetimes and fingerprints).
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarise, scoreboard, leakWindow } from '../lib/scoreboard.js';

const cred = (id, works, lifetime, extra = {}) => ({ id, works, lifetime: works ? lifetime : null, answer: works ? 'ok' : 'refused', residual: false, ...extra });
const NEVER = { never: true };
const deploy = (works = true) => cred('ci-deploy-token', works, NEVER, { residual: true, residual_reason: 'GitHub cannot reach Vault' });

const act0 = {
  at: '2026-11-13T10:00:00Z', act: 0,
  credentials: [
    cred('booking-db-password', true, NEVER),
    cred('booking-tls-key', true, { until: '2027-11-13T10:00:00Z' }),
    cred('keycloak-ldap-bind', true, NEVER),
    cred('booking-oidc-client-secret', true, NEVER),
    cred('tide-agent-api-key', true, NEVER),
    deploy(),
  ],
  copies: [
    { id: 'booking.env', unmanaged: true }, { id: 'github-actions-secret', unmanaged: true }, { id: 'localstack-copy', unmanaged: true },
    { id: 'localstack-legacy-harbour-feed', unmanaged: true }, { id: 'localstack-legacy-ticket-printer', unmanaged: true }, { id: 'localstack-legacy-smtp-relay', unmanaged: true },
  ],
};

const mid = {
  ...act0, at: '2026-11-13T10:20:07Z', act: 2,
  credentials: act0.credentials.map((c) => (c.id === 'booking-db-password' ? cred(c.id, false) : c)),
  copies: act0.copies.map((c) => ({ ...c, unmanaged: false })),
};

const after = {
  at: '2026-11-13T11:00:00Z', act: 5,
  credentials: [
    cred('booking-db-password', false), cred('booking-tls-key', false), cred('keycloak-ldap-bind', false),
    cred('booking-oidc-client-secret', true, { until: '2026-11-13T11:14:30Z' }), cred('tide-agent-api-key', false), deploy(),
  ],
  copies: act0.copies.map((c) => ({ ...c, unmanaged: false })),
};

test('act 0: everything stands, the longest lifetime is never, every copy unmanaged', () => {
  const s = summarise(act0);
  assert.equal(s.standing, 6);
  assert.deepEqual(s.longest, { never: true, id: 'booking-db-password' });
  assert.equal(s.unmanaged, 6);
  assert.deepEqual(s.residual, ['ci-deploy-token']);
});

test('mid-migration: the static password is gone, copies are managed, never still stands', () => {
  const s = summarise(mid);
  assert.equal(s.standing, 5);
  assert.equal(s.unmanaged, 0);
  assert.equal(s.longest.never, true);
  assert.equal(s.longest.id, 'keycloak-ldap-bind');
});

test('after: the residual stands but does not hold the longest lifetime at never', () => {
  const s = summarise(after);
  assert.equal(s.standing, 2);
  assert.deepEqual(s.longest, { seconds: 870, until: '2026-11-13T11:14:30Z', id: 'booking-oidc-client-secret' });
});

test('nothing standing but a residual: the longest lifetime is zero', () => {
  const run = { ...after, credentials: after.credentials.map((c) => (c.residual ? c : { ...c, works: false, lifetime: null })) };
  assert.deepEqual(summarise(run).longest, { seconds: 0, id: null });
});

test('the leak window closes at the first run that saw the credential refused, to the second', () => {
  const w = leakWindow([act0, mid, after], { id: 'act0', credential: 'booking-db-password', posted_at: '2026-11-13T09:59:30Z' });
  assert.equal(w.open, false);
  assert.equal(w.seconds, 1237); // 09:59:30 to 10:20:07
  assert.equal(w.last_seen_working, '2026-11-13T10:00:00Z');
  assert.deepEqual(w.evidence, [{ run: act0.at, id: 'booking-db-password' }, { run: mid.at, id: 'booking-db-password' }]);
});

test('a leak window stays open while every run saw the credential work', () => {
  const w = leakWindow([act0], { id: 'act0', credential: 'booking-db-password', posted_at: '2026-11-13T09:59:30Z' });
  assert.equal(w.open, true);
  assert.equal(w.closed_at, null);
  assert.equal(w.seconds, 30);
});

test('runs before the canary was posted do not count', () => {
  const w = leakWindow([act0, mid], { id: 'late', credential: 'booking-db-password', posted_at: '2026-11-13T10:10:00Z' });
  assert.equal(w.last_seen_working, null);
  assert.equal(w.seconds, 607);
});

test('the scoreboard: numbers with their evidence rows, residuals explained', () => {
  const b = scoreboard([mid, act0], [{ id: 'act0', credential: 'booking-db-password', posted_at: '2026-11-13T09:59:30Z' }]);
  assert.equal(b.at, mid.at);
  assert.equal(b.standing.value, 5);
  assert.equal(b.standing.evidence.length, 5);
  assert.equal(b.longest.value, 'never');
  assert.equal(b.unmanaged.value, 0);
  assert.equal(b.leak_windows[0].seconds, 1237);
  assert.deepEqual(b.residuals, [{ id: 'ci-deploy-token', works: true, why: 'GitHub cannot reach Vault', evidence: [{ run: mid.at, id: 'ci-deploy-token' }] }]);
  assert.equal(scoreboard([]), null);
});
