// lib/runner-client.js: the API's way to the host runner (runner/server.js):
// one allowlisted make target at a time. The bearer token is read from its
// file per call (the runner writes a new one on every start).
import { readFileSync } from 'node:fs';
import { fetchWithTimeout } from './vault.js';

export function createRunnerClient({ url = process.env.RUNNER_URL || 'http://host.containers.internal:14209', tokenFile = process.env.RUNNER_TOKEN_FILE || '/build/run/runner.token' } = {}) {
  async function call(method, path) {
    let token;
    try {
      token = readFileSync(tokenFile, 'utf8').trim();
    } catch {
      return { status: 503, body: { error: 'the host runner is not running (make app-up starts it)' } };
    }
    try {
      const { res, text } = await fetchWithTimeout(`${url}${path}`, { method, headers: { Authorization: `Bearer ${token}` } }, 10_000, 'runner');
      return { status: res.status, body: JSON.parse(text || '{}') };
    } catch (e) {
      return { status: 503, body: { error: `the host runner did not answer: ${e.message}` } };
    }
  }
  return {
    run: (action) => call('POST', `/run/${action}`),
    op: (id) => call('GET', id ? `/op?id=${id}` : '/op'),
  };
}
