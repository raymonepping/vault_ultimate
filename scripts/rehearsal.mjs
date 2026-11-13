// scripts/rehearsal.mjs: the show, end to end, through the console API as
// Saskia (scripts/rehearsal.sh resets to act 0 before and after). She signs
// in through Keycloak's real form (the code flow, followed by hand: no
// browser); every act runs as she presses it. Prints one line per check,
// never a value: known values are compared in memory only.
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.argv[2];
const conf = (k) => {
  for (const f of ['.env', 'config/defaults.conf']) {
    try {
      const m = new RegExp(`^${k}=(.*)$`, 'm').exec(readFileSync(join(ROOT, f), 'utf8'));
      if (m) return m[1].trim();
    } catch { /* optional */ }
  }
  throw new Error(`${k} is not set`);
};
const WEB = `https://localhost:${conf('VULT_PORT_WEB')}`;
const KC = `https://localhost:${conf('VULT_PORT_KEYCLOAK')}`;
const BOOKING = `https://localhost:${conf('VULT_PORT_BOOKING')}`;
const VAULT = `https://127.0.0.1:${conf('VULT_PORT_VAULT_1')}`;
const secret = (p) => readFileSync(join(ROOT, '.secrets', p), 'utf8').trim();
const story = JSON.parse(readFileSync(join(ROOT, 'config/story.json'), 'utf8'));

let pass = 0;
let fail = 0;
const seen = []; // every API answer, for the value scan
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A cookie jar per origin, enough for the code flow ───────────────────────
const jar = new Map();
function remember(url, res) {
  const host = new URL(url).host;
  const cookies = jar.get(host) || new Map();
  for (const c of res.headers.getSetCookie?.() || []) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    cookies.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
  }
  jar.set(host, cookies);
}
const cookieFor = (url) => [...(jar.get(new URL(url).host) || new Map())].map(([k, v]) => `${k}=${v}`).join('; ');
async function go(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: 'manual', headers: { ...(opts.headers || {}), cookie: cookieFor(url) } });
  remember(url, res);
  return res;
}

async function signIn(user) {
  let r = await go(`${WEB}/auth/login`);
  const auth = r.headers.get('location');
  r = await go(auth);
  const html = await r.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
  if (!action) throw new Error("Keycloak's login form was not served");
  r = await go(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: user, password: secret(`people/${user}`), credentialId: '' }) });
  const callback = r.headers.get('location');
  if (!callback?.startsWith(`${WEB}/auth/callback`)) throw new Error(`Keycloak did not send the code back (HTTP ${r.status})`);
  r = await go(callback);
  return r.headers.get('location');
}

async function api(method, path, body, headers = {}) {
  const r = await go(`${WEB}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  seen.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* not JSON */ }
  return { status: r.status, json };
}

async function waitOp(after, timeoutMs = 540_000) {
  const t0 = Date.now();
  for (;;) {
    const { json } = await api('GET', '/api/op');
    if (json?.op && json.op.id > after && json.op.state !== 'running') return json.op;
    if (Date.now() - t0 > timeoutMs) return { state: 'timed out waiting', lines: [] };
    await sleep(2000);
  }
}
const opId = async () => (await api('GET', '/api/op')).json?.op?.id ?? 0;

async function runOnHost(path, body) {
  for (let i = 0; i < 60; i += 1) {
    const before = await opId();
    const r = await api('POST', path, body);
    if (r.status === 200) return waitOp(before);
    if (r.status !== 409) return { state: `HTTP ${r.status}: ${r.json?.error}`, lines: [] };
    await sleep(2000);
  }
  return { state: 'the runner stayed busy', lines: [] };
}
async function witness() {
  const op = await runOnHost('/api/witness/run');
  const { json } = await api('GET', '/api/witness');
  return { op, w: json?.latest };
}

// Bookings while a wave runs: the app must keep working.
function bookDuring() {
  let stop = false;
  const tally = { ok: 0, failed: 0 };
  const loop = (async () => {
    while (!stop) {
      try {
        const r = await fetch(`${BOOKING}/api/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Rehearsal Passenger', crossing: 'd2-1530' }) });
        if (r.status === 200 || r.status === 201 || r.status === 409) tally.ok += 1; // 409: the crossing is full, the app answered
        else tally.failed += 1;
      } catch {
        tally.failed += 1;
      }
      await sleep(3000);
    }
  })();
  return async () => {
    stop = true;
    await loop;
    return tally;
  };
}

// ── The show ─────────────────────────────────────────────────────────────────
const STANDING = [6, 6, 5, 4, 2, 1, 1];
const UNMANAGED = [6, 1, 0, 0, 0, 0, 0];

