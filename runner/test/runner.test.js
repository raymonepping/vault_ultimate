import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRunner, commandFor, BusyError, MAX_LINES } from '../lib/runner.js';

function fakeSpawn() {
  const calls = [];
  const fn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    calls.push({ cmd, args, opts, child });
    return child;
  };
  fn.calls = calls;
  return fn;
}
const lab = { id: 'vault_ultimate', dir: '/labs/vault_ultimate' };
const end = (child, code, signal = null) => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code, signal)); };

test('the command is fixed: make -C <dir> and an allowlisted target', () => {
  assert.deepEqual(commandFor('/d', 'act-3'), ['make', ['-C', '/d', 'act-3']]);
  assert.deepEqual(commandFor('/d', 'stage-reset'), ['make', ['-C', '/d', 'stage-reset', 'CONFIRM=yes']]);
  assert.deepEqual(commandFor('/d', 'plan'), ['make', ['-C', '/d', 'tf-plan', 'ACT=6']]);
  for (const bad of ['act-7', 'clean-slate', 'up', 'act-1; rm -rf /', 'toString', '__proto__', '', undefined]) assert.throws(() => commandFor('/d', bad));
});

test('spawn: no shell, pinned cwd, stdin closed, VLIX_ and make env dropped', async () => {
  const spawn = fakeSpawn();
  const r = createRunner({ spawn, env: { PATH: '/bin', HOME: '/h', VULT_RUNNER_TOKEN: 'x', MAKEFLAGS: 'w -- RUNTIME=podman', MAKELEVEL: '1', RUNTIME: 'podman' } });
  r.start(lab, 'witness');
  const { cmd, args, opts, child } = spawn.calls[0];
  assert.equal(cmd, 'make');
  assert.deepEqual(args, ['-C', lab.dir, 'witness']);
  assert.equal(opts.shell, false);
  assert.equal(opts.cwd, lab.dir);
  assert.equal(opts.stdio[0], 'ignore');
  assert.equal(opts.detached, true);
  assert.deepEqual(opts.env, { PATH: '/bin', HOME: '/h' });
  end(child, 0);
});

test('one operation at a time; lines are redacted; exit code decides the state', async () => {
  const spawn = fakeSpawn();
  const ended = [];
  const r = createRunner({ spawn, onEnd: (op) => ended.push(op) });
  r.start(lab, 'witness');
  assert.throws(() => r.start({ id: 'other', dir: '/o' }, 'timeline'), (e) => e instanceof BusyError && e.operation.lab === 'vault_ultimate');
  const { child } = spawn.calls[0];
  child.stdout.write('phase seal: ok\ntoken hvs.CAESIFAKEFAKEFAKEFAKEFAKE0123\n\x1b[32mup: done\x1b[0m\npart');
  child.stderr.write('ial\n');
  end(child, 2);
  await new Promise((ok) => setTimeout(ok, 10));
  const op = r.latest();
  assert.equal(op.state, 'failed');
  assert.equal(op.exitCode, 2);
  assert.ok(op.lines.includes('phase seal: ok'));
  assert.ok(op.lines.includes('up: done'), 'ANSI colour codes are stripped');
  assert.ok(op.lines.some((l) => l.includes('hvs.[redacted]')) && !op.lines.join().includes('FAKEFAKE'));
  assert.equal(ended.length, 1);
  assert.equal(r.current(), null);
  r.start(lab, 'timeline'); // free again
  end(spawn.calls[1].child, 0);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(r.lastFor('vault_ultimate').state, 'succeeded');
});

test('a timeout stops the whole process group, then kills it', async () => {
  const spawn = fakeSpawn();
  const sent = [];
  const r = createRunner({ spawn, timeoutMs: 20, killGraceMs: 20, kill: (pid, sig) => sent.push([pid, sig]) });
  r.start(lab, 'witness');
  await new Promise((ok) => setTimeout(ok, 60));
  assert.deepEqual(sent, [[-4242, 'SIGTERM'], [-4242, 'SIGKILL']]);
  end(spawn.calls[0].child, null, 'SIGKILL');
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(r.latest().state, 'timed-out');
});

test('only the last MAX_LINES lines are kept', async () => {
  const spawn = fakeSpawn();
  const r = createRunner({ spawn });
  r.start(lab, 'witness');
  const { child } = spawn.calls[0];
  child.stdout.write(Array.from({ length: MAX_LINES + 50 }, (_, i) => `line ${i}`).join('\n') + '\n');
  end(child, 0);
  await new Promise((ok) => setTimeout(ok, 10));
  const { lines } = r.latest();
  assert.equal(lines.length, MAX_LINES);
  assert.equal(lines[0], 'line 50');
});

test('make missing: the operation fails with a reason', async () => {
  const spawn = fakeSpawn();
  const r = createRunner({ spawn });
  r.start(lab, 'witness');
  spawn.calls[0].child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }));
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(r.latest().state, 'failed');
  assert.match(r.latest().lines.at(-1), /could not start make \(ENOENT\)/);
});

test('shutdown refuses new work', async () => {
  const r = createRunner({ spawn: fakeSpawn() });
  await r.shutdown(10);
  assert.throws(() => r.start(lab, 'witness'), BusyError);
});

test('an operation stays findable by id after newer ones (the last 20)', async () => {
  const spawn = fakeSpawn();
  const r = createRunner({ spawn });
  const first = r.start(lab, 'act-2');
  end(spawn.calls[0].child, 0);
  await new Promise((ok) => setTimeout(ok, 10));
  r.start(lab, 'witness');
  end(spawn.calls[1].child, 0);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(r.latest().action, 'witness');
  assert.equal(r.get(first.id).action, 'act-2');
  assert.deepEqual(r.recent().map((o) => o.action), ['witness', 'act-2']);
  assert.equal(r.get(999), null);
});
