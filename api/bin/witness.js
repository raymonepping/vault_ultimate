// bin/witness.js: one witness run (make witness, scripts/witness.sh runs it
// in a throwaway container on vult-internal). Writes /out/latest.json, a copy
// under /out/history/, and /out/scoreboard.json from the whole history.
// Prints one line per credential: the answer, never a value.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { witness } from '../lib/witness.js';
import { scoreboard } from '../lib/scoreboard.js';

const env = process.env;
const out = env.WITNESS_OUT || '/out';
const facts = JSON.parse(readFileSync(env.WITNESS_FACTS || `${out}/host-facts.json`, 'utf8'));
const S = env.WITNESS_SECRETS || '/secrets';
const ctx = {
  act: facts.act,
  token: readFileSync(env.WITNESS_TOKEN_FILE || '/run/witness/token', 'utf8').trim(),
  ca: readFileSync(env.NODE_EXTRA_CA_CERTS || '/ca/ca-chain.pem', 'utf8'),
  pgHost: 'postgres', ldapHost: 'openldap', bookingHost: 'booking',
  booking: 'https://booking:8443', keycloak: 'https://keycloak:8443/realms/tidewell', localstack: 'https://localstack:4566',
  files: {
    inventory: '/cfg/inventory.json', story: '/cfg/story.json',
    bookingEnv: `${S}/workload/booking.env`, agentEnv: `${S}/workload/tide-agent.env`,
    dbPassword: `${S}/workload/booking-db-password`, deployToken: `${S}/workload/deploy-token`, agentKey: `${S}/workload/agent-api-key`,
    tlsCert: `${S}/workload/tls/cert.pem`, tlsKey: `${S}/workload/tls/key.pem`,
    wrappedSecretId: `${S}/workload/approle/wrapped-secret-id`,
    ldapBind: `${S}/ldap-bind`, oidcSecret: `${S}/oidc-secret`,
    githubEvidence: '/github/evidence.json',
  },
};

const run = await witness(ctx);
mkdirSync(`${out}/history`, { recursive: true });
const text = `${JSON.stringify(run, null, 2)}\n`;
writeFileSync(`${out}/history/${run.at.replace(/[:.]/g, '-')}.json`, text);
writeFileSync(`${out}/latest.json`, text);
const history = readdirSync(`${out}/history`).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${out}/history/${f}`, 'utf8')));
writeFileSync(`${out}/scoreboard.json`, `${JSON.stringify(scoreboard(history, facts.canaries || []), null, 2)}\n`);

for (const c of run.credentials) console.log(`${c.works ? 'STANDS ' : 'refused'}  ${c.id.padEnd(27)} ${c.fingerprint ?? '--------'}  ${c.answer}`);
for (const c of run.extras) console.log(`${c.works ? 'STANDS ' : 'refused'}  ${c.id.padEnd(27)} ${c.fingerprint ?? '--------'}  ${c.answer}`);
for (const c of run.copies) console.log(`${c.unmanaged ? 'UNMANAGED' : 'ok       '} ${c.id.padEnd(33)} ${c.answer}`);
const l = run.longest;
console.log(`act ${run.act}: standing ${run.standing}, unmanaged copies ${run.unmanaged}, longest ${l.never ? `never (${l.id})` : `${l.seconds}s${l.id ? ` (${l.id})` : ''}`}${run.residual.length ? `, residual ${run.residual.join(', ')}` : ''}`);
