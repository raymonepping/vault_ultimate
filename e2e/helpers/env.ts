// helpers/env.ts: where things are. Ports come from the same two files the
// stack reads (config/defaults.conf, overridden by .env).
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(__dirname, '../..');

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] !== 'VAULT_LICENSE') out[m[1]] = m[2];
  }
  return out;
}

const merged = { ...readEnvFile(path.join(ROOT, 'config/defaults.conf')), ...readEnvFile(path.join(ROOT, '.env')) };

export function conf(name: string): string {
  const v = merged[name];
  if (v === undefined) throw new Error(`configuration value ${name} is not set`);
  return v;
}

export const urls = {
  web: `https://localhost:${conf('VULT_PORT_WEB')}`,
};

const LAB_CA = path.join(ROOT, 'vault-tls/ca-chain.pem');
const LEAF = path.join(ROOT, 'vault-tls/vault.crt');

const spki = (pem: string) =>
  crypto.createHash('sha256').update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('base64');

/**
 * Chromium flag that makes the browser trust exactly the console leaf's, the
 * lab CA's and Vault PKI's intermediate's keys (in no browser trust store) instead of
 * ignoring certificate errors.
 */
// The booking site's certificate comes from Vault PKI: its issuing CA (the
// intermediate the lab CA signed, ansible/pki-ca.yml) is pinned too, because
// Chromium matches pins only on the chain it builds, which ends there.
const VAULT_INT = path.join(ROOT, '.build/pki-ca/int.crt');
export function labCaSpkiArg(): string {
  const pins = [LEAF, LAB_CA, ...(fs.existsSync(VAULT_INT) ? [VAULT_INT] : [])].map((f) => spki(fs.readFileSync(f, 'utf8')));
  return `--ignore-certificate-errors-spki-list=${pins.join(',')}`;
}

/** TLS to the console the strict way: hostname checked, chain verified against the lab CA only. */
export function servedLeaf(): Promise<{ cert: tls.PeerCertificate; protocol: string | null }> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host: 'localhost', port: Number(conf('VULT_PORT_WEB')), servername: 'localhost', ca: [fs.readFileSync(LAB_CA)] }, () => {
      const out = { cert: s.getPeerCertificate(), protocol: s.getProtocol() };
      s.end();
      resolve(out);
    });
    s.on('error', reject);
  });
}

/** A person's password, from the file make people wrote (never logged). */
export function personPassword(user: string): string {
  return fs.readFileSync(path.join(ROOT, '.secrets/people', user), 'utf8').trim();
}

/** The story; its synthetic legacy values must never be served. */
export const story = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/story.json'), 'utf8'));
export const legacyValues: string[] = story.legacy.map((l: { value: string }) => l.value);

/** The act the lab is at (.build/act). */
export const currentAct = (): number => Number(fs.existsSync(path.join(ROOT, '.build/act')) ? fs.readFileSync(path.join(ROOT, '.build/act'), 'utf8').trim() : '0') || 0;

/** make stage-reset CONFIRM=yes (the act 0 baseline). */
export function stageReset(): void {
  execFileSync(path.join(ROOT, 'scripts/stage-reset.sh'), [], { env: { ...process.env, CONFIRM: 'yes' }, stdio: 'ignore', timeout: 300_000 });
}

/** A GET to the console: status and headers, TLS verified against the lab CA only. */
export function served(p: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    https
      .get({ host: 'localhost', port: Number(conf('VULT_PORT_WEB')), path: p, ca: [fs.readFileSync(LAB_CA)] }, (r) => {
        r.resume();
        resolve({ status: r.statusCode || 0, headers: r.headers });
      })
      .on('error', reject);
  });
}

/** Response headers from the console, TLS verified against the lab CA only. */
export const servedHeaders = async (p: string) => (await served(p)).headers;

/** A POST to the console with chosen headers (e.g. a foreign Origin), TLS verified against the lab CA only. */
export function servedPost(p: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = https.request(
      { method: 'POST', host: 'localhost', port: Number(conf('VULT_PORT_WEB')), path: p, ca: [fs.readFileSync(LAB_CA)], headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        res.resume();
        resolve(res.statusCode || 0);
      },
    );
    r.on('error', reject);
    r.end('{}');
  });
}
