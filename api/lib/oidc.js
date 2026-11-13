// lib/oidc.js: Saskia's sign-in to the console (D14): Keycloak's code flow
// with PKCE for the public client tidewell-console. The browser goes to
// Keycloak's public address; the code comes back to /auth/callback and is
// exchanged on vult-internal. The access token never reaches the browser:
// the API trades it for her Vault token at once (auth/jwt/login, role
// person) and keeps only that, server side.
import { randomBytes, createHash } from 'node:crypto';
import { Refused } from './session.js';

const b64u = (b) => Buffer.from(b).toString('base64url');

export function createOidc({ publicUrl, internalUrl, clientId = 'tidewell-console', redirectUri, fetcher = fetch, now = Date.now, ttlMs = 600_000 }) {
  const pending = new Map(); // state -> { verifier, until }
  return {
    start() {
      for (const [k, v] of pending) if (now() > v.until) pending.delete(k);
      if (pending.size > 100) throw new Refused(429, 'too many sign-ins in progress; try again in a few minutes');
      const state = b64u(randomBytes(16));
      const verifier = b64u(randomBytes(32));
      pending.set(state, { verifier, until: now() + ttlMs });
      const u = new URL(`${publicUrl}/protocol/openid-connect/auth`);
      u.search = new URLSearchParams({
        client_id: clientId, response_type: 'code', scope: 'openid', redirect_uri: redirectUri, state,
        code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      }).toString();
      return u.toString();
    },
    async finish(state, code) {
      const p = typeof state === 'string' && pending.get(state);
      pending.delete(state);
      if (!p || now() > p.until) throw new Refused(400, 'the sign-in expired; start again');
      if (typeof code !== 'string' || !code || code.length > 2048) throw new Refused(400, 'Keycloak sent no code');
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      try {
        const r = await fetcher(`${internalUrl}/protocol/openid-connect/token`, {
          method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: p.verifier }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) throw new Refused(401, `Keycloak refused the sign-in: ${j.error || r.status}`);
        return j.access_token;
      } finally {
        clearTimeout(t);
      }
    },
    pendingCount: () => pending.size,
  };
}
