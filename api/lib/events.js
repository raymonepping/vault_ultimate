// lib/events.js: the console's bounded event list (the last 200, newest
// first). Every event is cleaned on the way in: secret-named fields dropped
// at any depth (said.js), every string through the redactor (redact.js), so
// no value, token, key or credential can reach a response or a log line.
import { scrub } from './said.js';
import { createRedactor } from './redact.js';

export function clean(v) {
  const r = createRedactor();
  const walk = (x) => {
    if (typeof x === 'string') return r(x) ?? '[redacted]';
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(scrub(v));
}

export function createEvents(max = 200, now = () => new Date().toISOString()) {
  const list = [];
  return {
    add(e) {
      const ev = clean({ at: now(), ...e });
      list.unshift(ev);
      list.length = Math.min(list.length, max);
      return ev;
    },
    list: () => list.slice(),
    clear: () => (list.length = 0),
  };
}
