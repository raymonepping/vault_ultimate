// server.js: tide-agent, Tidewell's AI agent (fictional). Not published:
// only the booking app reaches it on vult-internal.
//
//   POST /ask {text}  map the request onto one allowlisted action with
//                     Ollama, then do it through the booking API.
// Before act 5 the agent acts with its own static key (AGENT_API_KEY), for
// whoever asked: the before estate's problem. From act 5 the booking app
// hands it a delegation token for the clerk (Authorization: Bearer), and the
// agent can do only what that token allows.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prompt, validate } from './lib/plan.js';
import { call } from './lib/http.js';

const PORT = Number(process.env.PORT || 8080);
const BOOKING = process.env.BOOKING_URL || 'https://booking:8443';
const OLLAMA = process.env.OLLAMA_URL || 'http://ollama:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';
const OLLAMA_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20000);
const ENV_FILE = process.env.AGENT_ENV_FILE || '/run/agent/tide-agent.env';
const log = (o) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));

function staticKey() {
  try {
    const line = readFileSync(ENV_FILE, 'utf8').split('\n').find((l) => l.startsWith('AGENT_API_KEY='));
    return line ? line.slice('AGENT_API_KEY='.length).trim() || null : null;
  } catch {
    return null;
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 8192) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw Object.assign(new Error('body is not JSON'), { status: 400 });
  }
}
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function ask(req, res) {
  const { text } = await readJson(req);
  const delegation = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization : null;
  const key = staticKey();
  const auth = delegation ? { Authorization: delegation } : key ? { 'X-Agent-Key': key } : null;
  if (!auth) return send(res, 503, { error: 'the agent has no credential' });
  const cr = await call(`${BOOKING}/api/crossings`);
  const { crossings } = await cr.json();
  const t0 = Date.now();
  let answer;
  try {
    const r = await call(`${OLLAMA}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, prompt: prompt(text, crossings), format: 'json', stream: false, keep_alive: '10m', options: { temperature: 0, num_ctx: 2048 } }),
    }, OLLAMA_MS);
    if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
    answer = (await r.json()).response;
  } catch (e) {
    return send(res, 503, { error: `not available: Ollama is not running or too slow (${e.name === 'AbortError' ? 'timeout' : e.message})` });
  }
  let plan;
  try {
    plan = validate(answer, crossings);
  } catch (e) {
    return send(res, 422, { error: e.message, model_ms: Date.now() - t0 });
  }
  const model_ms = Date.now() - t0;
  if (plan.action === 'none') return send(res, 200, { plan, model_ms, done: false });
  return act(res, plan, auth, model_ms);
}

async function act(res, plan, auth, model_ms) {
  const url = plan.action === 'rebook' ? `${BOOKING}/api/crossings/${plan.from}/rebook` : `${BOOKING}/api/crossings/${plan.from}/cancel-all`;
  const r = await call(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify(plan.action === 'rebook' ? { to: plan.to } : {}) });
  const body = await r.json().catch(() => ({}));
  log({ msg: 'acted', plan, status: r.status, via: auth.Authorization ? 'delegation' : 'static-key' });
  return send(res, r.ok ? 200 : r.status, { plan, model_ms, done: r.ok, booking: body });
}

// POST /act {action, from, to}: the same allowlisted call without the model
// (the rehearsal's scripted overreach, independent of what a model says).
async function direct(req, res) {
  const b = await readJson(req);
  const delegation = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization : null;
  const key = staticKey();
  const auth = delegation ? { Authorization: delegation } : key ? { 'X-Agent-Key': key } : null;
  if (!auth) return send(res, 503, { error: 'the agent has no credential' });
  const cr = await call(`${BOOKING}/api/crossings`);
  let plan;
  try {
    plan = validate(b, (await cr.json()).crossings);
  } catch (e) {
    return send(res, 422, { error: e.message });
  }
  return act(res, plan, auth, 0);
}

http.createServer(async (req, res) => {
  const id = randomUUID();
  const t0 = Date.now();
  try {
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true, credential: staticKey() ? 'static-key' : 'none', model: MODEL });
    if (req.method === 'POST' && req.url === '/ask') return await ask(req, res);
    if (req.method === 'POST' && req.url === '/act') return await direct(req, res);
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
  } finally {
    log({ id, method: req.method, path: req.url, status: res.statusCode, ms: Date.now() - t0 });
  }
}).listen(PORT, () => log({ msg: 'tide-agent up', port: PORT, model: MODEL }));
