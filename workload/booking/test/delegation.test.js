// The delegation token's claims (D21): one permit, bounded by the clerk's
// session, the agent as actor; check() takes only this issuer's live tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsFor, check, permitPath, ISSUER, AUDIENCE } from '../lib/delegation.js';

const now = 1_800_000_000;
const jwt = (claims) => `${Buffer.from('{"alg":"ES256","typ":"at+jwt"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`;

test('one permit for one crossing, the clerk as subject, the agent as actor', () => {
  const c = claimsFor({ user: 'teun', exp: now + 3600 }, 'rebook', 'd1-1100', now, 'j1');
  assert.deepEqual(c, {
    iss: ISSUER, aud: AUDIENCE, sub: 'teun', act: { sub: 'tide-agent' }, jti: 'j1', iat: now, exp: now + 300,
    authorization_details: [{ type: 'vault:path_access', path: 'kv/data/permits/rebook/d1-1100', capabilities: ['read'] }],
  });
});

test("never outlives the clerk's session, and an ended session gets nothing", () => {
  assert.equal(claimsFor({ user: 'teun', exp: now + 42 }, 'rebook', 'd1-1100', now).exp, now + 42);
  assert.throws(() => claimsFor({ user: 'teun', exp: now }, 'rebook', 'd1-1100', now), /session has ended/);
});

test('only allowlisted actions and crossing ids become permit paths', () => {
  assert.equal(permitPath('cancel', 'd2-1530'), 'kv/data/permits/cancel/d2-1530');
  assert.throws(() => permitPath('delete', 'd1-1100'), /no such permit/);
  assert.throws(() => permitPath('rebook', '../ops/x'), /no such permit/);
});

test('check(): this issuer, this actor, not expired', () => {
  const c = claimsFor({ user: 'teun', exp: now + 3600 }, 'rebook', 'd1-1100', now, 'j2');
  assert.deepEqual(check(jwt(c), now), { subject: 'teun', jti: 'j2', exp: now + 300, permits: ['kv/data/permits/rebook/d1-1100'], token: jwt(c) });
  assert.equal(check(jwt({ ...c, iss: 'https://elsewhere' }), now), null);
  assert.equal(check(jwt({ ...c, act: { sub: 'someone' } }), now), null);
  assert.equal(check(jwt(c), now + 301), null);
  assert.equal(check('not-a-jwt', now), null);
});
