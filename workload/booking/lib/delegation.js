// lib/delegation.js: act 5 (D21, probe Q6). The booking app is the issuer of
// a delegation token for the signed-in clerk; Vault holds the signing key and
// decides every use.
//
//   issue(who, action, crossing)  an at+jwt for one permit (sub: the clerk,
//                                 act.sub: tide-agent), exp no later than
//                                 the clerk's own session, signed by Transit
//                                 key obo (not exportable) through Vault
//                                 Agent's API proxy, which adds the app's
//                                 own token: the app never holds a key
//   check(token)                  the token's claims (no trust yet), or null
//   authorize(p, action, crossing) Vault's answer to the token reading that
//                                 action's permit: 200, or the refusal
//                                 verbatim (the agent's ceiling, the RAR)
// The app enforces nothing itself for the agent: Vault's answer is the rule.
import { randomUUID } from 'node:crypto';
import { decode } from './tokens.js';

const VAULT = (process.env.VAULT_ADDR || 'https://vault-1:8200').replace(/\/$/, '');
const NS = process.env.VAULT_NAMESPACE || 'tidewell';
const PROXY = (process.env.VAULT_AGENT_PROXY || 'http://127.0.0.1:8100').replace(/\/$/, '');
export const ISSUER = process.env.OBO_ISSUER || 'https://localhost:14202';
export const AUDIENCE = process.env.OBO_AUDIENCE || 'https://vault.tidewell.example';
export const ACTOR = 'tide-agent';
const MAX_SECONDS = 300;
const ACTIONS = new Set(['rebook', 'cancel']);
const CROSSING = /^[a-z0-9-]{3,20}$/;

export const permitPath = (action, crossing) => {
  if (!ACTIONS.has(action) || !CROSSING.test(crossing)) throw Object.assign(new Error('no such permit'), { status: 400 });
  return `kv/data/permits/${action}/${crossing}`;
};

// who: {user, exp} (exp in seconds: the clerk's session or bearer token).
export function claimsFor(who, action, crossing, now = Math.floor(Date.now() / 1000), jti = randomUUID()) {
  if (!who?.user || !who.exp || who.exp <= now) throw Object.assign(new Error("the clerk's session has ended"), { status: 401 });
  return {
    iss: ISSUER, aud: AUDIENCE, sub: who.user, act: { sub: ACTOR }, jti, iat: now,
    exp: Math.min(who.exp, now + MAX_SECONDS),
    authorization_details: [{ type: 'vault:path_access', path: permitPath(action, crossing), capabilities: ['read'] }],
  };
}

// cid: X-Correlation-Id, which Vault's audit log records beside the request;
// the app logs the same id, so the two records join.
async function vault(method, url, { token, body, cid, timeoutMs = 8000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs); // referenced: AbortSignal.timeout was seen never to fire
  try {
    const r = await fetch(url, {
      method, signal: ac.signal,
      headers: { ...(token ? { 'X-Vault-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cid ? { 'X-Correlation-Id': cid } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await r.json().catch(() => null);
    const errors = (json?.errors || []).map((e) => String(e).replace(/\s+/g, ' ').trim());
    return { ok: r.ok, status: r.status, json, errors };
  } finally {
    clearTimeout(t);
  }
}

const b64u = (s) => Buffer.from(s).toString('base64url');

export async function issue(who, action, crossing, cid) {
  const signing = `${b64u(JSON.stringify({ alg: 'ES256', typ: 'at+jwt', kid: 'obo-1' }))}.${b64u(JSON.stringify(claimsFor(who, action, crossing)))}`;
  const r = await vault('POST', `${PROXY}/v1/${NS}/transit/sign/obo`, {
    cid,
    body: { input: Buffer.from(signing).toString('base64'), hash_algorithm: 'sha2-256', marshaling_algorithm: 'jws' },
  }).catch((e) => ({ ok: false, status: 503, errors: [`Vault Agent did not answer: ${e.message}`] }));
  if (!r.ok) throw Object.assign(new Error(`Vault did not sign the delegation: ${r.status} ${r.errors.join('; ')}`), { status: 502 });
  return `${signing}.${r.json.data.signature.replace(/^vault:v\d+:/, '')}`;
}

export function check(token, now = Date.now() / 1000) {
  let c;
  try {
    c = decode(token).claims;
  } catch {
    return null;
  }
  if (c.iss !== ISSUER || c.act?.sub !== ACTOR || !(c.exp > now)) return null;
  return { subject: c.sub, jti: c.jti, exp: c.exp, permits: (c.authorization_details || []).map((d) => d.path), token };
}

export async function authorize(p, action, crossing, cid) {
  const r = await vault('GET', `${VAULT}/v1/${NS}/${permitPath(action, crossing)}`, { token: p.token, cid })
    .catch((e) => ({ ok: false, status: 503, errors: [`Vault did not answer: ${e.message}`] }));
  return { ok: r.status === 200, answer: r.status === 200 ? `Vault 200: ${action} permit for ${crossing}` : `Vault ${r.status}: ${r.errors.join('; ') || 'refused'}` };
}
