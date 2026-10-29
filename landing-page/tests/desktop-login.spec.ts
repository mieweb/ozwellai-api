import { expect, test } from '@playwright/test';

const apiOrigin = process.env.WIDGET_TEST_ORIGIN || 'http://localhost:3000';
const unavailable = 'Sign-in methods are unavailable. Try again shortly.';

for (const [provider, button] of [
  ['none', undefined],
  ['google', 'Continue with Google'],
  ['apple', 'Continue with Apple'],
  ['email_otp', 'Send code'],
] as const) {
  test(`desktop login explains authentication availability: ${provider}`, async ({ page }) => {
    await page.route('**/auth/methods', route => route.fulfill({
      json: { google: provider === 'google', apple: provider === 'apple', email_otp: provider === 'email_otp' },
    }));
    // Isolate provider availability from PKCE and real account login. The page
    // still loads the production desktop bundle and its key-disabled AuthGate.
    await page.route('**/desktop-login-methods-fixture', route => route.fulfill({
      contentType: 'text/html',
      body: '<div id="ozwell-desktop-login"></div>' +
        '<script id="ozwell-desktop-config" type="application/json">{"flowId":"synthetic-methods-fixture","clientName":"Synthetic Desktop"}</script>' +
        '<script src="/auth/desktop/login.js"></script>',
    }));
    await page.goto(`${apiOrigin}/desktop-login-methods-fixture`);
    await expect(page.getByRole('heading', { name: 'Sign in to Ozwell' })).toBeVisible();
    await expect(page.getByLabel('Ozwell API key')).toHaveCount(0);
    if (button) {
      await expect(page.getByRole('button', { name: button, exact: true })).toBeVisible();
      await expect(page.getByText(unavailable, { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
      await expect(page.getByRole('button')).toHaveCount(0);
    }
  });
}
