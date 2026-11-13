#!/usr/bin/env node
// scripts/manifest-sql.js: the synthetic schedule and manifest as SQL, from
// config/story.json (deterministic: the seed decides every name). Names are
// built from invented syllables, so they match no real person on purpose.
// Standard library only. Prints SQL for psql's stdin; inserts only when the
// crossings table is empty (idempotent).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 2 ** 32);
}
const A = ['Ber', 'Dal', 'Fen', 'Gor', 'Hal', 'Isk', 'Jor', 'Kel', 'Lun', 'Mor', 'Nev', 'Orr', 'Pel', 'Quil', 'Ros', 'Sel', 'Tam', 'Ulv', 'Vor', 'Wyn'];
const B = ['a', 'en', 'is', 'o', 'ra', 'yn', 'el', 'ith', 'or', 'ua'];
const C = ['brook', 'dell', 'fold', 'gate', 'holt', 'mere', 'ridge', 'stone', 'vale', 'wick'];
export const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function manifestSql(story) {
  const r = rng(story.schedule.manifest_seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const [from, to] = story.ports;
  const out = ['DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM crossings) THEN', "RAISE NOTICE 'VULT_CHANGED manifest';"];
  for (let day = 1; day <= story.schedule.days; day++) {
    for (const [i, dep] of story.schedule.departures.entries()) {
      const id = `d${day}-${dep.replace(':', '')}`;
      const [a, b] = i % 2 === 0 ? [from, to] : [to, from];
      out.push(`INSERT INTO crossings (id, day, departs, from_port, to_port, seats) VALUES (${q(id)}, ${day}, ${q(dep)}, ${q(a)}, ${q(b)}, ${story.schedule.seats});`);
      for (let n = 0; n < story.schedule.booked_per_crossing; n++) {
        const name = `${pick(A)}${pick(B)} ${pick(A)}${pick(C)}`;
        const plate = r() < 0.4 ? `TW-${String(Math.floor(r() * 900) + 100)}-${pick(['K', 'L', 'M', 'N'])}${pick(['A', 'E', 'R'])}` : null;
        out.push(`WITH p AS (INSERT INTO passengers (name, vehicle_plate) VALUES (${q(name)}, ${plate ? q(plate) : 'NULL'}) RETURNING id)`);
        out.push(`INSERT INTO bookings (crossing_id, passenger_id, cabin) SELECT ${q(id)}, id, ${q(`C${100 + n}`)} FROM p;`);
      }
    }
  }
  out.push('END IF; END $$;');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(manifestSql(JSON.parse(readFileSync(new URL('../config/story.json', import.meta.url)))) + '\n');
}
