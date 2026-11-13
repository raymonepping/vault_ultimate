// lib/db.js: one pg pool built from the current database credential, rebuilt
// when the credential changes (booking.env before act 2, Vault Agent's
// db.json after). The old pool drains in the background. TLS verify-full
// against the lab CA; the server name is postgres.
import pg from 'pg';
import { readFileSync } from 'node:fs';

export function poolManager({ host = 'postgres', database = 'tidewell', caFile = process.env.PG_CA_FILE || '/etc/booking/ca-chain.pem', log = console } = {}) {
  let pool = null;
  let ident = null;
  const ca = (() => {
    try {
      return readFileSync(caFile, 'utf8');
    } catch {
      return undefined;
    }
  })();
  function use(cred) {
    if (!cred) {
      ident = null;
      const old = pool;
      pool = null;
      old?.end().catch(() => {});
      return;
    }
    const next = `${cred.source}:${cred.user}`;
    if (next === ident && pool) return;
    const old = pool;
    pool = new pg.Pool({ host, port: 5432, database, user: cred.user, password: cred.password, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 4000, ssl: { ca, servername: 'postgres', rejectUnauthorized: true } });
    // An idle client that the server ends (a revoked lease) must not crash the app.
    pool.on('error', (e) => log.error(JSON.stringify({ msg: 'pg pool error', error: e.message })));
    ident = next;
    log.log(JSON.stringify({ msg: 'database credential in use', source: cred.source, user: cred.user }));
    old?.end().catch(() => {});
  }
  return {
    use,
    source: () => (ident ? ident.split(':')[0] : null),
    async query(text, params) {
      if (!pool) throw Object.assign(new Error('no database credential'), { status: 503 });
      return pool.query(text, params);
    },
    async tx(fn) {
      if (!pool) throw Object.assign(new Error('no database credential'), { status: 503 });
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
