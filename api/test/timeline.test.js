// Act 6's timeline on recorded drill records (synthetic ids and times): the
// citation filter, the derived-expiry rule, the hand-change count, people,
// and the "not available" path when the model is down or slow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, handChanges, derivedExpiries, people, panel, citedOnly, summarise } from '../lib/timeline.js';

const audit = (time, path, who, extra = {}) => ({ type: 'response', time, request: { id: `req-${time}`, path, operation: 'update' }, auth: { display_name: who }, ...extra });
const raw = {
  collected_at: '2026-11-13T16:10:00Z',
  drill: { declared_at: '2026-11-13T16:00:00Z', revoked_at: '2026-11-13T16:00:20Z', session_gone_at: '2026-11-13T16:00:21Z', revoked_lease: 'database/creds/booking/AAAA1111', revoked_user: 'v-tidewell-booking-old', new_users: ['v-tidewell-booking-new'] },
  audit: [
    audit('2026-11-13T16:00:05Z', 'auth/jwt/login', 'tidewell-auth-jwt-saskia'),
    { type: 'request', time: '2026-11-13T16:00:19Z', request: { id: 'x', path: 'sys/leases/revoke/database/creds/booking/AAAA1111' }, auth: { display_name: 'jwt-saskia' } },
    audit('2026-11-13T16:00:20Z', 'sys/leases/revoke/database/creds/booking/AAAA1111', 'jwt-saskia'),
    audit('2026-11-13T16:00:30Z', 'auth/approle/login', 'approle'),
    { ...audit('2026-11-13T16:00:31Z', 'database/creds/booking', 'tidewell-auth-approle'), request: { id: 'r', path: 'database/creds/booking', operation: 'read' }, response: { secret: { lease_id: 'database/creds/booking/BBBB2222' } } },
    audit('2026-11-13T16:01:00Z', 'kv/data/ci/deploy-token', 'jwt-saskia'),
    audit('2026-11-13T16:01:05Z', 'kv/data/ci/deploy-token', 'jwt-teun', { error: 'permission denied' }),
  ],
  pg: [
    { timestamp: '2026-11-13 15:59:50.000 UTC', user: 'v-tidewell-booking-old', message: 'connection authorized: user=...', pid: 1 },
    { timestamp: '2026-11-13 15:59:55.000 UTC', user: 'v-tidewell-booking-old', message: 'connection authorized: user=...', pid: 2 },
    { timestamp: '2026-11-13 16:00:21.000 UTC', user: 'v-tidewell-booking-old', message: 'terminating connection due to administrator command', pid: 2 },
    { timestamp: '2026-11-13 16:00:32.000 UTC', user: 'v-tidewell-booking-new', message: 'connection authorized: user=...', pid: 3 },
    { timestamp: '2026-11-13 16:00:33.000 UTC', user: 'someone-else', message: 'connection authorized', pid: 4 },
  ],
  targets: [
    { system: 'github', name: 'TIDEWELL_CI_DEPLOY_TOKEN_VALUE', at: '2026-11-13T16:01:03Z' },
    { system: 'localstack', name: 'tidewell-ci/deploy-token', at: '2026-11-13T16:01:02Z' },
  ],
  leases: [
    { lease: 'database/creds/booking/OLD00000', ended_at: '2026-11-13T16:05:00Z', revoked: false },
    { lease: 'database/creds/booking/AAAA1111', ended_at: '2026-11-13T16:00:20Z', revoked: true },
    { lease: 'database/creds/booking/LATER000', ended_at: '2026-11-13T16:30:00Z', revoked: false },
  ],
};

test('rows: responses only, in time order, ids R01..; the pool\'s reconnects and other users left out', () => {
  const rows = buildTimeline(raw);
  assert.deepEqual(rows.map((r) => r.source), ['postgresql', 'vault-audit', 'vault-audit', 'postgresql', 'vault-audit', 'vault-audit', 'postgresql', 'vault-audit', 'localstack', 'github', 'vault-audit', 'derived']);
  assert.equal(rows[0].id, 'R01');
  assert.match(rows.find((r) => r.path?.startsWith('sys/leases/revoke')).text, /^jwt-saskia revoked lease database\/creds\/booking\/AAAA1111\.\.\.$/);
  assert.match(rows.find((r) => r.who === 'jwt-teun').text, /refused: permission denied/);
});

test('derived expiry: only leases that ended without a revoke, never in the future, labelled derived', () => {
  const d = derivedExpiries(raw.leases, [{ path: 'sys/leases/revoke/database/creds/booking/AAAA1111' }], Date.parse(raw.collected_at));
  assert.equal(d.length, 1);
  assert.equal(d[0].ref, 'database/creds/booking/OLD00000');
  assert.equal(d[0].derived, true);
  assert.match(d[0].text, /derived from its expire time/);
});

test('hand changes: a target change with a Vault change in the minute before is not by hand', () => {
  const rows = buildTimeline(raw);
  assert.equal(handChanges(rows).length, 0);
  // The session ends before Vault logs the revoke's response: not by hand.
  const early = buildTimeline({ ...raw, pg: [{ timestamp: '2026-11-13 16:00:19.995 UTC', user: 'v-tidewell-booking-old', message: 'terminating connection due to administrator command', pid: 9 }] });
  assert.equal(handChanges(early).length, 0);
  const late = buildTimeline({ ...raw, targets: [{ system: 'github', name: 'X', at: '2026-11-13T16:05:00Z' }] });
  assert.deepEqual(handChanges(late).map((r) => r.text), ['github records X updated (its own timestamp)']);
});

test('people: only jwt sign-ins name a person (namespace prefix or not); the panel counts the window to the second', () => {
  const rows = buildTimeline(raw);
  assert.deepEqual(people(rows), ['saskia', 'teun']);
  assert.deepEqual(panel(raw, rows).window, { from: '2026-11-13T16:00:00Z', revoked_at: '2026-11-13T16:00:20Z', session_gone_at: '2026-11-13T16:00:21Z', seconds: 21, revoke_to_gone_seconds: 1 });
  assert.equal(panel(raw, rows).hand_changes, 0);
});

test('citations: a sentence survives only when every id it cites is a real row', () => {
  const rows = buildTimeline(raw);
  const out = citedOnly(JSON.stringify({ sentences: [
    { text: 'Saskia revoked the lease.', cites: ['R03'] },
    { text: 'An attacker logged in.', cites: ['R99'] },
    { text: 'No citation at all.', cites: [] },
    { text: 'Half right.', cites: ['R01', 'R77'] },
  ] }), rows);
  assert.deepEqual(out, { sentences: [{ text: 'Saskia revoked the lease.', cites: ['R03'] }], dropped: 3 });
  assert.equal(citedOnly('not json', rows).error, 'the model did not answer JSON');
});

test('Ollama down or slow: "not available", and the timeline stays whole', async () => {
  const rows = buildTimeline(raw);
  const s = await summarise(rows, () => Promise.reject(new Error('timed out after 20000 ms')));
  assert.deepEqual(s, { available: false, text: 'not available: Ollama is not running', reason: 'timed out after 20000 ms' });
  const ok = await summarise(rows, async () => '{"sentences": [{"text": "x", "cites": ["R01"]}]}');
  assert.equal(ok.available, true);
  assert.equal(ok.sentences.length, 1);
});
