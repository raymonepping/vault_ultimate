// lib/witness.js: a credential lifecycle audit (D4, reframed 2026-11-13).
// For every config/inventory.json credential one real try against its
// target, with the lab's own record of it (the files the lab generated, never
// a value from anywhere else), and what the targets say about its lifetime:
// PostgreSQL's VALID UNTIL, the certificate's notAfter and OCSP status, the
// lease's TTL. Each answer is kept verbatim with its time and the value's
// fingerprint (first 8 hex of SHA-256); a value never leaves memory.
//
//   witness(ctx) -> { at, act, credentials[], copies[], extras[], standing, unmanaged, longest }
//
// ctx names where things are (files, the Vault token) so the API, make
// witness and the tests can each give their own. Every try has a deadline
// and turns any failure into an answer: the witness never throws for a
// refusal or an unreachable target.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';
import { call, ns, activeAddr, fetchWithTimeout } from './vault.js';
import { createLocalStack, fp } from './localstack.js';
import { ocspRequest, ocspStatus, ldapBind, ldapBindResult } from './der.js';
import { summarise } from './scoreboard.js';

const DEADLINE_MS = 8_000;
const readText = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const now = () => new Date().toISOString();
const msg = (e) => String(e?.message || e).replace(/\s+/g, ' ').trim();
// A target that did not answer says nothing about the credential: unknown
// (works null), never "refused" (prompt 08).
const NET = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|EAI_AGAIN|no answer within|timed out|did not answer|Connection terminated unexpectedly|fetch failed/i;
export const failure = (e, tried) => (NET.test(`${e?.code || ''} ${e?.cause?.code || ''} ${msg(e)}`)
  ? { works: null, tried, answer: `unknown, the target did not answer: ${msg(e)}`, lifetime: null }
  : { works: false, tried, answer: msg(e), lifetime: null });

