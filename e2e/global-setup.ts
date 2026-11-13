// global-setup.ts: fail fast, with the make target that fixes it, when the
// stack is not up; back to act 0 when a run was left elsewhere; then sign in
// once as saskia through Keycloak's real form and keep the session.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { currentAct, labCaSpkiArg, served, stageReset } from './helpers/env';
import { signIn } from './helpers/auth';

const CORE = ['vult-vault_s', 'vult-vault_1', 'vult-vault_2', 'vult-vault_3', 'vult-keycloak', 'vult-openldap', 'vult-postgres', 'vult-localstack', 'vult-booking', 'vult-tide_agent', 'vult-ollama', 'vult-api', 'vult-web'];
export const STORAGE = path.join(__dirname, '.auth/saskia.json');

export default async function globalSetup(): Promise<void> {
  const running = execFileSync('podman', ['ps', '--filter', 'name=^vult-', '--format', '{{.Names}}'], { encoding: 'utf8' }).split('\n');
  const down = CORE.filter((c) => !running.includes(c));
  if (down.length) throw new Error(`not running: ${down.join(', ')}: run "make up"`);
  const h = await served('/api/healthz').catch(() => null);
  if (h?.status !== 200) throw new Error(`the API behind the console is not healthy (${h ? `HTTP ${h.status}` : 'no answer'}): run "make doctor"`);
  if (currentAct() !== 0) stageReset();
  const browser = await chromium.launch({ args: [labCaSpkiArg()] });
  const page = await browser.newPage();
  await signIn(page);
  await page.context().storageState({ path: STORAGE });
  await browser.close();
}
