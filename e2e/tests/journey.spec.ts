// The whole story through the console, as Saskia, against the live lab:
// act 0, acts 1 to 6 from the act rail, the revoke, Agent's fresh login, the
// rotation, the summary (or its absence), axe on every page at 1440x900 and
// 390x844 at act 6, the screenshots for the README, then the stage reset
// from the Proof page back to the act 0 baseline.
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROOT, conf, personPassword } from '../helpers/env';
import { lastOpId, runViaApi, waitOp } from '../helpers/op';

const PAGES = ['scoreboard', 'acts', 'witness', 'investigation', 'proof'];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SHOTS = path.join(ROOT, 'docs/screenshots');
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const summary = (r: { violations: { id: string; impact?: string | null; nodes: { target: unknown[] }[] }[] }) =>
  r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);

test.describe.configure({ mode: 'serial' });

async function tile(page: Page, label: string) {
  return page.locator('.score-tile', { hasText: label }).locator('.score-tile__value');
}
async function scoreboardAfterWitness(page: Page) {
  await page.goto('/#/scoreboard');
  await runViaApi(page, '/api/witness/run');
  await page.reload();
  await expect(page.locator('.score-grid')).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

test('act 0: everything stands, every copy is unmanaged', async ({ page }) => {
  await scoreboardAfterWitness(page);
  await expect(await tile(page, 'Standing secrets')).toHaveText('6');
  await expect(await tile(page, 'Longest remaining lifetime')).toHaveText('never');
  await expect(await tile(page, 'Unmanaged copies')).toHaveText('6');
  await shot(page, 'scoreboard-act0');
  await page.locator('.score-tile', { hasText: 'Standing secrets' }).click();
  await expect(page.locator('.vg-drawer .evidence-row')).toHaveCount(6);
  await expect(page.locator('.vg-drawer')).toContainText('logged in as booking_app; VALID UNTIL infinity');
  await page.keyboard.press('Escape');
});

test('the act rail runs the next act only', async ({ page }) => {
  await page.goto('/#/scoreboard');
  const status = await page.evaluate(() => fetch('/api/acts/3/run', { method: 'POST' }).then((r) => r.status));
  expect(status, 'an act out of order is refused').toBe(409);
});

async function runAct(page: Page, n: number) {
  await page.goto('/#/scoreboard');
  const before = await lastOpId(page);
  await page.getByRole('button', { name: `Run act ${n}` }).click();
  const op = await waitOp(page, before, 540_000, `act-${n}`);
  expect(op.action).toBe(`act-${n}`);
  await page.reload();
  await expect(page.locator('.vg-card', { hasText: 'The acts' }).locator('.card-sub')).toContainText(`Act ${n} of 6`);
}

for (const n of [1, 2, 3, 4, 5]) {
  test(`act ${n} from the console`, async ({ page }) => {
    test.setTimeout(600_000);
    await runAct(page, n);
  });
}

// The booking app's own staff sign-in, after act 4: Keycloak's real form, and
// the code exchanged over mutual TLS with the site's Vault certificate (no
// client secret). Then Teun asks the agent from the page: with his delegation.
test('act 5: Teun signs in on the booking page and asks the agent', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(`https://localhost:${conf('VULT_PORT_BOOKING')}/`);
  await page.getByRole('link', { name: 'Staff sign in' }).click();
  await page.locator('#username').fill('teun');
  await page.locator('#password').fill(personPassword('teun'));
  await page.locator('#kc-login').click();
  await expect(page.locator('#who')).toContainText('Signed in as teun');
  await page.locator('#staff-crossing').selectOption('d1-1100');
  await page.locator('#agent-text').fill('Rebook the passengers of the 11:00 on day 1 onto the 15:30 on day 1.');
  await page.getByRole('button', { name: 'Ask the agent' }).click();
  await expect(page.locator('#agent-result')).toContainText('With your delegation', { timeout: 120_000 });
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(summary(r), summary(r).join('\n')).toEqual([]);
  await ctx.close();
});

test('act 6 from the console', async ({ page }) => {
  test.setTimeout(600_000);
  await runAct(page, 6);
});

test('act 6: only the residual stands; what works lives minutes, not for ever', async ({ page }) => {
  test.setTimeout(300_000);
  await scoreboardAfterWitness(page);
  await expect(await tile(page, 'Standing secrets')).toHaveText('1');
  await expect(await tile(page, 'Longest remaining lifetime')).not.toHaveText('never');
  await expect(await tile(page, 'Unmanaged copies')).toHaveText('0');
  await shot(page, 'scoreboard-act6');
  await page.goto('/#/witness');
  await expect(page.locator('table').first()).toContainText('password authentication failed for user "booking_app"');
  await expect(page.locator('table').first()).toContainText('OCSP Cert Status: revoked');
  await shot(page, 'witness');
  await page.goto('/#/acts');
  await expect(page.locator('.act-card', { hasText: 'Act 5' })).toContainText('CEILING_POLICY_DENIED');
  await shot(page, 'acts');
});

test('the investigation: the timeline, revoke, Agent again, rotate, the summary', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/#/investigation');
  await expect(page.locator('table')).toContainText('revoked lease database/creds/booking/');
  await expect(page.locator('.score-tile', { hasText: 'Systems changed by hand' }).locator('.score-tile__value')).toHaveText('0');
  await expect(page.locator('.score-tile', { hasText: 'People the audit log names' })).toContainText('saskia');
  const summary = page.locator('.vg-card', { hasText: 'Summary' });
  await expect(summary.locator('.summary-list li').first().or(summary.getByText('not available: Ollama is not running'))).toBeVisible();
  await shot(page, 'investigation');

  await page.getByRole('button', { name: 'Revoke this lease' }).click();
  await expect(page.locator('.inline-notice', { hasText: "revoked the booking app's lease" })).toBeVisible();
  const before = await lastOpId(page);
  await page.getByRole('button', { name: 'Agent logs in again' }).click();
  await waitOp(page, before, 300_000, 'agent');
  await expect.poll(() => page.evaluate(() => fetch('/api/status').then((r) => r.json()).then((j) => j.booking.database)), { timeout: 60_000 }).toBe('up');

  await page.getByRole('button', { name: 'Rotate once' }).click();
  await expect(page.locator('.inline-notice', { hasText: 'rotated ci/deploy-token' })).toBeVisible();
  await page.goto('/#/proof');
  await expect(page.locator('.event').first()).toContainText('correlation id');
  await shot(page, 'proof');
});

for (const vp of VIEWPORTS) {
  for (const id of PAGES) {
    test(`axe: ${id} at act 6 (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/#/${id}`);
      await expect(page.locator('.vg-hero')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(summary(r), summary(r).join('\n')).toEqual([]);
      if (vp.name === 'phone' && id === 'scoreboard') await shot(page, 'scoreboard-act6-phone');
    });
  }
}

test('axe: signed out, the sign-in', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/#/scoreboard');
  await expect(page.getByRole('link', { name: 'Sign in with Keycloak' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(summary(r), summary(r).join('\n')).toEqual([]);
  await ctx.close();
});

test('the stage reset from the Proof page brings the act 0 baseline back', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/#/proof');
  await page.getByRole('button', { name: 'Stage reset…' }).click();
  const before = await lastOpId(page);
  await page.getByRole('button', { name: 'Yes, back to act 0' }).click();
  await waitOp(page, before, 540_000, 'stage-reset');
  await scoreboardAfterWitness(page);
  await expect(await tile(page, 'Standing secrets')).toHaveText('6');
  await expect(await tile(page, 'Unmanaged copies')).toHaveText('6');
});
