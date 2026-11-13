// lib/console.js: the console's guards (prompt 08, step 4). Pure functions:
// actions take only an allowlisted act number or a lease id the API itself
// listed; paths, mounts and destinations never come from a request.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Refused } from './session.js';

// The next act only: a wave refuses to run out of order (act.sh too).
export function actToRun(param, currentAct) {
  if (!/^[1-6]$/.test(String(param))) throw new Refused(404, 'no such act');
  const n = Number(param);
  if (n !== currentAct + 1) throw new Refused(409, `the lab is at act ${currentAct}: ${currentAct >= 6 ? 'every act has run (stage reset to start again)' : `run act ${currentAct + 1} next`}`);
  return n;
}

// A body must be empty: what an action does is decided here, not sent.
export function noParameters(body) {
  if (body && Object.keys(body).length) throw new Refused(400, 'this action takes no parameters');
}

// Lease ids the API listed (the booking app's current credential), for a
// while; only those may be revoked.
export function createLeaseList({ ttlMs = 600_000, now = Date.now } = {}) {
  const listed = new Map(); // id -> until
  return {
    remember(id) {
      // A lease issued in a namespace ends in .<namespace id> (measured).
      if (typeof id === 'string' && /^database\/creds\/booking\/[A-Za-z0-9]{8,64}(\.[A-Za-z0-9]{1,16})?$/.test(id)) listed.set(id, now() + ttlMs);
      return id;
    },
    check(id) {
      const until = listed.get(id);
      if (!until || now() > until) throw new Refused(403, 'only a lease this console listed can be revoked');
      return id;
    },
  };
}

// One-time confirmation for the stage reset: GET gives a token, POST spends it.
export function createConfirmations({ ttlMs = 120_000, now = Date.now } = {}) {
  let current = null;
  return {
    issue() {
      current = { token: randomBytes(16).toString('base64url'), until: now() + ttlMs };
      return current.token;
    },
    take(token) {
      const ok = current && typeof token === 'string' && token.length === current.token.length && now() <= current.until &&
        timingSafeEqual(Buffer.from(token), Buffer.from(current.token));
      current = null;
      if (!ok) throw new Refused(403, 'confirm the stage reset first (the confirmation is single use and lasts two minutes)');
    },
  };
}

// GitHub's own record is read on the host; older than the last change Vault
// made to the synced secret means it may not show that change yet.
export function githubStale(readAt, lastChangeAt) {
  if (!readAt) return { stale: true, why: 'no GitHub evidence yet (make github-evidence)' };
  if (lastChangeAt && Date.parse(readAt) < Date.parse(lastChangeAt)) return { stale: true, why: `read ${readAt}, before Vault's last change ${lastChangeAt}` };
  return { stale: false };
}
