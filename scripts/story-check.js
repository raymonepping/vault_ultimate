#!/usr/bin/env node
// scripts/story-check.js: validate config/story.json (Tidewell's people,
// schedule, notes, legacy secrets, the deploy token) and config/inventory.json
// (the before estate's machine credentials and their copies), then print a
// digest. Standard library only. Exit 1 on any error.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const AWS_NAME = /^[A-Za-z0-9/_+=.@-]{1,512}$/;
const KV_NAME = /^[a-z0-9-]+(\/[a-z0-9-]+)+$/;
const GH_NAME = /^[A-Z_][A-Z0-9_]*$/;
const USER = /^[a-z][a-z0-9-]{1,30}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Values are synthetic and say so: gitleaks blocks real-looking secrets, and
// the GitHub repository is public (its secret names and times are visible).
const SYNTHETIC = /demo/;
const TESTS = new Set(['postgres-login', 'tls-handshake-ocsp', 'ldap-bind', 'oidc-client-credentials', 'booking-api-call', 'booking-deploy-check']);

export function checkStory(doc) {
  const errors = [];
  const err = (m) => errors.push(m);
  for (const who of ['presenter', 'clerk']) {
    if (!USER.test(doc[who]?.user ?? '')) err(`${who}.user must be a short lowercase name`);
    if (!doc[who]?.group) err(`${who}.group is missing`);
  }
  if (doc.presenter?.user === doc.clerk?.user) err('presenter and clerk must be different people');
  const s = doc.schedule ?? {};
  if (!(s.days >= 1)) err('schedule.days must be at least 1');
  if (!(s.departures ?? []).length || !s.departures.every((t) => TIME.test(t))) err('schedule.departures must be HH:MM times');
  if (!(s.seats > 0) || !(s.booked_per_crossing > 0) || s.booked_per_crossing > s.seats) err('schedule: booked_per_crossing must be between 1 and seats');
  const w = doc.weather_cancel ?? {};
  if (!(w.day >= 1 && w.day <= s.days)) err('weather_cancel.day is outside the schedule');
  if (!s.departures?.includes(w.departure) || !s.departures?.includes(w.rebook_to)) err('weather_cancel departures must be in the schedule');
  if (w.departure === w.rebook_to) err('weather_cancel must rebook to another departure');
  // A support note never carries a credential, nor a placeholder for one.
  if (!doc.notes?.act0) err('notes.act0 is missing');
  if (/\{\{|postgres(ql)?:\/\/[^\s]*:[^\s]*@/.test(doc.notes?.act0 ?? '')) err('notes.act0 must not carry a credential or a placeholder for one');
  const kvNames = new Set();
  for (const [i, l] of (doc.legacy ?? []).entries()) {
    const at = `legacy[${i}]`;
    if (!AWS_NAME.test(l.aws_name ?? '')) err(`${at}: aws_name is not a valid AWS Secrets Manager name`);
    if (!KV_NAME.test(l.kv_name ?? '')) err(`${at}: kv_name must be a lowercase path like ops/name`);
    if (kvNames.has(l.kv_name)) err(`${at}: kv_name ${l.kv_name} is used twice`);
    kvNames.add(l.kv_name);
    // A plain string: Secrets Import keeps a SecretString raw under the KV key
    // "value" (vault_sync P21), so JSON here would land as JSON inside one key.
    if (typeof l.value !== 'string' || !SYNTHETIC.test(l.value)) err(`${at}: value must be a string with "demo" in it (synthetic)`);
    if (!l.labels?.owner) err(`${at}: labels.owner is missing`);
  }
  if (!(doc.legacy ?? []).length) err('no legacy secrets');
  const d = doc.deploy ?? {};
  if (!KV_NAME.test(d.kv_name ?? '')) err('deploy.kv_name must be a lowercase path');
  if (kvNames.has(d.kv_name)) err('deploy.kv_name must not be a legacy path');
  if (!GH_NAME.test(d.github_name ?? '')) err('deploy.github_name must be a valid GitHub secret name');
  if (!AWS_NAME.test(d.aws_name ?? '')) err('deploy.aws_name is not a valid AWS name');
  // The deploy token is generated into .secrets/workload/ (scripts/workload-secrets.sh):
  // a value here would be public in the repository.
  if ('value' in d) err('deploy.value must not be in config/story.json (it is generated into .secrets/)');
  if (doc.sync?.secret !== d.kv_name) err('sync.secret must be the deploy token');
  for (const dest of doc.sync?.destinations ?? []) if (!['github', 'localstack'].includes(dest)) err(`sync: unknown destination ${dest}`);
  if (doc.rotate !== d.kv_name) err('rotate must be the deploy token');
  return errors;
}

export function checkInventory(inv, story) {
  const errors = [];
  const err = (m) => errors.push(m);
  const ids = new Set();
  for (const [i, c] of (inv.credentials ?? []).entries()) {
    const at = `credentials[${i}]`;
    if (!/^[a-z0-9-]+$/.test(c.id ?? '')) err(`${at}: id must be lowercase-with-dashes`);
    if (ids.has(c.id)) err(`${at}: id ${c.id} is used twice`);
    ids.add(c.id);
    if (!TESTS.has(c.test)) err(`${at}: unknown test ${c.test} (the witness has no way to try it)`);
    if (c.residual) {
      if (c.removed_by_act !== null) err(`${at}: a residual has no removing act`);
      if (!c.residual_reason) err(`${at}: a residual needs its reason`);
    } else if (!(Number.isInteger(c.removed_by_act) && c.removed_by_act >= 1 && c.removed_by_act <= 5)) {
      err(`${at}: removed_by_act must be an act from 1 to 5`);
    }
    if (!(c.lives_in ?? []).length) err(`${at}: lives_in is empty`);
  }
  if (!(inv.credentials ?? []).length) err('no credentials');
  const legacy = new Set((story.legacy ?? []).map((l) => l.kv_name));
  for (const [i, c] of (inv.copies ?? []).entries()) {
    if (!ids.has(c.holds) && !legacy.has(c.holds)) err(`copies[${i}]: holds ${c.holds}, which is neither a credential nor a legacy secret`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rawStory = readFileSync(new URL('../config/story.json', import.meta.url));
  const rawInv = readFileSync(new URL('../config/inventory.json', import.meta.url));
  const story = JSON.parse(rawStory);
  const inv = JSON.parse(rawInv);
  const errors = [...checkStory(story), ...checkInventory(inv, story)];
  if (errors.length) {
    for (const e of errors) console.error(`story-check: ${e}`);
    process.exit(1);
  }
  const digest = createHash('sha256').update(rawStory).update(rawInv).digest('hex').slice(0, 8);
  const residuals = inv.credentials.filter((c) => c.residual).length;
  console.log(`story-check: ${inv.credentials.length} credentials (${residuals} residual), ${inv.copies.length} copies, ${story.legacy.length} legacy secrets, digest ${digest}`);
}
