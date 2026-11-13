// server.js: Tidewell Ferries' booking application (fictional). A plain, real
// workload: PostgreSQL bookings, staff sign-in through Keycloak, support
// notes, a deploy check for CI, and an API the AI agent calls. It does not
// know it is in a demo: each credential comes from wherever the estate puts
// it (lib/creds.js), and it follows changes without a restart.
//
// Auth:
//   staff  a session from Keycloak's code flow (client tidewell-booking), or a
//          Keycloak access token as Bearer (audience tidewell-vault; scripted)
//   agent  X-Agent-Key (the before estate's static key, until act 5), or a
//          delegation token as Bearer (act 5: lib/delegation.js)
//   CI     X-Deploy-Token on POST /api/deploy/check
import https from 'node:https';
import { createSecureContext } from 'node:tls';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { current, PATHS } from './lib/creds.js';
import { readIfPresent, watch, fingerprint } from './lib/files.js';
import { jwksVerifier, equalSecret, decode } from './lib/tokens.js';
import { poolManager } from './lib/db.js';

const PORT = Number(process.env.PORT || 8443);
const PUBLIC_URL = process.env.BOOKING_PUBLIC_URL || 'https://localhost:14202';
const KC_PUBLIC = process.env.KEYCLOAK_PUBLIC || 'https://localhost:14203/realms/tidewell';
const KC_INTERNAL = process.env.KEYCLOAK_INTERNAL || 'https://keycloak:8443/realms/tidewell';
const CLIENT_ID = 'tidewell-booking';
const TIDE_AGENT = process.env.TIDE_AGENT_URL || 'http://tide-agent:8080';
const STAFF_GROUP = 'bookings';
const SESSION_IDLE = 3600 * 1000;
const TLS = {
  vault: { cert: '/vault/out/tls/cert.pem', key: '/vault/out/tls/key.pem' },
  estate: { cert: '/run/booking/tls/cert.pem', key: '/run/booking/tls/key.pem' },
};
const PUBLIC_FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };

const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));
const db = poolManager();
const verifyKeycloak = jwksVerifier({ jwksUrl: `${KC_INTERNAL}/protocol/openid-connect/certs`, issuer: KC_PUBLIC });
const sessions = new Map(); // sid -> {user, groups, exp, idleUntil, accessToken}
const pending = new Map(); // state -> {verifier, nonce, until}
let creds = current();
db.use(creds.database);

// Delegation (act 5) is optional until its module exists in the image.
let delegation = null;
try {
  delegation = await import('./lib/delegation.js');
} catch {
  delegation = null;
}

// Agent's pair when it loads, else the estate's: a broken render must not
// take the site down (the watcher tries Agent's pair again on its next write).
function tlsPair() {
  if (readIfPresent(TLS.vault.cert) && readIfPresent(TLS.vault.key)) {
    const p = { src: 'vault-agent', cert: readFileSync(TLS.vault.cert), key: readFileSync(TLS.vault.key) };
    try {
      createSecureContext({ cert: p.cert, key: p.key });
      return p;
    } catch (e) {
      log({ msg: 'vault-agent certificate unusable, serving the estate certificate', error: e.message });
    }
  }
  return { src: 'estate', cert: readFileSync(TLS.estate.cert), key: readFileSync(TLS.estate.key) };
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : headers['Content-Type'] || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}
const fail = (res, status, error) => send(res, status, { error });

async function readJson(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('body is not JSON'), { status: 400 });
  }
}

function cookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  if (!m) return null;
  try {
    return decodeURIComponent(m.slice(name.length + 1));
  } catch {
    return null; // a malformed cookie is no session, not a 500
  }
}
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// who(req): the caller, or null. Never throws for a bad credential.
async function who(req) {
  const sid = cookie(req, 'tw_session');
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid);
    if (Date.now() < s.idleUntil && Date.now() / 1000 < s.exp + 3600) {
      s.idleUntil = Date.now() + SESSION_IDLE;
      // exp: the bound this session is kept to (the ID token lives 300 s; the
      // session an hour past it), so a delegation never outlives it.
      return { kind: 'staff', user: s.user, groups: s.groups, via: 'session', session: s, exp: s.exp + 3600 };
    }
    sessions.delete(sid);
  }
  const key = req.headers['x-agent-key'];
  if (key) {
    return creds.agentKey && equalSecret(String(key), creds.agentKey) ? { kind: 'agent', user: 'tide-agent', via: 'static-key', may: ['rebook', 'cancel'] } : null;
  }
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    let header = {};
    try {
      header = decode(token).header;
    } catch {
      return null;
    }
    if (header.typ === 'at+jwt' && delegation) {
      const d = delegation.check(token);
      return d ? { kind: 'agent', user: 'tide-agent', via: 'delegation', ...d } : null;
    }
    const c = await verifyKeycloak(token, { audience: 'tidewell-vault' }).catch(() => null);
    return c ? { kind: 'staff', user: c.preferred_username, groups: c.groups || [], via: 'bearer', token, exp: c.exp } : null;
  }
  return null;
}
const isStaff = (p) => p?.kind === 'staff' && (p.groups || []).includes(STAFF_GROUP);

function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || o === new URL(PUBLIC_URL).origin;
}

// ── OIDC code flow with PKCE (client tidewell-booking) ───────────────────────
function login(res) {
  for (const [k, v] of pending) if (Date.now() > v.until) pending.delete(k);
  if (pending.size >= 100) return fail(res, 429, 'too many sign-ins in progress; try again in a few minutes');
  const state = b64u(randomBytes(16));
  const verifier = b64u(randomBytes(32));
  const nonce = b64u(randomBytes(16));
  pending.set(state, { verifier, nonce, until: Date.now() + 600000 });
  const u = new URL(`${KC_PUBLIC}/protocol/openid-connect/auth`);
  u.search = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', scope: 'openid', redirect_uri: `${PUBLIC_URL}/auth/callback`,
    state, nonce, code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
  }).toString();
  send(res, 302, '', { Location: u.toString() });
}

// Keycloak's token endpoint. Before act 4 the client authenticates with the
// client secret from booking.env; from act 4 with the site's own one-hour
// Vault certificate over mutual TLS (client-x509): no secret anywhere.
function keycloakToken(form) {
  const body = new URLSearchParams(form);
  const mtls = !creds.oidcSecret && currentTls.src === 'vault-agent';
  if (creds.oidcSecret) body.set('client_secret', creds.oidcSecret);
  else if (!mtls) return Promise.reject(Object.assign(new Error('no client credential for Keycloak'), { status: 503 }));
  return new Promise((resolve, reject) => {
    const r = https.request(new URL(`${KC_INTERNAL}/protocol/openid-connect/token`), {
      method: 'POST', timeout: 8000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...(mtls ? { cert: currentTls.cert, key: currentTls.key } : {}),
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(d);
        } catch {
          json = {};
        }
        resolve({ ok: res.statusCode < 300, status: res.statusCode, json });
      });
    });
    r.on('timeout', () => r.destroy(new Error('Keycloak did not answer in 8 s')));
    r.on('error', reject);
    r.end(body.toString());
  });
}

async function callback(req, res, url) {
  const state = url.searchParams.get('state');
  const p = state && pending.get(state);
  pending.delete(state);
  if (!p || Date.now() > p.until) return fail(res, 400, 'sign-in expired, start again');
  const r = await keycloakToken({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: `${PUBLIC_URL}/auth/callback`, client_id: CLIENT_ID, code_verifier: p.verifier });
  const tok = r.json;
  if (!r.ok) return fail(res, 401, `Keycloak refused the sign-in: ${tok.error || r.status}`);
  const id = await verifyKeycloak(tok.id_token, { audience: CLIENT_ID }).catch((e) => ({ error: e.message }));
  if (id.error || id.nonce !== p.nonce) return fail(res, 401, 'the ID token did not verify');
  const sid = b64u(randomBytes(32));
  sessions.set(sid, { user: id.preferred_username, groups: id.groups || [], exp: id.exp, idleUntil: Date.now() + SESSION_IDLE, accessToken: tok.access_token });
  send(res, 302, '', { Location: '/', 'Set-Cookie': `tw_session=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax` });
}

