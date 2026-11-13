// api/server.js: the presenter's desk (prompt 08). One Node 24 BFF for one
// signed-in presenter, plain node:http (D18: no dependency but pg, which the
// witness uses). It holds no database: Vault, the targets and the lab's own
// records (.build, mounted read-only at /build) hold the truth. It never
// returns or logs a value, a token or a key.
//
//   GET  /api/healthz                   the process (no session)
//   GET  /auth/login, /auth/callback    Saskia signs in through Keycloak (D14)
//   GET  /api/session, POST /api/session/end
//   GET  /api/scoreboard                the four numbers (a witness run when older than 15 s)
//   GET  /api/witness, POST /api/witness/run
//   GET  /api/plan, POST /api/plan/refresh      what Terraform still has to do (ACT=6)
//   GET  /api/acts, POST /api/acts/:n/run       the next act only (host runner)
//   GET  /api/op[?id=N]                 the runner's operation (or one of the last 20) and its redacted output
//   GET  /api/leases                    the booking app's current lease (listed: revocable)
//   POST /api/leases/:id/revoke         as Saskia; a listed id only
//   POST /api/rotate/deploy             as Saskia; a new version, value made here
//   POST /api/agent/login               Agent logs in again (a fresh secret zero, host runner)
//   GET  /api/investigation, POST /api/investigation/summary   act 6's timeline
//   GET  /api/events, GET /api/status
//   GET  /api/stage-reset (a confirmation), POST /api/stage-reset {confirm}
import http from 'node:http';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { call, ns, VaultError, VAULT_NODES, nodeHealth, fetchWithTimeout } from './lib/vault.js';
import * as session from './lib/session.js';
import { createRate } from './lib/rate.js';
import { createOidc } from './lib/oidc.js';
import { createEvents } from './lib/events.js';
import { createRunnerClient } from './lib/runner-client.js';
import { actToRun, noParameters, createLeaseList, createConfirmations, githubStale } from './lib/console.js';
import { createRedactor } from './lib/redact.js';

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024;
const BUILD = process.env.BUILD_DIR || '/build';
const CONSOLE = session.CONSOLE_URLS[0];
const BOOKING = process.env.BOOKING_URL || 'https://booking:8443';
const OLLAMA = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const story = JSON.parse(readFileSync(process.env.STORY_FILE || '/app/config/story.json', 'utf8'));
const WITNESS_EVERY_MS = 15_000;

const signInRate = createRate({ max: 10, windowMs: 60_000 });
const actionRate = createRate({ max: 30, windowMs: 60_000 });
const sessions = session.createSessions({ revoke: session.vaultRevoke });
const oidc = createOidc({
  publicUrl: process.env.KEYCLOAK_PUBLIC || 'https://localhost:14203/realms/tidewell',
  internalUrl: process.env.KEYCLOAK_INTERNAL || 'https://keycloak:8443/realms/tidewell',
  redirectUri: `${CONSOLE}/auth/callback`,
});
const events = createEvents(200);
const runner = createRunnerClient();
const leases = createLeaseList();
const confirmations = createConfirmations();
let ownBusy = null; // the API's own Vault action (revoke, rotate): one at a time

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── The lab's records (read-only) ───────────────────────────────────────────
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(`${BUILD}/${p}`, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (p) => {
  try {
    return readFileSync(`${BUILD}/${p}`, 'utf8');
  } catch {
    return null;
  }
};
const mtime = (p) => {
  try {
    return statSync(`${BUILD}/${p}`).mtime.toISOString();
  } catch {
    return null;
  }
};
const currentAct = () => Number((readText('act') || '0').trim()) || 0;

// ── Plumbing ────────────────────────────────────────────────────────────────
function send(res, code, obj) {
  if (code >= 500) res.errorText = obj.error;
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(400, 'request body too large');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error();
    return b;
  } catch {
    throw new HttpError(400, 'the body must be a JSON object');
  }
}
function limited(rate, key) {
  const t = rate.take(key);
  if (!t.ok) throw new HttpError(429, `too many requests; wait ${Math.ceil(t.retryAfterMs / 1000)} s`);
}
async function exclusive(what, fn) {
  if (ownBusy) throw new HttpError(409, `busy: ${ownBusy}`);
  ownBusy = what;
  try {
    return await fn();
  } finally {
    ownBusy = null;
  }
}
// A host runner action: 202 with the operation, 409 while another runs.
// A witness run (2 s; the scoreboard starts one when the last is older than
// 15 s) is waited out; another wave is a real 409.
async function runOnHost(s, action, what) {
  let r = await runner.run(action);
  for (let i = 0; i < 15 && r.status === 409 && r.body.operation?.action === 'witness'; i += 1) {
    await new Promise((ok) => setTimeout(ok, 1000));
    r = await runner.run(action);
  }
  if (r.status === 409) throw new HttpError(409, `busy: ${r.body.operation?.action ?? 'another operation'} is running`);
  if (r.status !== 202) throw new HttpError(r.status >= 500 ? 503 : r.status, r.body.error || 'the host runner refused');
  return { event: events.add({ what, by: s.user, op: r.body.op?.id, state: 'started' }), op: r.body.op };
}
const vaultSaid = (r) => ({ status: r.status, errors: r.errors, request_id: r.requestId, node: r.node });

