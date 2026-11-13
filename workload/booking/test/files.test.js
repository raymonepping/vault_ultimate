// watch(): a reload that fails (a file read halfway through Agent's write) is
// tried again on the next poll instead of being forgotten (seen at act 3:
// "PEM routines::no start line", then the old certificate stayed in use).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watch } from '../lib/files.js';

test('a failed reload is retried until it succeeds', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'watch-')), 'cert.pem');
  writeFileSync(f, 'old');
  let calls = 0;
  let done;
  const ok = new Promise((r) => (done = r));
  const stop = watch([f], () => {
    calls += 1;
    if (calls === 1) throw new Error('no start line');
    done();
  }, 10);
  writeFileSync(f, 'new');
  await Promise.race([ok, new Promise((_, no) => setTimeout(() => no(new Error('never retried')), 1000))]);
  stop();
  assert.equal(calls, 2);
});
