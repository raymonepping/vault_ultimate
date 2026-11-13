// global-setup.ts: fail fast, with the make target that fixes it, when the
// stack is not up; a fresh stage; then sign in once as saskia through the
// console's own form and keep the session for every journey.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { labCaSpkiArg, served, stageReset } from './helpers/env';
import { signIn } from './helpers/auth';

const CORE = ['vult-vault_s', 'vult-vault_1', 'vult-vault_2', 'vult-vault_3', 'vult-localstack', 'vult-api', 'vult-web'];
export const STORAGE = path.join(__dirname, '.auth/saskia.json');

export default async function globalSetup(): Promise<void> {
  const running = execFileSync('podman', ['ps', '--filter', 'name=^vult-', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n');
  const down = CORE.filter((c) => !running.includes(c));
  if (down.length) throw new Error(`not running: ${down.join(', ')}: run "make up"`);
  // 200 only: with the API down, nginx itself answers 502.
  const h = await served('/api/healthz').catch(() => null);
  if (h?.status !== 200) throw new Error(`the API behind the console is not healthy (${h ? `HTTP ${h.status}` : 'no answer'}): run "make doctor"`);
  stageReset();
  const browser = await chromium.launch({ args: [labCaSpkiArg()] });
  const page = await browser.newPage();
  await signIn(page);
  await page.context().storageState({ path: STORAGE });
  await browser.close();
}
