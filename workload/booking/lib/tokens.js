// lib/tokens.js: verify Keycloak's RS256 tokens against its JWKS (fetched
// inside vult-internal over TLS, cached for 5 minutes), and constant-time
// comparison for static keys. Standard library only.
import { createPublicKey, verify as cverify, timingSafeEqual, createHash } from 'node:crypto';

const b64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function decode(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new Error('not a JWT');
  return { header: JSON.parse(b64u(parts[0])), claims: JSON.parse(b64u(parts[1])), signed: `${parts[0]}.${parts[1]}`, sig: b64u(parts[2]) };
}

export function jwksVerifier({ jwksUrl, issuer, fetchImpl = fetch, now = () => Date.now() / 1000 }) {
  let cache = { at: 0, keys: [] };
  async function keys(force = false) {
    // A forced refresh (an unknown kid) at most every 30 s: junk tokens must
    // not turn every request into a call to Keycloak.
    if (force && now() - cache.at < 30) return cache.keys;
    if (!force && now() - cache.at < 300 && cache.keys.length) return cache.keys;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try {
      const r = await fetchImpl(jwksUrl, { signal: ac.signal });
      if (!r.ok) throw new Error(`JWKS HTTP ${r.status}`);
      cache = { at: now(), keys: (await r.json()).keys || [] };
      return cache.keys;
    } finally {
      clearTimeout(t);
    }
  }
  return async function verifyJwt(jwt, { audience } = {}) {
    const { header, claims, signed, sig } = decode(jwt);
    if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);
    let jwk = (await keys()).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('unknown signing key');
    if (!cverify('RSA-SHA256', Buffer.from(signed), createPublicKey({ key: jwk, format: 'jwk' }), sig)) throw new Error('bad signature');
    if (claims.iss !== issuer) throw new Error('wrong issuer');
    const t = now();
    if (typeof claims.exp !== 'number' || claims.exp < t - 5) throw new Error('expired');
    if (audience) {
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.includes(audience)) throw new Error('wrong audience');
    }
    return claims;
  };
}

// equalSecret(a, b): constant time, also for different lengths.
export function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