console.log('sign-in');
const landed = await signIn(story.presenter.user).catch((e) => `error: ${e.message}`);
check('Saskia signs in through Keycloak; the API sets her session', landed === '/', landed);
const me = await api('GET', '/api/session');
check('the session is hers, with vult-presenter', me.json?.user === 'saskia' && me.json.policies.includes('vult-presenter'), JSON.stringify(me.json));

console.log('act 0');
let { op, w } = await witness();
check('the witness runs on the host', op.state === 'succeeded', op.state);
check(`act 0: every inventory credential stands (${w?.standing})`, w?.standing === 6);
check(`act 0: every copy is unmanaged (${w?.unmanaged})`, w?.unmanaged === 6);
check('act 0: the longest lifetime is never', w?.longest?.never === true);
const sb0 = (await api('GET', '/api/scoreboard')).json?.scoreboard;
check('act 0: the canary leak window is open', sb0?.leak_windows?.[0]?.open === true, JSON.stringify(sb0?.leak_windows));

for (const n of [1, 2, 3, 4, 5, 6]) {
  console.log(`act ${n}`);
  const done = bookDuring();
  op = await runOnHost(`/api/acts/${n}/run`);
  const tally = await done();
  check(`act ${n} runs from the console (make act-${n})`, op.state === 'succeeded', `${op.state}\n${(op.lines || []).slice(-8).join('\n')}`);
  if (op.state !== 'succeeded') break;
  check(`act ${n}: bookings made during the wave (${tally.ok} answered, ${tally.failed} failed)`, tally.ok > 0 && (n === 6 || tally.failed === 0));
  ({ w } = await witness());
  check(`act ${n}: standing ${w?.standing} (expected ${STANDING[n]})`, w?.standing === STANDING[n]);
  check(`act ${n}: unmanaged copies ${w?.unmanaged} (expected ${UNMANAGED[n]})`, w?.unmanaged === UNMANAGED[n]);
  const row = (id) => w?.credentials?.find((c) => c.id === id);
  if (n === 1) {
    const gh = w?.copies?.find((c) => c.id === 'github-actions-secret');
    const ls = w?.copies?.find((c) => c.id === 'localstack-copy');
    check("act 1: GitHub's own record lists the deploy token, Vault syncs it", gh?.managed === true && /GitHub lists/.test(gh.answer), gh?.answer);
    check("act 1: LocalStack's copy carries Vault's tag", ls?.managed === true && /hashicorp:vault/.test(ls.answer), ls?.answer);
  }
  if (n === 2) {
    check('act 2: the static password is refused (verbatim)', /password authentication failed/.test(row('booking-db-password')?.answer || ''), row('booking-db-password')?.answer);
    check('act 2: the used secret id is refused', w?.extras?.[0]?.works === false && /wrapping token is not valid/.test(w.extras[0].answer), w?.extras?.[0]?.answer);
    const sb = (await api('GET', '/api/scoreboard')).json?.scoreboard;
    check(`act 2: the act 0 leak window closed (${sb?.leak_windows?.[0]?.seconds} s)`, sb?.leak_windows?.[0]?.open === false);
  }
  if (n === 3) check('act 3: the year-long certificate: OCSP says revoked', /OCSP Cert Status: revoked/.test(row('booking-tls-key')?.answer || ''), row('booking-tls-key')?.answer);
  if (n === 4) {
    check('act 4: the old bind password: Invalid credentials (49)', /Invalid credentials \(49\)/.test(row('keycloak-ldap-bind')?.answer || ''), row('keycloak-ldap-bind')?.answer);
    check('act 4: the old client secret: invalid_client', /invalid_client/.test(row('booking-oidc-client-secret')?.answer || ''), row('booking-oidc-client-secret')?.answer);
  }
  if (n === 5) {
    const a5 = (await api('GET', '/api/acts')).json?.act5;
    check(`act 5: the agent rebooked with Teun's delegation (${a5?.asked?.moved} moved)`, a5?.asked?.delegated === true && a5.asked.moved > 0, JSON.stringify(a5?.asked));
    check("act 5: the overreach: Vault's ceiling refuses it", a5?.overreach?.status === 403 && /CEILING_POLICY_DENIED/.test(a5.overreach.answer), a5?.overreach?.answer);
    check("act 5: the agent's old key is refused", row('tide-agent-api-key')?.works === false, row('tide-agent-api-key')?.answer);
    check('act 5: the longest lifetime is minutes, not never', w?.longest?.never !== true && w?.longest?.seconds <= 3700, JSON.stringify(w?.longest));
  }
  if (n === 6) {
    const inv = (await api('GET', '/api/investigation')).json;
    const d = inv?.drill;
    const t = inv?.timeline;
    const gone = d ? (Date.parse(d.session_gone_at) - Date.parse(d.revoked_at)) / 1000 : 99;
    check(`act 6: the revoked lease's session is gone within seconds (${gone.toFixed(2)} s)`, gone < 5);
    check('act 6: bookings came back on a new lease', d?.new_lease && d.new_lease !== d.revoked_lease && d.booking?.booking > 0, JSON.stringify(d?.booking));
    check('act 6: the old deploy token is refused, the rotated one stands (the residual)', row('ci-deploy-token')?.works === false && row('ci-deploy-token')?.current?.works === true, JSON.stringify(row('ci-deploy-token')?.current));
    const after = (s) => (t?.rows || []).some((r) => r.source === s && Date.parse(r.at) >= Date.parse(d.rotated_at) - 5000);
    check("act 6: GitHub's and LocalStack's own times show the rotation", after('github') && after('localstack'));
    check('act 6: the timeline has the revoke, the termination and the new login', ['revoked lease', 'ended by the revocation', 'Vault Agent logged in'].every((s) => (t?.rows || []).some((r) => r.text.includes(s))));
    check('act 6: no system changed by hand; the audit log names saskia', t?.panel?.hand_changes === 0 && t.panel.people.includes('saskia'), JSON.stringify(t?.panel));
    check('act 6: the summary cites real rows, or says it is not available', t?.summary?.available ? t.summary.sentences.length > 0 : t?.summary?.text === 'not available: Ollama is not running', JSON.stringify(t?.summary).slice(0, 200));
  }
}

