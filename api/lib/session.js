// lib/session.js: the presenter's session (D13).
//
// The presenter signs in on the console's own form as saskia. The API logs her
// in through userpass in namespace tidewell and keeps the Vault token server
// side; the browser holds only an opaque cookie (HttpOnly, Secure,
// SameSite=Strict). Her token is the only one the API uses: every act runs
// as her. Sign-out is POST only and revokes the token. Passwords are never
// logged or stored here.
import { randomBytes } from "node:crypto";
import { call, ns } from "./vault.js";

export const COOKIE = "vult_sid";
// The console's origins: both loopback spellings of its port (the certificate
// names both), comma separated in CONSOLE_URL.
export const CONSOLE_URLS = (process.env.CONSOLE_URL || "https://localhost:14201,https://127.0.0.1:14201")
  .split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);
const IDLE_MS = Number(process.env.SESSION_IDLE_SECONDS || 14400) * 1000;
export const REQUESTOR = process.env.CONSOLE_USER || "saskia";

export class Unauthenticated extends Error {}
export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const randomId = () => randomBytes(32).toString("base64url");

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!(k in out)) {
      try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* a broken cookie is no cookie */ }
    }
  }
  return out;
}

export const sessionCookie = (id, maxAgeSeconds) =>
  `${COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;

// Every https://localhost:<port> is the same site, so a write from another
// local app would still carry a SameSite cookie. Browsers name the origin of
// a request in Sec-Fetch-Site and Origin: a write from anywhere but this
// console is refused before it can act on Saskia's behalf.
export function crossSiteWrite(req, consoleUrls = CONSOLE_URLS) {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.origin;
  return Boolean(origin) && !consoleUrls.includes(origin);
}

// createSessions({ login, revoke, now }): the store. login(user, password)
// -> a Vault call result; revoke(token).
export function createSessions({ login, revoke, now = () => Date.now(), idleMs = IDLE_MS } = {}) {
  const sessions = new Map(); // sid -> { user, token, exp, seen, entity, policies }
  setInterval(() => {
    for (const [k, v] of sessions) if (now() - v.seen > idleMs || v.exp < now()) sessions.delete(k);
  }, 60_000).unref();

  return {
    async signIn(username, password) {
      if (username !== REQUESTOR) throw new Refused(403, `only ${REQUESTOR} signs in to the console`);
      const r = await login(username, password);
      if (!r.ok) throw new Refused(r.status === 400 ? 401 : r.status, r.errors[0] || "Vault refused the sign-in");
      const a = r.json.auth;
      const sid = randomId();
      sessions.set(sid, { user: username, token: a.client_token, exp: now() + a.lease_duration * 1000, seen: now(), entity: a.entity_id, policies: a.token_policies });
      return { sid, maxAge: a.lease_duration };
    },
    get(req) {
      const sid = parseCookies(req.headers.cookie)[COOKIE];
      const s = sid && sessions.get(sid);
      if (!s) throw new Unauthenticated(`sign in as ${REQUESTOR} first`);
      if (s.exp <= now() || now() - s.seen > idleMs) {
        sessions.delete(sid);
        throw new Unauthenticated("the session ended; sign in again");
      }
      s.seen = now();
      return s;
    },
    async signOut(req) {
      const sid = parseCookies(req.headers.cookie)[COOKIE];
      const s = sid && sessions.get(sid);
      if (!s) return false;
      sessions.delete(sid);
      // A token that outlives its sign-out must leave a trace (never the token).
      const r = await revoke(s.token).catch((e) => ({ ok: false, status: e.status || 503, errors: [e.message] }));
      if (!r?.ok) console.error(JSON.stringify({ at: new Date().toISOString(), signout_revoke: "failed", status: r?.status ?? null, error: r?.errors?.[0] ?? null }));
      return true;
    },
    size: () => sessions.size,
  };
}

// The real login and revoke (userpass in tidewell).
export const vaultLogin = (user, password) =>
  call(null, "POST", ns(`auth/userpass/login/${encodeURIComponent(user)}`), { body: { password } });
export const vaultRevoke = (token) => call(token, "POST", ns("auth/token/revoke-self"));
