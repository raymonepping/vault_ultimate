// @shots: refresh docs/screenshots (make screenshots). Not part of make test-ui.
// The story in a shown state: imported, pushed to both, rotated once.
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../helpers/env';
import { populate } from '../helpers/story';

const OUT = path.join(ROOT, 'docs/screenshots');
test.describe.configure({ mode: 'serial' });
test.use({ bypassCSP: true });

const shoot = async (page: Page, id: string) => {
  for (const vp of [{ n: 'desktop', width: 1440, height: 900 }, { n: 'phone', width: 390, height: 844 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(700);
    await page.addStyleTag({ content: '.topbar-wrap{position:static!important}.vg-sidebar{position:static!important;height:auto!important;min-height:100%!important}.skip-link{display:none!important}' });
    await page.screenshot({ path: path.join(OUT, `${id}${vp.n === 'phone' ? '-phone' : ''}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};

test('@shots the console', async ({ page, request }) => {
  test.setTimeout(240_000);
  await populate(request);
  // GitHub's own record, read after the rotation (make github-evidence).
  execFileSync(path.join(ROOT, 'scripts/github-evidence.sh'), [], { stdio: 'ignore', timeout: 60_000 });
  for (const id of ['overview', 'home', 'out', 'change', 'proof']) {
    await page.goto(`/#/${id}`);
    await expect(page.locator('.sync-map .vg-pill').first()).not.toHaveText('checking');
    await page.waitForTimeout(800);
    await shoot(page, id);
  }
});