// The witness runs on the host; the scoreboard asks for one when the last is
// older than 15 s and the runner is free (a busy runner is no failure).
async function freshWitness() {
  const at = readJson('witness/latest.json')?.at;
  if (at && Date.now() - Date.parse(at) < WITNESS_EVERY_MS) return 'fresh';
  const r = await runner.run('witness');
  return r.status === 202 ? 'started' : r.status === 409 ? 'runner busy' : 'runner unavailable';
}

// ── Routes ──────────────────────────────────────────────────────────────────
const routes = {
  'GET /api/healthz': async () => ({ act: currentAct() }),

  'GET /auth/login': async (req, res) => {
    limited(signInRate, req.socket.remoteAddress || '?');
    res.writeHead(302, { Location: oidc.start(), 'cache-control': 'no-store' });
    res.end();
    return null;
  },
  'GET /auth/callback': async (req, res, url) => {
    limited(signInRate, req.socket.remoteAddress || '?');
    const at = await oidc.finish(url.searchParams.get('state'), url.searchParams.get('code'));
    const { sid, maxAge } = await sessions.signIn(await session.vaultLogin(at), session.tokenUser(at));
    events.add({ what: 'signed in', by: story.presenter.user, through: 'Keycloak, then Vault jwt auth' });
    res.writeHead(302, { Location: '/', 'set-cookie': session.sessionCookie(sid, maxAge), 'cache-control': 'no-store' });
    res.end();
    return null;
  },
  'POST /api/session/end': async (req, res) => {
    const was = await sessions.signOut(req);
    res.setHeader('set-cookie', session.sessionCookie('', 0));
    return { signedOut: was };
  },
  'GET /api/session': async (req) => {
    const s = sessions.get(req);
    return { user: s.user, display: story.presenter.display, role: story.presenter.role, entity_id: s.entity, policies: s.policies };
  },

  'GET /api/scoreboard': async (req) => {
    sessions.get(req);
    const witness = await freshWitness();
    const latest = readJson('witness/latest.json');
    return { act: currentAct(), witness, scoreboard: readJson('witness/scoreboard.json'), latest: latest && { at: latest.at, standing: latest.standing, unmanaged: latest.unmanaged, longest: latest.longest, residual: latest.residual, unknown: latest.unknown ?? [] } };
  },
  'GET /api/witness': async (req) => {
    sessions.get(req);
    let history = [];
    try {
      history = readdirSync(`${BUILD}/witness/history`).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 50);
    } catch { /* none yet */ }
    return { latest: readJson('witness/latest.json'), history };
  },
  'POST /api/witness/run': async (req) => {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    return runOnHost(s, 'witness', 'the witness');
  },
  'GET /api/plan': async (req) => {
    sessions.get(req);
    return { plan: readText('terraform/whats-left.txt'), at: mtime('terraform/whats-left.txt'), act: currentAct() };
  },
  'POST /api/plan/refresh': async (req) => {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    return runOnHost(s, 'plan', 'what Terraform still has to do (ACT=6)');
  },
  'GET /api/acts': async (req) => {
    sessions.get(req);
    const acts = [1, 2, 3, 4, 5, 6].map((n) => ({ n, record: readJson(`acts/act-${n}.json`) }));
    return { act: currentAct(), acts, act5: readJson('acts/act-5-evidence.json'), act6: readJson('act6/drill.json') };
  },
  'GET /api/op': async (req, res, url) => {
    sessions.get(req);
    const id = url.searchParams.get('id');
    if (id !== null && !/^[1-9][0-9]{0,8}$/.test(id)) throw new HttpError(400, 'an operation id is a number');
    const r = await runner.op(id ? Number(id) : 0);
    if (r.status === 404) throw new HttpError(404, 'no such operation among the last 20');
    return { op: r.body.op ?? null, recent: r.body.recent ?? [], runner: r.status === 200 ? 'up' : r.body.error };
  },

  'GET /api/leases': async (req) => {
    sessions.get(req);
    const { text } = await fetchWithTimeout(`${BOOKING}/healthz`, { method: 'GET' }, 5_000, 'booking');
    const h = JSON.parse(text || '{}');
    return { leases: h.lease ? [{ lease: leases.remember(h.lease), holder: 'the booking app (its current database credential)', credential: h.credential }] : [] };
  },
  'POST /api/rotate/deploy': async (req) => {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    limited(actionRate, 'actions');
    return exclusive('rotating the deploy token', async () => {
      const cid = randomUUID();
      // The value is made here, written once, and forgotten.
      const r = await call(s.token, 'POST', ns(`kv/data/${story.rotate}`), { body: { data: { value: randomBytes(30).toString('base64url') } }, correlationId: cid });
      const ev = events.add({ what: `rotated ${story.rotate}`, by: s.user, correlation_id: cid, vault: vaultSaid(r), version: r.json?.data?.version ?? null });
      if (!r.ok) throw new HttpError(r.status === 403 ? 403 : 502, `Vault refused: ${r.errors.join('; ')}`);
      return { event: ev };
    });
  },
  // After a revoke, Agent cannot renew the dead lease: a fresh single-use
  // secret id (D16's repair, make agent on the host) and it logs in again.
  'POST /api/agent/login': async (req) => {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    return runOnHost(s, 'agent', "a fresh secret zero for the booking app's Vault Agent");
  },
  'GET /api/investigation': async (req) => {
    sessions.get(req);
    return { timeline: readJson('act6/timeline.json'), drill: readJson('act6/drill.json') };
  },
  'POST /api/investigation/summary': async (req) => {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    return runOnHost(s, 'timeline', 'act 6 timeline and summary');
  },
  'GET /api/events': async (req) => {
    sessions.get(req);
    return { events: events.list() };
  },
  'GET /api/status': async (req) => {
    const s = sessions.get(req);
    const [nodes, op, ollama, booking, kvMeta] = await Promise.all([
      Promise.all(VAULT_NODES.map(nodeHealth)),
      runner.op(),
      fetchWithTimeout(`${OLLAMA}/api/ps`, { method: 'GET' }, 3_000, 'Ollama').then(({ text }) => ({ up: true, loaded: (JSON.parse(text).models || []).map((m) => m.name) })).catch((e) => ({ up: false, error: e.message })),
      fetchWithTimeout(`${BOOKING}/healthz`, { method: 'GET' }, 4_000, 'booking').then(({ text }) => { const h = JSON.parse(text); return { database: h.database, credential: h.credential, tls: h.tls }; }).catch((e) => ({ error: e.message })),
      call(s.token, 'GET', ns(`kv/metadata/${story.rotate}`)).catch(() => null),
    ]);
    const evidence = readJson('github/evidence.json');
    const witnessAt = readJson('witness/latest.json')?.at ?? null;
    return {
      act: currentAct(), nodes, booking, runner: op.status === 200 ? { up: true, op: op.body.op } : { up: false, error: op.body.error },
      ollama: { ...ollama, model: MODEL },
      witness: { at: witnessAt, age_s: witnessAt ? Math.round((Date.now() - Date.parse(witnessAt)) / 1000) : null },
      github: { read_at: evidence?.read_at ?? null, ...githubStale(evidence?.read_at, kvMeta?.ok ? kvMeta.json.data.updated_time : null) },
    };
  },
  'GET /api/stage-reset': async (req) => {
    sessions.get(req);
    return { confirm: confirmations.issue(), says: 'puts every standing secret back (act 0), on purpose' };
  },
  'POST /api/stage-reset': async (req) => {
    const s = sessions.get(req);
    const b = await readBody(req);
    if (Object.keys(b).some((k) => k !== 'confirm')) throw new HttpError(400, 'only the confirmation');
    confirmations.take(b.confirm);
    events.clear();
    return runOnHost(s, 'stage-reset', 'stage reset to act 0');
  },
};

