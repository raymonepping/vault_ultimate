#!/usr/bin/env node
// scripts/github-installation.js <pem file> <app id> <owner> <repo>: print the
// GitHub App's installation on one repository: its id, repository selection
// and permissions (identifiers, not secrets). The app JWT (RS256, 10 minutes)
// is signed in memory from the PEM and never printed or written.
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const [pemFile, appId, owner, repo] = process.argv.slice(2);
if (!repo) {
  console.error('usage: github-installation.js <pem file> <app id> <owner> <repo>');
  process.exit(64);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
const jwt = `${input}.${createSign('RSA-SHA256').update(input).sign(readFileSync(pemFile)).toString('base64url')}`;
const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
  headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
});
const j = await r.json();
if (!r.ok) {
  console.error(`github-installation: HTTP ${r.status} ${j.message || ''}`);
  process.exit(1);
}
console.log(JSON.stringify({ installation_id: j.id, app_slug: j.app_slug, repository_selection: j.repository_selection, permissions: j.permissions }));