// ── The routes ──────────────────────────────────────────────────────────────
async function route(req, res, url) {
  const m = req.method;
  const path = url.pathname;
  if (m === 'GET' && PUBLIC_FILES[path]) {
    const [file, type] = PUBLIC_FILES[path];
    return send(res, 200, readFileSync(new URL(`./public/${file}`, import.meta.url)), { 'Content-Type': type });
  }
  if (m === 'GET' && path === '/healthz') {
    let database = 'down';
    try {
      await db.query('select 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    // The lease id names the app's current credential (act 6: the one to
    // revoke); it is not a credential, and the username and password stay in.
    return send(res, database === 'up' ? 200 : 503, { ok: database === 'up', database, credential: db.source(), lease: creds.database?.lease_id ?? null, tls: currentTls.src });
  }
  if (m === 'GET' && path === '/auth/login') return login(res);
  if (m === 'GET' && path === '/auth/callback') return callback(req, res, url);
  if (m === 'POST' && path === '/auth/logout') {
    const sid = cookie(req, 'tw_session');
    if (sid) sessions.delete(sid);
    return send(res, 204, '', { 'Set-Cookie': 'tw_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
  }

  // CI's deploy check: the deploy token, nothing else.
  if (m === 'POST' && path === '/api/deploy/check') {
    const t = req.headers['x-deploy-token'];
    return creds.deployToken && t && equalSecret(String(t), creds.deployToken) ? send(res, 204, '') : fail(res, 401, 'deploy token refused');
  }

  if (m === 'GET' && path === '/api/crossings') {
    const r = await db.query(`select c.id, c.day, c.departs, c.from_port, c.to_port, c.seats, c.status,
      count(b.id) filter (where b.status <> 'cancelled')::int as booked
      from crossings c left join bookings b on b.crossing_id = c.id group by c.id order by c.day, c.departs`);
    return send(res, 200, { crossings: r.rows });
  }
  if (m === 'POST' && path === '/api/bookings') {
    if (!sameOrigin(req)) return fail(res, 403, 'cross-site request refused');
    const b = await readJson(req);
    const name = String(b.name || '').trim();
    if (!/^[\p{L} .'-]{2,60}$/u.test(name)) return fail(res, 400, 'a name of 2 to 60 letters');
    const crossing = String(b.crossing || '');
    const out = await db.tx(async (c) => {
      const x = await c.query(`select seats, status from crossings where id = $1 for update`, [crossing]);
      if (!x.rowCount) throw Object.assign(new Error('no such crossing'), { status: 404 });
      if (x.rows[0].status !== 'scheduled') throw Object.assign(new Error('that crossing is cancelled'), { status: 409 });
      const n = await c.query(`select count(*)::int as n from bookings where crossing_id = $1 and status <> 'cancelled'`, [crossing]);
      if (n.rows[0].n >= x.rows[0].seats) throw Object.assign(new Error('that crossing is full'), { status: 409 });
      const p = await c.query(`insert into passengers (name, synthetic) values ($1, true) returning id`, [name]);
      const r = await c.query(`insert into bookings (crossing_id, passenger_id, status, updated_by) values ($1, $2, 'booked', 'web') returning id`, [crossing, p.rows[0].id]);
      return { booking: r.rows[0].id, crossing };
    });
    return send(res, 201, out);
  }

  const who_ = await who(req);
  if (m === 'GET' && path === '/api/me') return send(res, 200, who_ ? { user: who_.user, kind: who_.kind, groups: who_.groups || [], via: who_.via } : { user: null });
  if (!who_) return fail(res, 401, 'sign in first');
  if (who_.via === 'session' && m !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'cross-site request refused');

  let mm;
  if (m === 'GET' && (mm = path.match(/^\/api\/crossings\/([a-z0-9-]{3,20})\/manifest$/))) {
    if (!isStaff(who_)) return fail(res, 403, 'staff only');
    const r = await db.query(`select b.id, p.name, b.cabin, p.vehicle_plate, b.status from bookings b join passengers p on p.id = b.passenger_id
      where b.crossing_id = $1 order by b.id`, [mm[1]]);
    return send(res, 200, { crossing: mm[1], bookings: r.rows });
  }
  if (m === 'POST' && (mm = path.match(/^\/api\/crossings\/([a-z0-9-]{3,20})\/cancel$/))) {
    if (!isStaff(who_)) return fail(res, 403, 'staff only');
    const r = await db.query(`update crossings set status = 'cancelled' where id = $1 and status = 'scheduled' returning id`, [mm[1]]);
    return send(res, 200, { crossing: mm[1], cancelled: r.rowCount === 1 });
  }
  if (m === 'POST' && (mm = path.match(/^\/api\/crossings\/([a-z0-9-]{3,20})\/rebook$/))) {
    const from = mm[1];
    const ok = isStaff(who_) || (who_.kind === 'agent' && (await permit(who_, 'rebook', from)));
    if (!ok) return fail(res, 403, `not allowed to rebook this crossing${who_.answer ? ` (${who_.answer})` : ''}`);
    const to = String((await readJson(req)).to || '');
    const moved = await db.tx(async (c) => {
      const x = await c.query(`select id, seats, status from crossings where id = any($1) for update`, [[from, to]]);
      const dst = x.rows.find((r) => r.id === to);
      if (!dst || !x.rows.find((r) => r.id === from)) throw Object.assign(new Error('no such crossing'), { status: 404 });
      if (dst.status !== 'scheduled') throw Object.assign(new Error('the target crossing is cancelled'), { status: 409 });
      const free = dst.seats - (await c.query(`select count(*)::int as n from bookings where crossing_id = $1 and status <> 'cancelled'`, [to])).rows[0].n;
      const r = await c.query(`with m as (select id from bookings where crossing_id = $1 and status <> 'cancelled' order by id limit $3)
        update bookings b set crossing_id = $2, status = 'rebooked', updated_at = now(), updated_by = $4 from m where b.id = m.id returning b.id`, [from, to, Math.max(free, 0), `${who_.user} (${who_.via})`]);
      return r.rowCount;
    });
    log({ msg: 'rebooked', from, to, moved, by: who_.user, via: who_.via, for: who_.subject || null });
    return send(res, 200, { from, to, moved });
  }
  if (m === 'POST' && (mm = path.match(/^\/api\/crossings\/([a-z0-9-]{3,20})\/cancel-all$/))) {
    const ok = isStaff(who_) || (who_.kind === 'agent' && (await permit(who_, 'cancel', mm[1])));
    if (!ok) return fail(res, 403, `not allowed to cancel bookings on this crossing${who_.answer ? ` (${who_.answer})` : ''}`);
    const r = await db.query(`update bookings set status = 'cancelled', updated_at = now(), updated_by = $2 where crossing_id = $1 and status <> 'cancelled' returning id`, [mm[1], `${who_.user} (${who_.via})`]);
    log({ msg: 'cancelled bookings', crossing: mm[1], count: r.rowCount, by: who_.user, via: who_.via });
    return send(res, 200, { crossing: mm[1], cancelled: r.rowCount });
  }
  if (m === 'POST' && (mm = path.match(/^\/api\/bookings\/(\d{1,9})\/cancel$/))) {
    const r0 = await db.query(`select crossing_id from bookings where id = $1`, [Number(mm[1])]);
    if (!r0.rowCount) return fail(res, 404, 'no such booking');
    const ok = isStaff(who_) || (who_.kind === 'agent' && (await permit(who_, 'cancel', r0.rows[0].crossing_id)));
    if (!ok) return fail(res, 403, `not allowed to cancel this booking${who_.answer ? ` (${who_.answer})` : ''}`);
    const r = await db.query(`update bookings set status = 'cancelled', updated_at = now(), updated_by = $2 where id = $1 and status <> 'cancelled' returning id`, [Number(mm[1]), `${who_.user} (${who_.via})`]);
    return send(res, 200, { booking: Number(mm[1]), cancelled: r.rowCount === 1 });
  }
  if (m === 'POST' && path === '/api/agent/ask') return askAgent(req, res, who_, '/ask');
  if (m === 'POST' && path === '/api/agent/act') return askAgent(req, res, who_, '/act');
  if (path === '/api/notes') {
    if (!isStaff(who_)) return fail(res, 403, 'staff only');
    if (m === 'GET') {
      const r = await db.query(`select id, author, body, created_at from support_notes order by id desc limit 50`);
      return send(res, 200, { notes: r.rows });
    }
    if (m === 'POST') {
      const body = String((await readJson(req)).body || '');
      if (!body.trim() || body.length > 2000) return fail(res, 400, 'a note of 1 to 2000 characters');
      const r = await db.query(`insert into support_notes (author, body) values ($1, $2) returning id, created_at`, [who_.user, body]);
      log({ msg: 'support note', id: r.rows[0].id, author: who_.user, body_fp: fingerprint(body) });
      return send(res, 201, r.rows[0]);
    }
  }
  return fail(res, 404, 'not found');
}

// permit(agent, action, crossing): the static key may do anything (the
// before estate's problem). A delegation is Vault's call: the token reads the
// action's permit, and Vault's answer (verbatim) is kept on the caller for
// the log and the refusal.
async function permit(p, action, crossing) {
  if (p.via === 'static-key') return true;
  if (p.via !== 'delegation' || !delegation) return false;
  const cid = randomUUID();
  const r = await delegation.authorize(p, action, crossing, cid);
  p.answer = r.answer;
  log({ msg: 'delegated action', action, crossing, for: p.subject, jti: p.jti, vault: r.answer, correlation_id: cid });
  return r.ok;
}

// The clerk asks the agent (act 5 on: with a delegation for one crossing's
// rebook; before it, the agent uses its own static key). /api/agent/act is
// the same without the model: the rehearsal's scripted overreach.
async function askAgent(req, res, who_, path) {
  if (!isStaff(who_)) return fail(res, 403, 'staff only');
  const b = await readJson(req);
  const crossing = String(b.crossing || b.from || '');
  const headers = { 'Content-Type': 'application/json' };
  if (!creds.agentKey) {
    if (!delegation) return fail(res, 503, 'no delegation available');
    const cid = randomUUID();
    headers.Authorization = `Bearer ${await delegation.issue({ user: who_.user, exp: who_.exp }, 'rebook', crossing, cid)}`;
    log({ msg: 'delegation signed', for: who_.user, crossing, correlation_id: cid });
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    let r;
    try {
      r = await fetch(`${TIDE_AGENT}${path}`, { method: 'POST', headers, signal: ac.signal, body: JSON.stringify(path === '/ask' ? { text: String(b.text || '').slice(0, 500) } : { action: b.action, from: b.from, to: b.to }) });
    } catch (e) {
      return fail(res, 502, `the agent did not answer: ${ac.signal.aborted ? 'no answer within 60 s' : e.cause?.code || e.message}`);
    }
    const out = await r.json().catch(() => ({}));
    log({ msg: 'asked the agent', by: who_.user, path, status: r.status, via: headers.Authorization ? 'delegation' : 'static-key' });
    return send(res, r.status, { ...out, delegated: !!headers.Authorization });
  } finally {
    clearTimeout(t);
  }
}

// ── Start, and follow the credential files ──────────────────────────────────
let currentTls = tlsPair();
const server = https.createServer({ cert: currentTls.cert, key: currentTls.key, minVersion: 'TLSv1.2' }, async (req, res) => {
  const t0 = Date.now();
  const id = randomUUID();
  let url;
  try {
    url = new URL(req.url, PUBLIC_URL);
    await route(req, res, url);
  } catch (e) {
    const status = e.status || 500;
    if (!res.headersSent) fail(res, status, status === 500 ? 'internal error' : e.message);
    if (status === 500) log({ msg: 'error', id, error: e.message });
  } finally {
    log({ id, method: req.method, path: url?.pathname, status: res.statusCode, ms: Date.now() - t0 });
  }
});
server.listen(PORT, () => log({ msg: 'booking up', port: PORT, credential: db.source(), tls: currentTls.src }));

watch([PATHS.env, PATHS.db, PATHS.deploy], () => {
  creds = current();
  db.use(creds.database);
});
watch([TLS.vault.cert, TLS.vault.key, TLS.estate.cert], () => {
  const next = tlsPair();
  server.setSecureContext({ cert: next.cert, key: next.key }); // throws on a half-written or mismatched pair
  currentTls = next;
  log({ msg: 'tls certificate in use', source: currentTls.src });
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now > v.until) pending.delete(k);
  for (const [k, v] of sessions) if (now > v.idleUntil) sessions.delete(k);
}, 60000).unref();
