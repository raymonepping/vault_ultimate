// lib/creds.js: where each credential comes from, act by act. The app does
// not know about acts; it prefers what Vault Agent rendered and falls back to
// the before estate's booking.env.
//
//   database       /vault/out/db.json {username, password, lease_id}  else booking.env DB_USER/DB_PASSWORD
//   deploy token   /vault/out/deploy.json {token}                     else booking.env DEPLOY_TOKEN
//   agent key      booking.env AGENT_API_KEY (act 5 removes it)
//   OIDC secret    booking.env OIDC_CLIENT_SECRET (a residual unless act 4 replaces it)
import { parseEnv, readIfPresent } from './files.js';

export const PATHS = {
  env: process.env.BOOKING_ENV_FILE || '/run/booking/booking.env',
  db: process.env.BOOKING_DB_FILE || '/vault/out/db.json',
  deploy: process.env.BOOKING_DEPLOY_FILE || '/vault/out/deploy.json',
};

function json(path) {
  const t = readIfPresent(path);
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function current(paths = PATHS) {
  const env = parseEnv(readIfPresent(paths.env) ?? '');
  const db = json(paths.db);
  const deploy = json(paths.deploy);
  return {
    database: db?.username && db?.password
      ? { user: db.username, password: db.password, source: 'vault-agent', lease_id: db.lease_id ?? null }
      : env.DB_USER && env.DB_PASSWORD
        ? { user: env.DB_USER, password: env.DB_PASSWORD, source: 'booking.env', lease_id: null }
        : null,
    deployToken: deploy?.token || env.DEPLOY_TOKEN || null,
    deploySource: deploy?.token ? 'vault-agent' : env.DEPLOY_TOKEN ? 'booking.env' : null,
    agentKey: env.AGENT_API_KEY || null,
    oidcSecret: env.OIDC_CLIENT_SECRET || null,
  };
}
