// The API as a whole, without Vault: every route but /api/healthz needs the
// session, cross-site writes are refused, unknown routes are 404, and the
// request log never carries a cookie or a body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const build = mkdtempSync(join(tmpdir(), 'build-'));
writeFileSync(join(build, 'act'), '2\n');
process.env.BUILD_DIR = build;
process.env.STORY_FILE = new URL('../../config/story.json', import.meta.url).pathname;
process.env.RUNNER_TOKEN_FILE = join(build, 'no-token');
const { server } = await import('../server.js');

const lines = [];
const orig = console.log;
console.log = (l) => lines.push(String(l));
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); console.log = orig; });

test('healthz needs no session and tells the act', async () => {
  const r = await fetch(`${base}/api/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, act: 2 });
});

test('every other route needs the session', async () => {
  for (const [m, p] of [['GET', '/api/scoreboard'], ['GET', '/api/witness'], ['GET', '/api/status'], ['POST', '/api/acts/3/run'], ['POST', '/api/acts/9/run'],
    ['POST', '/api/leases/database%2Fcreds%2Fbooking%2Fx/revoke'], ['POST', '/api/rotate/deploy'], ['GET', '/api/stage-reset'], ['POST', '/api/stage-reset'], ['GET', '/api/events']]) {
    const r = await fetch(`${base}${p}`, { method: m, headers: { cookie: 'vult_sid=forged-session-id' } });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('a write from another site is refused before anything runs', async () => {
  const r = await fetch(`${base}/api/acts/3/run`, { method: 'POST', headers: { origin: 'https://localhost:13701' } });
  assert.equal(r.status, 403);
});

test('unknown routes and methods', async () => {
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/scoreboard`, { method: 'DELETE' })).status, 405);
});

test('the sign-in starts at Keycloak with PKCE', async () => {
  const r = await fetch(`${base}/auth/login`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/protocol\/openid-connect\/auth\?client_id=tidewell-console&.*code_challenge_method=S256/);
});

test('a callback with a forged state goes back to the console with the reason', async () => {
  const r = await fetch(`${base}/auth/callback?state=forged&code=x`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(decodeURIComponent(r.headers.get('location')), /sign-in expired/);
});

test('the request log names routes, never cookies or bodies', () => {
  const all = lines.join('\n');
  assert.ok(lines.some((l) => l.includes('"route":"/api/leases/:id/revoke"')));
  assert.equal(all.includes('forged-session-id'), false);
  assert.equal(all.includes('database%2Fcreds'), false);
});