// Routes with a parameter: the next act; a listed lease.
async function paramRoute(req, url) {
  let m = /^\/api\/acts\/([^/]+)\/run$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    limited(actionRate, 'actions');
    const n = actToRun(m[1], currentAct());
    return runOnHost(s, `act-${n}`, `act ${n}`);
  }
  m = /^\/api\/leases\/([^/]+)\/revoke$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    const s = sessions.get(req);
    noParameters(await readBody(req));
    limited(actionRate, 'actions');
    let id;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      throw new HttpError(400, 'not a lease id');
    }
    leases.check(id);
    return exclusive('revoking a lease', async () => {
      const cid = randomUUID();
      const r = await call(s.token, 'PUT', ns(`sys/leases/revoke/${id}`), { correlationId: cid });
      // Already gone is what revoke wants: success, said so.
      const gone = !r.ok && r.status === 400 && /invalid lease|lease not found|not found/i.test(r.errors.join(' '));
      const ev = events.add({ what: 'revoked the booking app\'s lease', lease: id, by: s.user, correlation_id: cid, vault: vaultSaid(r), already_gone: gone });
      if (!r.ok && !gone) throw new HttpError(r.status === 403 ? 403 : 502, `Vault refused: ${r.errors.join('; ')}`);
      return { event: ev };
    });
  }
  return undefined;
}