console.log('negatives');
const anon = await fetch(`${WEB}/api/scoreboard`);
check('no session: 401', anon.status === 401);
check('an act out of order is refused', (await api('POST', '/api/acts/3/run')).status === 409);
check('an act that does not exist is refused', (await api('POST', '/api/acts/7/run')).status === 404);
check('a lease the console did not list is refused', (await api('POST', `/api/leases/${encodeURIComponent('database/creds/booking/NotListed0000')}/revoke`)).status === 403);
check('a path in the body is refused', (await api('POST', '/api/witness/run', { path: 'sys/leases/revoke-prefix/database' })).status === 400);
check('a write from another origin is refused', (await api('POST', '/api/rotate/deploy', null, { origin: 'https://localhost:13701' })).status === 403);
check('the stage reset needs its confirmation', (await api('POST', '/api/stage-reset', { confirm: 'guess' })).status === 403);
{
  // Saskia's own token on a value she may not read (kv ops/*: Import writes it, she never reads it).
  const kc = await (await fetch(`${KC}/realms/tidewell/protocol/openid-connect/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'tidewell-cli', username: 'saskia', password: secret('people/saskia') }) })).json();
  const login = await (await fetch(`${VAULT}/v1/tidewell/auth/jwt/login`, { method: 'POST', body: JSON.stringify({ role: 'person', jwt: kc.access_token }) })).json();
  const tok = login.auth?.client_token;
  const r = await fetch(`${VAULT}/v1/tidewell/kv/data/${story.legacy[0].kv_name}`, { headers: { 'X-Vault-Token': tok } });
  check(`Saskia's own token may not read ${story.legacy[0].kv_name} (Vault ${r.status})`, r.status === 403);
  await fetch(`${VAULT}/v1/tidewell/auth/token/revoke-self`, { method: 'POST', headers: { 'X-Vault-Token': tok } });
}

console.log('no value anywhere');
const values = [
  ['workload/booking-db-password'], ['workload/deploy-token'], ['workload/agent-api-key'],
  ['identity/system/keycloak-bind'], ['identity/booking-client-secret'], ['people/saskia'], ['people/teun'],
].map(([p]) => secret(p)).concat(story.legacy.map((l) => l.value)).filter((v) => v && v.length >= 12);
for (const p of ['/api/events', '/api/status', '/api/witness', '/api/acts', '/api/investigation', '/api/scoreboard']) await api('GET', p);
const logs = ['vult-api', 'vult-web', 'vult-booking', 'vult-tide_agent', 'vult-booking_agent'].map((c) => {
  try {
    return execFileSync('podman', ['logs', '--since', '2h', c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
});
const witnessFiles = readdirSync(join(ROOT, '.build/witness/history')).map((f) => readFileSync(join(ROOT, '.build/witness/history', f), 'utf8'));
const hay = [...seen, ...logs, ...witnessFiles, readFileSync(join(ROOT, '.build/act6/timeline.json'), 'utf8')];
const hits = values.filter((v) => hay.some((h) => h.includes(v))).length;
check(`no known value (${values.length}) in ${seen.length} API answers, 5 containers' logs, the witness history or the timeline`, hits === 0, `${hits} value(s) found (not printed)`);
const tokenish = hay.filter((h) => /\bhvs\.[A-Za-z0-9_-]{20,}/.test(h)).length;
check('no Vault token in any of them', tokenish === 0, `${tokenish} place(s)`);

console.log(`rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
