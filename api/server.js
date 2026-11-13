// vault-sync-api: the presenter's desk for the Tidewell Ferries console (prompt 05).
// Plain node:http, no dependencies (D14). It runs the story's steps as the
// signed-in presenter (her own Vault token, D13) against Vault and
// LocalStack, and shows what each place holds. It never returns a value, a
// token or a key; values are fingerprints (D16).
//
//   GET  /api/healthz              the process (no session)
//   POST /api/session              sign in as saskia (userpass)
//   POST /api/session/end          sign out, revoke her token
//   GET  /api/session              who is signed in
//   GET  /api/story                the acts, the legacy secrets (names), the busy step
//   POST /api/acts/:act/:step      one step (empty body; config/story.json decides)
//   GET  /api/sync                 both destinations and their associations
//   GET  /api/sources              each secret in LocalStack, Vault, the copy and GitHub
//   GET  /api/events               the last 200 steps, newest first
//   GET  /api/status               Vault nodes, LocalStack, the GitHub evidence file
import http from "node:http";
import { readFileSync } from "node:fs";
import { call, ns, VaultError, VAULT_NODES, nodeHealth, activeAddr } from "./lib/vault.js";
import * as session from "./lib/session.js";
import { createRate } from "./lib/rate.js";
import { createLocalStack } from "./lib/localstack.js";
import { importConfig, runImport } from "./lib/importer.js";
import { createStory, createEvents, readEvidence, StoryError, STEPS, DESTINATIONS, githubName, copyName } from "./lib/story.js";

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 16 * 1024;
const NAMESPACE = process.env.VULT_NAMESPACE || "tidewell";
const EVIDENCE_FILE = process.env.GITHUB_EVIDENCE_FILE || "/evidence/github/evidence.json";
// config/story.json without the legacy values (scripts/app-build.sh strips them).
const story = JSON.parse(readFileSync(process.env.STORY_FILE || "/app/config/story.json", "utf8"));
const signInRate = createRate({ max: 10, windowMs: 60_000 });
const stepRate = createRate({ max: 30, windowMs: 60_000 });
const sessions = session.createSessions({ login: session.vaultLogin, revoke: session.vaultRevoke });
const localstack = createLocalStack();
const events = createEvents(200);
// The import's destination is the node the API talks to (Import accepts a
// private address, probe P19).
const runner = createStory({
  story, call, ns, localstack, events,
  importer: { run: runImport, config: (o) => importConfig({ ...o, namespace: NAMESPACE }) },
  vaultAddr: activeAddr,
  evidenceFile: EVIDENCE_FILE,
  localstackIp: process.env.VULT_LOCALSTACK_IP || "10.89.28.50",
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, code, obj) {
  if (code >= 500) res.errorText = obj.error; // for the request log line
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(400, "request body too large");
    chunks.push(c);
  }
  if (!size) return {};
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error();
    return b;
  } catch {
    throw new HttpError(400, "the body must be a JSON object");
  }
}

const routes = {
  "GET /api/healthz": async () => ({ story: story.legacy.length }),

  "POST /api/session": async (req, res) => {
    const t = signInRate.take(req.socket.remoteAddress || "?");
    if (!t.ok) throw new HttpError(429, `too many sign-in attempts; wait ${Math.ceil(t.retryAfterMs / 1000)} s`);
    const b = await readBody(req);
    if (typeof b.username !== "string" || typeof b.password !== "string" || !b.password || b.password.length > 256)
      throw new HttpError(400, "username and password, please");
    const user = b.username.trim().toLowerCase();
    const { sid, maxAge } = await sessions.signIn(user, b.password);
    res.setHeader("set-cookie", session.sessionCookie(sid, maxAge));
    return { signedIn: user };
  },
  "POST /api/session/end": async (req, res) => {
    const was = await sessions.signOut(req);
    res.setHeader("set-cookie", session.sessionCookie("", 0));
    return { signedOut: was };
  },
  "GET /api/session": async (req) => {
    const s = sessions.get(req);
    return { user: s.user, display: story.presenter.display, entity_id: s.entity, policies: s.policies };
  },

  "GET /api/story": async (req) => {
    sessions.get(req);
    return {
      company: story.company,
      presenter: story.presenter,
      steps: STEPS,
      destinations: DESTINATIONS,
      sync: story.sync,
      rotate: story.rotate,
      legacy: story.legacy.map((l) => ({ aws_name: l.aws_name, kv_name: l.kv_name, labels: l.labels, github_name: githubName(l.kv_name), copy_name: copyName(l.kv_name) })),
      busy: runner.busy(),
    };
  },
  "GET /api/sync": async (req) => ({ destinations: await runner.sync(sessions.get(req)) }),
  "GET /api/sources": async (req) => {
    return await runner.sources(sessions.get(req));
  },
  "GET /api/events": async (req) => {
    sessions.get(req);
    return { events: events.list() };
  },
  "GET /api/status": async (req) => {
    sessions.get(req);
    const [nodes, ls, evidence] = await Promise.all([Promise.all(VAULT_NODES.map(nodeHealth)), localstack.health(), readEvidence(EVIDENCE_FILE)]);
    return { nodes, localstack: ls, github_evidence: { read_at: evidence.read_at, missing: evidence.missing || null, secrets: Object.keys(evidence.secrets).length } };
  },
};

export const server = http.createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  const url = new URL(req.url, "http://api");
  const t0 = Date.now();
  // One JSON line per request: never headers, bodies or tokens. Quiet polls.
  res.on("finish", () => {
    if (req.method === "GET" && res.statusCode < 400) return;
    console.log(JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - t0, correlation_id: res.correlationId || null, error: res.errorText || undefined }));
  });
  if (session.crossSiteWrite(req)) return send(res, 403, { ok: false, error: "refused: this request came from another site" });
  try {
    let out;
    const m = /^\/api\/acts\/([a-z]+)\/([a-z]+)$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const s = sessions.get(req);
      if (!stepRate.take("steps").ok) throw new HttpError(429, "too many steps in a minute");
      // Secret, destination and paths come from config/story.json only.
      if (Object.keys(await readBody(req)).length) throw new HttpError(400, "a step takes no parameters; config/story.json defines them");
      const event = await runner.run(s, m[1], m[2]);
      res.correlationId = event.id;
      out = { event };
    } else {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        const known = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`)) || Boolean(m);
        return send(res, known ? 405 : 404, { ok: false, error: known ? "method not allowed" : "not found" });
      }
      out = await handler(req, res, url);
    }
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    if (e instanceof session.Unauthenticated) return send(res, 401, { ok: false, error: e.message });
    if (e instanceof session.Refused || e instanceof HttpError || e instanceof StoryError) return send(res, e.status, { ok: false, error: e.message });
    if (e instanceof VaultError) return send(res, 502, { ok: false, error: e.message });
    if (e?.status === 502) return send(res, 502, { ok: false, error: e.message });
    console.error(`[sync-api] ${req.method} ${url.pathname}:`, e?.stack || e);
    return send(res, 500, { ok: false, error: "internal error" });
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => console.log(`[sync-api] listening on :${PORT}, Vault ${VAULT_NODES.join(" ")}`));
  // make stage-reset: podman kill --signal USR2 vult-api clears the event list.
  process.on("SIGUSR2", () => {
    events.clear();
    console.log(JSON.stringify({ at: new Date().toISOString(), events: "cleared" }));
  });
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
}
