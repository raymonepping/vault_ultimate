// What the console serves: TLS 1.3 from the lab CA, a strict CSP, no secret,
// no step a page could steer.
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

test('no legacy value in a served bundle or in /api/story or /api/sources', async ({ page }) => {
  await page.goto('/');
  const scripts = await page.locator('script[src]').evaluateAll((s) => s.map((x) => (x as HTMLScriptElement).src));
  const bodies = [...(await Promise.all(scripts.map((src) => page.evaluate((u) => fetch(u).then((r) => r.text()), src)))), await page.evaluate(() => fetch('/api/story').then((r) => r.text())), await page.evaluate(() => fetch('/api/sources').then((r) => r.text()))];
  for (const v of legacyValues) for (const b of bodies) expect(b.includes(v)).toBe(false);
});

test('a write from another origin is refused', async () => {
  expect(await servedPost('/api/acts/change/rotate', { origin: 'https://localhost:13701' })).toBe(403);
  expect(await servedPost('/api/session', { 'sec-fetch-site': 'cross-site' })).toBe(403);
});

test('a step takes no parameters: a body that names another secret is refused', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(() =>
    fetch('/api/acts/out/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret_name: 'parcel/smtp-relay' }) }).then((r) => r.status),
  );
  expect(status).toBe(400);
});