const redact = createRedactor();
export const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  const url = new URL(req.url, 'http://api');
  const t0 = Date.now();
  // One JSON line per request: method, route, status, ms, correlation id;
  // never headers, bodies or tokens. The healthcheck stays quiet.
  res.on('finish', () => {
    if (url.pathname === '/api/healthz' && res.statusCode === 200) return;
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, route: url.pathname.replace(/\/api\/leases\/[^/]+/, '/api/leases/:id'), status: res.statusCode, ms: Date.now() - t0, error: res.errorText ? redact(String(res.errorText)) : undefined }));
  });
  if (session.crossSiteWrite(req)) return send(res, 403, { ok: false, error: 'refused: this request came from another site' });
  try {
    let out = await paramRoute(req, url);
    if (out === undefined) {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        const known = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`));
        return send(res, known ? 405 : 404, { ok: false, error: known ? 'method not allowed' : 'not found' });
      }
      out = await handler(req, res, url);
      if (out === null) return undefined; // the handler answered (a redirect)
    }
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    if (url.pathname.startsWith('/auth/') && !res.headersSent) {
      // The browser is mid sign-in: back to the console with the reason.
      res.writeHead(302, { Location: `/?signin=${encodeURIComponent(e.status ? e.message : 'the sign-in failed')}`, 'cache-control': 'no-store' });
      return res.end();
    }
    if (e instanceof session.Unauthenticated) return send(res, 401, { ok: false, error: e.message });
    if (e instanceof session.Refused || e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
    if (e instanceof VaultError) return send(res, e.status === 503 || e.status === 504 ? 503 : 502, { ok: false, error: e.message });
    console.error(JSON.stringify({ at: new Date().toISOString(), route: url.pathname, error: redact(String(e?.stack || e)).slice(0, 600) }));
    return send(res, 500, { ok: false, error: 'internal error' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => console.log(JSON.stringify({ at: new Date().toISOString(), msg: 'console api listening', port: PORT, vault: VAULT_NODES })));
  // make stage-reset: podman kill --signal USR2 vult-api clears the event list.
  process.on('SIGUSR2', () => events.clear());
  for (const sig of ['SIGTERM', 'SIGINT'])
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
}
