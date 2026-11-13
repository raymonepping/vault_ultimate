// What the console serves: TLS 1.3 from the lab CA, a strict CSP, no secret
// value anywhere, no action a page could steer.
import { test, expect } from '@playwright/test';
import { legacyValues, servedHeaders, servedLeaf, servedPost } from '../helpers/env';

test('TLS 1.3, certificate from the lab CA', async () => {
  const { protocol, cert } = await servedLeaf();
  expect(protocol).toBe('TLSv1.3');
  expect(cert.issuer.CN).toContain('Lab CA');
});

test('a Content-Security-Policy without unsafe-inline scripts', async () => {
  const h = await servedHeaders('/');
  const csp = String(h['content-security-policy']);
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
});

test('no legacy value in a served bundle or an API answer', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src]').evaluateAll((s) => s.map((x) => (x as HTMLScriptElement).src));
  const api = ['/api/scoreboard', '/api/witness', '/api/acts', '/api/investigation', '/api/events', '/api/status'];
  const bodies = await Promise.all([...scripts, ...api].map((u) => page.evaluate((x) => fetch(x).then((r) => r.text()), u)));
  for (const v of legacyValues) for (const b of bodies) expect(b.includes(v)).toBe(false);
});

test('a write from another origin is refused', async () => {
  expect(await servedPost('/api/acts/1/run', { origin: 'https://localhost:13701' })).toBe(403);
  expect(await servedPost('/api/rotate/deploy', { 'sec-fetch-site': 'cross-site' })).toBe(403);
});

test('an action takes no parameters: a body that names another target is refused', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(() =>
    fetch('/api/witness/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'stage-reset' }) }).then((r) => r.status),
  );
  expect(status).toBe(400);
});

test('only a lease the console listed can be revoked', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(() =>
    fetch(`/api/leases/${encodeURIComponent('database/creds/booking/NotListed0000')}/revoke`, { method: 'POST' }).then((r) => r.status),
  );
  expect(status).toBe(403);
});
