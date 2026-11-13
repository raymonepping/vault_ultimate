// runner/server.js: the console's hands on the host (vault_lab_index's
// controller pattern). The waves need Terraform, Ansible and Podman with the
// lab's scoped tokens, which live on the host; the console API runs in a
// container and holds only Saskia's own Vault token. So the API asks this
// runner to run one allowlisted make target (lib/runner.js TARGETS), one at a
// time, and reads its redacted output.
//
//   GET  /healthz           no token
//   POST /run/<action>      202 the operation, 409 while another runs
//   GET  /op                the running operation, else the latest one, and the last 20
//   GET  /op?id=N           one of the last 20, with its redacted output
// Loopback only (containers reach it as host.containers.internal); every
// route but /healthz needs the bearer token from .build/run/runner.token; a
// request with an Origin header (a browser) is refused.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, chmodSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner, BusyError } from './lib/runner.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const conf = (k, d) => {
  for (const f of [join(root, '.env'), join(root, 'config/defaults.conf')]) {
    try {
      const m = new RegExp(`^${k}=(.*)$`, 'm').exec(readFileSync(f, 'utf8'));
      if (m) return m[1].trim();
    } catch { /* optional */ }
  }
  return d;
};
const log = (event, fields = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const port = Number(conf('VULT_RUNNER_PORT', '14209'));
const runDir = join(root, '.build/run');
const tokenFile = join(runDir, 'runner.token');
const token = randomBytes(32).toString('base64url');
mkdirSync(runDir, { recursive: true });
chmodSync(runDir, 0o700);
// 0644 inside a 0700 directory: the API container's uid reads it through
// its read-only mount; nobody else on the Mac can reach it.
writeFileSync(tokenFile, token, { mode: 0o644 });
chmodSync(tokenFile, 0o644);

const expected = Buffer.from(`Bearer ${token}`);
const authorized = (req) => {
  const got = Buffer.from(String(req.headers.authorization || ''));
  return got.length === expected.length && timingSafeEqual(got, expected);
};
const lab = { id: 'vault_ultimate', dir: root };
const runner = createRunner({ spawn, log, timeoutMs: 1_200_000 });

const send = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://runner').pathname;
  if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
  if (req.headers.origin) return send(res, 403, { error: 'browsers may not call the runner' });
  if (!authorized(req)) return send(res, 401, { error: 'token required' });
  if (req.method === 'GET' && path === '/op') {
    const id = Number(new URL(req.url, 'http://runner').searchParams.get('id'));
    if (id) return send(res, runner.get(id) ? 200 : 404, { op: runner.get(id) ?? null });
    return send(res, 200, { op: runner.current() ?? runner.latest(), recent: runner.recent() });
  }
  const m = /^\/run\/([a-z0-9-]{1,32})$/.exec(path);
  if (req.method === 'POST' && m) {
    try {
      return send(res, 202, { op: runner.start(lab, m[1]) });
    } catch (e) {
      if (e instanceof BusyError) return send(res, 409, { error: e.message, operation: e.operation });
      return send(res, 400, { error: 'no such action' });
    }
  }
  return send(res, 404, { error: 'not found' });
});
server.listen(port, '127.0.0.1', () => log('runner_up', { port }));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    server.close();
    await runner.shutdown(30_000);
    rmSync(tokenFile, { force: true });
    log('runner_down', { signal: sig });
    process.exit(0);
  });
}
