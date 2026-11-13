import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../lib/files.js';
import { current } from '../lib/creds.js';

const dir = () => mkdtempSync(join(tmpdir(), 'booking-'));

test('booking.env is parsed as KEY=VALUE without shell expansion', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB = two words \nC=$HOME\nbad line\n'), { A: '1', B: 'two words', C: '$HOME' });
});

test('before act 2 the database credential comes from booking.env', () => {
  const d = dir();
  writeFileSync(join(d, 'booking.env'), 'DB_USER=booking_app\nDB_PASSWORD=synthetic-demo\n');
  const c = current({ env: join(d, 'booking.env'), db: join(d, 'db.json'), deploy: join(d, 'deploy.json') });
  assert.equal(c.database.source, 'booking.env');
  assert.equal(c.database.user, 'booking_app');
  rmSync(d, { recursive: true });
});

test("Vault Agent's db.json wins over booking.env (act 2)", () => {
  const d = dir();
  writeFileSync(join(d, 'booking.env'), 'DB_USER=booking_app\nDB_PASSWORD=synthetic-demo\n');
  writeFileSync(join(d, 'db.json'), JSON.stringify({ username: 'v-approle-booking-x', password: 'p', lease_id: 'database/creds/booking/abc' }));
  const c = current({ env: join(d, 'booking.env'), db: join(d, 'db.json'), deploy: join(d, 'deploy.json') });
  assert.equal(c.database.source, 'vault-agent');
  assert.equal(c.database.lease_id, 'database/creds/booking/abc');
  rmSync(d, { recursive: true });
});

test('a half-written db.json falls back instead of crashing', () => {
  const d = dir();
  writeFileSync(join(d, 'booking.env'), 'DB_USER=booking_app\nDB_PASSWORD=x\n');
  writeFileSync(join(d, 'db.json'), '{"username": "v-');
  assert.equal(current({ env: join(d, 'booking.env'), db: join(d, 'db.json'), deploy: join(d, 'deploy.json') }).database.source, 'booking.env');
  rmSync(d, { recursive: true });
});
