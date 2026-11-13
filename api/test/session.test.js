import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessions, crossSiteWrite, parseCookies, sessionCookie, tokenUser, Refused, Unauthenticated, COOKIE } from "../lib/session.js";

// Vault's answer to auth/jwt/login (role person): the policy comes from the
// external group platform.
// Measured: no display_name in the answer; the user comes from the token.
const ok = (lease = 3600, who = "saskia", identity = ["vult-presenter"]) => ({ ok: true, status: 200, json: { auth: { client_token: `tok-${who}`, lease_duration: lease, entity_id: "e1", metadata: { role: "person" }, token_policies: ["default"], identity_policies: identity } }, errors: [] });
const userOf = (r) => r.json?.auth?.client_token?.replace(/^tok-/, "");
const req = (cookie, extra = {}) => ({ headers: { cookie, ...extra }, method: "GET" });

test("only saskia with vult-presenter gets a session; anyone else's token is revoked at once", async () => {
  const revoked = [];
  const s = createSessions({ revoke: async (t) => revoked.push(t) });
  await assert.rejects(s.signIn(ok(3600, "teun", []), userOf(ok(3600, "teun", []))), (e) => e instanceof Refused && e.status === 403);
  await assert.rejects(s.signIn(ok(3600, "mallory"), userOf(ok(3600, "mallory"))), (e) => e instanceof Refused && e.status === 403);
  assert.deepEqual(revoked, ["tok-teun", "tok-mallory"]);
});

test("a refused login is Vault's answer, as 401", async () => {
  const s = createSessions({ revoke: async () => {} });
  await assert.rejects(s.signIn({ ok: false, status: 400, errors: ["error validating token: token is expired"] }), (e) => e.status === 401 && /expired/.test(e.message));
});

test("the session holds the token server side; the cookie only an id", async () => {
  const s = createSessions({ revoke: async () => {} });
  const { sid } = await s.signIn(ok(), userOf(ok()));
  assert.ok(!sid.includes("tok-saskia"));
  const got = s.get(req(`${COOKIE}=${sid}`));
  assert.equal(got.token, "tok-saskia");
  assert.equal(got.user, "saskia");
});

test("idle sessions and expired tokens end", async () => {
  let t = 0;
  const s = createSessions({ revoke: async () => {}, now: () => t, idleMs: 5_000 });
  const { sid } = await s.signIn(ok(10), userOf(ok(10)));
  t = 6_000;
  assert.throws(() => s.get(req(`${COOKIE}=${sid}`)), Unauthenticated);
  const b = await s.signIn(ok(10), userOf(ok(10)));
  t = 17_000;
  assert.throws(() => s.get(req(`${COOKIE}=${b.sid}`)), Unauthenticated);
});

test("sign-out revokes the token", async () => {
  const revoked = [];
  const s = createSessions({ revoke: async (t) => revoked.push(t) });
  const { sid } = await s.signIn(ok(), userOf(ok()));
  assert.equal(await s.signOut(req(`${COOKIE}=${sid}`)), true);
  assert.deepEqual(revoked, ["tok-saskia"]);
  assert.throws(() => s.get(req(`${COOKIE}=${sid}`)), Unauthenticated);
});

test("the cookie is HttpOnly, Secure and SameSite=Strict", () => {
  const c = sessionCookie("abc", 60);
  for (const part of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(c.includes(part), part);
});

test("a write from another site or origin is refused; reads and same-origin writes pass", () => {
  const w = (h) => ({ method: "POST", headers: h });
  assert.equal(crossSiteWrite(w({ "sec-fetch-site": "same-site" })), true);
  const own = ["https://localhost:14201", "https://127.0.0.1:14201"];
  assert.equal(crossSiteWrite(w({ origin: "https://localhost:13701" }), own), true);
  assert.equal(crossSiteWrite(w({ "sec-fetch-site": "same-origin", origin: "https://localhost:14201" }), own), false);
  assert.equal(crossSiteWrite(w({ "sec-fetch-site": "same-origin", origin: "https://127.0.0.1:14201" }), own), false, "the IP spelling is the same console");
  assert.equal(crossSiteWrite({ method: "GET", headers: { "sec-fetch-site": "cross-site" } }), false);
});

test("parseCookies keeps the first value and survives a broken one", () => {
  assert.deepEqual(parseCookies("a=1; a=2; b=%E0%A4%A"), { a: "1" });
});

test("a refused revoke at sign-out is logged, never with the token", async (t) => {
  const lines = [];
  t.mock.method(console, "error", (l) => lines.push(l));
  const s = createSessions({ revoke: async () => ({ ok: false, status: 403, errors: ["permission denied"] }) });
  const { sid } = await s.signIn(ok(), userOf(ok()));
  assert.equal(await s.signOut(req(`${COOKIE}=${sid}`)), true);
  assert.match(lines.join(), /"signout_revoke":"failed","status":403/);
  assert.ok(!lines.join().includes("tok-saskia"));
});

test("the user comes from the access token Vault accepted; garbage names nobody", () => {
  const jwt = `x.${Buffer.from(JSON.stringify({ preferred_username: "saskia" })).toString("base64url")}.y`;
  assert.equal(tokenUser(jwt), "saskia");
  assert.equal(tokenUser("not-a-jwt"), null);
});
