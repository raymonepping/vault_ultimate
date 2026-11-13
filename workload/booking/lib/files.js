// lib/files.js: the credential files the app reads, and a watcher that
// notices a change. Before act 2 the database password comes from
// booking.env (the before estate's .env); from act 2 Vault Agent renders
// db.json and the app follows it without a restart. Files are compared by
// content fingerprint, polled (in-place writes, Podman's rename gotcha).
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// KEY=VALUE lines, # comments; no shell expansion.
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function readIfPresent(path) {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export const fingerprint = (text) => createHash('sha256').update(text ?? '').digest('hex').slice(0, 8);

// watch(paths, onChange, ms): calls onChange(name) when a file's content
// fingerprint changes (appears, changes or disappears).
export function watch(paths, onChange, ms = 2000) {
  const last = Object.fromEntries(paths.map((p) => [p, fingerprint(readIfPresent(p))]));
  const timer = setInterval(() => {
    for (const p of paths) {
      const now = fingerprint(readIfPresent(p));
      if (now !== last[p]) {
        // Remembered only once onChange took it: a file read halfway through
        // a write (Agent renders the key and the certificate one after the
        // other) is tried again on the next poll.
        try {
          onChange(p);
          last[p] = now;
        } catch (e) {
          console.error(JSON.stringify({ msg: 'reload failed', file: p, error: String(e.message || e) }));
        }
      }
    }
  }, ms);
  timer.unref();
  return () => clearInterval(timer);
}
