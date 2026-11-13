// The four acts from the console's own buttons, against the live stack:
// GitHub (VaultSyncDemo) and LocalStack for real. A value never shows.
import { test, expect } from '@playwright/test';
import { legacyValues, stageReset } from '../helpers/env';

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => stageReset());

test('bring them home: the plan writes nothing, the import writes three', async ({ page }) => {
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'Show the plan' }).click();
  await expect(page.locator('pre[aria-label="Import output"]')).toContainText('tidewell-legacy/delivery-api} -> parcel/delivery-api');
  await expect(page.getByText('not pulled yet').first()).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('every secret is in Vault')).toBeVisible();
  await expect(page.getByText('same as the legacy store')).toHaveCount(3);
  await expect(page.locator('.sync-map')).toContainText('pulled 3 of 3');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('a second import would write a new version');
});

test('send them out: both destinations report synced', async ({ page }) => {
  await page.goto('/#/out');
  for (const card of ['GitHub Actions (VaultSyncDemo)', 'AWS Secrets Manager (LocalStack)']) {
    const c = page.locator('section.vg-card').filter({ has: page.getByRole('heading', { name: card }) });
    await c.getByRole('button', { name: 'Push parcel/delivery-api' }).click();
    await expect(c.locator('tbody .vg-pill')).toHaveText('synced', { timeout: 60_000 });
  }
});

test('change once: a rotation reaches the AWS copy; GitHub evidence turns stale', async ({ page }) => {
  await page.goto('/#/change');
  await page.getByRole('button', { name: 'Rotate the delivery key' }).click();
  await expect(page.locator('.inline-notice.success')).toContainText('version 2');
  const aws = page.locator('article.place').filter({ has: page.getByRole('heading', { name: 'AWS copy' }) });
  await expect(aws.getByText('matches Vault')).toBeVisible({ timeout: 30_000 });
  const vault = page.locator('article.place').filter({ has: page.getByRole('heading', { name: 'Vault' }) });
  await expect(vault).toContainText('by saskia');
});

test('proof: every step is an event by saskia with a correlation id', async ({ page }) => {
  await page.goto('/#/proof');
  for (const t of ['Imported', 'Pushed to GitHub', 'Pushed to the AWS copy', 'Rotated']) await expect(page.locator('.event strong', { hasText: t }).first()).toBeVisible();
  await page.locator('.event details summary').first().click();
  await expect(page.locator('.event details code').first()).toHaveText(/^vult-[0-9a-f-]{36}$/);
});

test('let go: removing both associations empties both destinations', async ({ page }) => {
  await page.goto('/#/out');
  for (const card of ['GitHub Actions (VaultSyncDemo)', 'AWS Secrets Manager (LocalStack)']) {
    const c = page.locator('section.vg-card').filter({ has: page.getByRole('heading', { name: card }) });
    await c.getByRole('button', { name: 'Remove the association' }).click();
    await expect(c.getByText('Nothing is pushed here.')).toBeVisible({ timeout: 60_000 });
  }
});

test('no page ever shows a legacy value', async ({ page }) => {
  for (const id of ['overview', 'home', 'out', 'change', 'proof']) {
    await page.goto(`/#/${id}`);
    await expect(page.locator('.vg-hero')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const text = await page.locator('body').innerText();
    for (const v of legacyValues) expect(text.includes(v), `${id} shows a legacy value`).toBe(false);
    expect(text).not.toMatch(/tidewell-rotated-demo-[0-9a-f]{24}/);
  }
});
