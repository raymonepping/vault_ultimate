// helpers/auth.ts: sign in the way Saskia does (D14): the console sends her
// to Keycloak's own form; Keycloak sends her back; the API trades her token
// for her own Vault token and sets a session cookie.
import { expect, type Page } from '@playwright/test';
import { personPassword, urls } from './env';

export async function signIn(page: Page, user = 'saskia', route = 'scoreboard') {
  await page.goto(`${urls.web}/#/${route}`);
  await page.getByRole('link', { name: 'Sign in with Keycloak' }).click();
  await expect(page).toHaveURL(/\/realms\/tidewell\/protocol\/openid-connect\/auth/);
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(personPassword(user));
  await page.locator('#kc-login').click();
  await expect(page.locator('.persona')).toBeVisible();
}