function within(ms, p, what) {
  let t;
  return Promise.race([p, new Promise((_, no) => (t = setTimeout(() => no(new Error(`${what}: no answer within ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

// KEY=VALUE lines (the before estate's .env files).
export function envValue(text, key) {
  const line = (text || '').split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : null;
}

// ── One try per test kind ───────────────────────────────────────────────────
// Each returns { works, answer, lifetime: {never} | {until} | null, tried }.

async function postgresLogin(c, secret) {
  const client = new pg.Client({
    host: c.pgHost, port: 5432, database: 'tidewell', user: 'booking_app', password: secret,
    ssl: { ca: c.ca, servername: c.pgHost }, connectionTimeoutMillis: DEADLINE_MS, query_timeout: DEADLINE_MS,
  });
  client.on('error', () => {}); // a terminated session must not crash the witness
  const tried = 'PostgreSQL login as booking_app (TLS verify-full), then a query held on that session';
  try {
    await client.connect();
    const r = await client.query(`select current_user as who, rolvaliduntil::text as valid_until from pg_roles where rolname = current_user`);
    const v = r.rows[0]?.valid_until ?? null;
    const never = v === null || v === 'infinity';
    return { works: true, tried, answer: `logged in as ${r.rows[0].who}; VALID UNTIL ${v ?? 'not set'}`, lifetime: never ? { never: true, source: 'pg_roles.rolvaliduntil' } : { until: new Date(v).toISOString(), source: 'pg_roles.rolvaliduntil' } };
  } catch (e) {
    return failure(e, tried);
  } finally {
    await client.end().catch(() => {});
  }
}

function ldapBindTry(c, dn, secret) {
  const tried = `LDAP simple bind as ${dn}`;
  return within(DEADLINE_MS, new Promise((resolve) => {
    const s = net.connect(389, c.ldapHost);
    let buf = Buffer.alloc(0);
    s.on('connect', () => s.write(ldapBind(dn, secret)));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const r = ldapBindResult(buf);
        if (!r) return;
        s.destroy();
        const works = r.code === 0;
        resolve({ works, tried, answer: works ? 'bind succeeded (0)' : `${r.code === 49 ? 'Invalid credentials' : 'bind refused'} (${r.code})${r.diagnostic ? `: ${r.diagnostic}` : ''}`, lifetime: works ? { never: true, source: 'no rotation configured' } : null });
      } catch (e) {
        s.destroy();
        resolve({ works: false, tried, answer: msg(e), lifetime: null });
      }
    });
    s.on('error', (e) => resolve(failure(e, tried)));
  }), 'LDAP').catch((e) => failure(e, tried));
}

async function oidcClientCredentials(c, secret) {
  const tried = 'Keycloak client_credentials grant as tidewell-booking with the client secret';
  try {
    const { res, text } = await fetchWithTimeout(`${c.keycloak}/protocol/openid-connect/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'tidewell-booking', client_secret: secret }),
    }, DEADLINE_MS, 'Keycloak');
    const j = JSON.parse(text || '{}');
    // invalid_client is the secret refused; anything else means Keycloak
    // authenticated the client (a client without a service account answers
    // unauthorized_client after authenticating it).
    const works = res.ok || (j.error && j.error !== 'invalid_client');
    return { works, tried, answer: res.ok ? `${res.status}: token issued` : `${res.status} ${j.error}${j.error_description ? `: ${j.error_description}` : ''}`, lifetime: works ? { never: true, source: 'Keycloak client secrets do not expire' } : null };
  } catch (e) {
    return failure(e, tried);
  }
}

async function bookingCall(c, method, path, headers, tried, judge) {
  try {
    const { res, text } = await fetchWithTimeout(`${c.booking}${path}`, { method, headers }, DEADLINE_MS, 'booking');
    const j = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const works = judge(res, j);
    return { works, tried, answer: `${res.status} ${text ? text.slice(0, 160) : '(no body)'}`, lifetime: works ? { never: true, source: 'a static value, never rotated' } : null };
  } catch (e) {
    return failure(e, tried);
  }
}

async function ocspOf(pem, issuerPem) {
  const leaf = new X509Certificate(pem);
  const issuer = new X509Certificate(issuerPem);
  const req = ocspRequest(leaf.raw, issuer.publicKey.export({ type: 'spki', format: 'der' }));
  const addr = await activeAddr();
  const r = await within(DEADLINE_MS, fetch(`${addr}/v1/${ns('pki/ocsp')}`, { method: 'POST', headers: { 'Content-Type': 'application/ocsp-request' }, body: req }), 'OCSP');
  return ocspStatus(Buffer.from(await r.arrayBuffer()));
}

const certs = (bundle) => (bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []);

// The year-long pair: a handshake with it (a throwaway server in this
// process, verified against the lab CA), then Vault's OCSP answer for it.
async function tlsHandshakeOcsp(c, certPem, keyPem) {
  const tried = 'TLS handshake with the year-long certificate and key (chain verified against the lab CA), then OCSP at Vault (pki/ocsp)';
  if (!certPem || !keyPem) return { works: false, tried, answer: 'the year-long certificate or key is not in the lab record', lifetime: null };
  const [leafPem, issuerPem] = certs(certPem);
  const leaf = new X509Certificate(leafPem);
  let hand;
  try {
    const srv = tls.createServer({ cert: certPem, key: keyPem });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    try {
      hand = await within(DEADLINE_MS, new Promise((resolve, reject) => {
        const s = tls.connect({ port: srv.address().port, host: '127.0.0.1', servername: 'booking', ca: c.ca }, () => { s.end(); resolve('handshake ok, chain verifies'); });
        s.on('error', reject);
      }), 'handshake');
    } finally {
      srv.close();
    }
  } catch (e) {
    return { works: false, tried, answer: `handshake failed: ${msg(e)}`, lifetime: null };
  }
  let o;
  try {
    o = await ocspOf(leafPem, issuerPem);
  } catch (e) {
    return { works: null, tried, answer: `unknown: ${hand}; OCSP not answered: ${msg(e)}`, lifetime: null };
  }
  const until = new Date(leaf.validTo).toISOString();
  const works = o.status === 'good' && Date.parse(until) > Date.now();
  return {
    works, tried, serial: leaf.serialNumber.toLowerCase(),
    answer: `${hand}; OCSP Cert Status: ${o.status}${o.revoked_at ? ` (revoked ${o.revoked_at})` : ''}; notAfter ${until}`,
    lifetime: works ? { until, source: 'certificate notAfter' } : null,
  };
}

// What the booking site serves right now (not an inventory item: evidence of
// what replaced the year-long certificate).
async function servedCertificate(c) {
  try {
    const peer = await within(DEADLINE_MS, new Promise((resolve, reject) => {
      const s = tls.connect({ port: 8443, host: c.bookingHost, servername: 'booking', ca: c.ca }, () => { const p = s.getPeerX509Certificate(); s.end(); resolve(p); });
      s.on('error', reject);
    }), 'booking TLS');
    return { serial: peer.serialNumber.toLowerCase(), not_after: new Date(peer.validTo).toISOString(), lifetime_seconds: Math.round((Date.parse(peer.validTo) - Date.parse(peer.validFrom)) / 1000) };
  } catch (e) {
    return { error: msg(e) };
  }
}

// The leases that replaced the static database password (act 2 on).
async function bookingLeases(c) {
  const l = await call(c.token, 'LIST', ns('sys/leases/lookup/database/creds/booking/')).catch((e) => ({ ok: false, status: 503, errors: [msg(e)] }));
  if (!l.ok) return { count: 0, answer: l.status === 404 ? 'no leases' : `${l.status} ${l.errors.join('; ')}` };
  const out = [];
  for (const k of l.json?.data?.keys || []) {
    const r = await call(c.token, 'POST', ns('sys/leases/lookup'), { body: { lease_id: `database/creds/booking/${k}` } });
    if (r.ok) out.push({ lease: `database/creds/booking/${k.slice(0, 8)}...`, ttl: r.json.data.ttl, expire_time: r.json.data.expire_time, renewable: r.json.data.renewable });
  }
  return { count: out.length, longest_ttl: out.reduce((m, x) => Math.max(m, x.ttl), 0) || null, leases: out };
}

async function secretZero(c) {
  const t = readText(c.files.wrappedSecretId)?.trim();
  const tried = 'sys/wrapping/lookup of the response-wrapped secret id Ansible delivered';
  if (!t) return { id: 'secret-zero', label: "The booking app's wrapped AppRole secret id (D9)", works: false, tried, answer: 'not delivered (before act 2)', fingerprint: null, at: now() };
  const r = await call(c.token, 'POST', 'sys/wrapping/lookup', { body: { token: t } }).catch((e) => ({ ok: false, status: 503, errors: [msg(e)] }));
  return { id: 'secret-zero', label: "The booking app's wrapped AppRole secret id (D9)", works: r.ok, tried, answer: r.ok ? `200: still unwrappable (TTL ${r.json.data.creation_ttl}s, created ${r.json.data.creation_time})` : `${r.status} ${r.errors.join('; ')}`, fingerprint: fp(t), at: now() };
}

// ── Copies: managed when a Sync association keeps them current ──────────────
async function associations(c, dest) {
  const r = await call(c.token, 'GET', ns(`sys/sync/destinations/${dest}/associations`)).catch(() => ({ ok: false }));
  return r.ok ? Object.values(r.json?.data?.associated_secrets || {}) : [];
}

async function copies(c, inventory, story, byId) {
  const ls = createLocalStack({ url: c.localstack });
  const gh = JSON.parse(readText(c.files.githubEvidence) || '{"secrets": []}');
  const assoc = { gh: await associations(c, 'gh/tidewell-github'), aws: await associations(c, 'aws-sm/tidewell-localstack') };
  const synced = (list) => list.find((a) => a.mount === 'kv' && a.secret_name === story.deploy.kv_name);
  const out = [];
  for (const cp of inventory.copies) {
    const holds = byId[cp.holds];
    const row = { id: cp.id, holds: cp.holds, at: now() };
    if (cp.id === 'booking.env') {
      const has = !!envValue(readText(c.files.bookingEnv), 'DB_PASSWORD');
      Object.assign(row, { exists: has, managed: false, answer: has ? 'booking.env holds DB_PASSWORD' : 'booking.env holds no database password' });
    } else if (cp.id === 'github-actions-secret') {
      const s = gh.secrets.find((x) => x.name === story.deploy.github_name);
      const a = synced(assoc.gh);
      Object.assign(row, { exists: !!s, managed: !!a, answer: `${s ? `GitHub lists ${s.name}, updated ${s.updated_at} (read ${gh.read_at})` : `GitHub does not list ${story.deploy.github_name}${gh.read_at ? ` (read ${gh.read_at})` : ' (no GitHub evidence yet: make github-evidence)'}`}; ${a ? `Vault syncs it (${a.sync_status}, ${a.updated_at})` : 'no Vault association'}` });
    } else {
      const name = cp.id === 'localstack-copy' ? story.deploy.aws_name : story.legacy.find((l) => l.kv_name === cp.holds)?.aws_name;
      const d = await ls.describe(name).catch((e) => ({ error: msg(e) }));
      const a = cp.id === 'localstack-copy' ? synced(assoc.aws) : null;
      const has = !!d && !d.error && !d.deleted;
      const where = d?.error ? `LocalStack did not answer: ${d.error}` : has ? `LocalStack has ${name}${Object.hasOwn(d.tags, 'hashicorp:vault') ? ' (tag hashicorp:vault)' : ''}, changed ${d.changed}` : `LocalStack has no ${name}`;
      // Vault tags its copy hashicorp:vault with an empty value (measured).
      // Unreachable is not "gone": the copy counts until LocalStack says so.
      Object.assign(row, { exists: has || !!d?.error, managed: !!a, answer: `${where}${a ? `; Vault syncs it (${a.sync_status}, ${a.updated_at})` : ''}` });
    }
    // A copy is unmanaged while it exists, Vault does not keep it current,
    // and what it holds still works (a legacy value is not tried: it counts
    // while it exists).
    row.unmanaged = row.exists && !row.managed && (holds ? holds.works !== false : true);
    out.push(row);
  }
  return out;
}

// ── The run ─────────────────────────────────────────────────────────────────
export async function witness(c) {
  const inventory = JSON.parse(readText(c.files.inventory));
  const story = JSON.parse(readText(c.files.story));
  const bookingEnv = readText(c.files.bookingEnv);
  const agentEnv = readText(c.files.agentEnv);
  const secretOf = {
    'booking-db-password': () => readText(c.files.dbPassword)?.trim(),
    'booking-tls-key': () => readText(c.files.tlsCert),
    'keycloak-ldap-bind': () => readText(c.files.ldapBind)?.trim(),
    'booking-oidc-client-secret': () => readText(c.files.oidcSecret)?.trim(),
    'tide-agent-api-key': () => readText(c.files.agentKey)?.trim(),
    'ci-deploy-token': () => readText(c.files.deployToken)?.trim(),
  };
  const tries = {
    'postgres-login': (s) => postgresLogin(c, s),
    'tls-handshake-ocsp': (s) => tlsHandshakeOcsp(c, s, readText(c.files.tlsKey)),
    'ldap-bind': (s) => ldapBindTry(c, 'cn=keycloak-bind,ou=system,dc=tidewell,dc=lab', s),
    'oidc-client-credentials': (s) => oidcClientCredentials(c, s),
    'booking-api-call': (s) => bookingCall(c, 'GET', '/api/me', { 'X-Agent-Key': s }, 'booking API GET /api/me with X-Agent-Key', (res, j) => res.ok && j?.user === 'tide-agent' && j?.via === 'static-key'),
    'booking-deploy-check': (s) => bookingCall(c, 'POST', '/api/deploy/check', { 'X-Deploy-Token': s }, "booking app's deploy check with X-Deploy-Token", (res) => res.status === 204),
  };
  const rows = [];
  for (const item of inventory.credentials) {
    const value = secretOf[item.id]?.();
    const base = { id: item.id, label: item.label, kind: item.kind, test: item.test, residual: item.residual, residual_reason: item.residual_reason ?? null, removed_by_act: item.removed_by_act };
    if (!value) {
      rows.push({ ...base, works: false, tried: item.test, answer: 'no value in the lab record', fingerprint: null, lifetime: null, at: now() });
      continue;
    }
    const r = await tries[item.test](value).catch((e) => failure(e, item.test));
    rows.push({ ...base, ...r, fingerprint: fp(value), at: now() });
  }
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  // The residual after a rotation (act 6): the before estate's value is the
  // inventory row; the value Vault holds now (and syncs to every copy) is
  // tried too and reported beside it, so the residual stays visible.
  const dep = byId['ci-deploy-token'];
  const kv = await call(c.token, 'GET', ns(`kv/data/${story.deploy.kv_name}`)).catch(() => ({ ok: false }));
  const now_ = kv.ok ? kv.json?.data?.data?.value : null;
  if (dep && now_ && fp(now_) !== dep.fingerprint) {
    const r = await tries['booking-deploy-check'](now_);
    dep.current = { fingerprint: fp(now_), works: r.works, answer: r.answer, source: `Vault kv ${story.deploy.kv_name} v${kv.json.data.metadata.version}`, at: now() };
  }
  // Where the before estate still points: the .env files the apps read.
  byId['booking-db-password'].in_estate_file = !!envValue(bookingEnv, 'DB_PASSWORD');
  byId['tide-agent-api-key'].in_estate_file = !!envValue(agentEnv, 'AGENT_API_KEY');
  // What replaced a refused credential, with the lifetime its target reports.
  const leases = await bookingLeases(c);
  const lastLease = (leases.leases || []).map((l) => l.expire_time).sort().at(-1);
  if (lastLease && !byId['booking-db-password'].works) leases.lifetime = { until: new Date(lastLease).toISOString(), source: 'Vault lease expire_time (database/creds/booking)' };
  byId['booking-db-password'].replaced_by = leases;
  const served = await servedCertificate(c);
  const year = byId['booking-tls-key'];
  const tlsReplaced = { served };
  if (served.serial && served.serial !== year.serial && !year.works) tlsReplaced.lifetime = { until: served.not_after, source: 'the certificate the site serves (notAfter)' };
  year.replaced_by = tlsReplaced;
  const extras = [await secretZero(c)];
  const cps = await copies(c, inventory, story, byId);
  return { at: now(), act: c.act, credentials: rows, copies: cps, extras, ...summarise({ credentials: rows, copies: cps }) };
}
