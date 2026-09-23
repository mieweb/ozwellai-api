import { test, expect, type Page } from '@playwright/test';

const widgetUrl = 'http://localhost:3000/widget/frame/';
const storageKey = 'ozwell.widget.userKey';
const testKey = 'agnt_key-browser-test';

async function enterKey(page: Page) {
  await page.getByRole('tab', { name: 'Use my key' }).click();
  await page.getByPlaceholder('agnt_key-... or ozw_...').fill(testKey);
}

test.describe('Widget authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/auth/methods', route => route.fulfill({
      json: { google: false, apple: false, email_otp: true, user_key: true },
    }));
    await page.route('**/v1/models/effective', route => route.fulfill({ json: { data: [] } }));
    await page.route('**/v1/keys/validate', route => route.fulfill({ json: { valid: true } }));
  });

  test('rejects an invalid key without opening chat or saving it', async ({ page }) => {
    let modelRequests = 0;
    page.on('request', request => {
      if (request.url().endsWith('/v1/models/effective')) modelRequests++;
    });
    await page.route('**/v1/keys/validate', route => route.fulfill({ status: 401, json: { valid: false } }));
    await page.goto(widgetUrl);
    await enterKey(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Use key', exact: true }).click();
    await expect(page.getByText('This key is not accepted', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to Ozwell' })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    expect(modelRequests).toBe(0);
  });

  for (const remember of [false, true]) {
    test(`validates keys and honors remember=${remember} and forget`, async ({ page }) => {
      await page.goto(widgetUrl);
      await enterKey(page);
      await page.getByRole('checkbox').setChecked(remember);
      const validation = page.waitForRequest('**/v1/keys/validate');
      await page.getByRole('button', { name: 'Use key', exact: true }).click();
      expect((await validation).headers().authorization).toBe(`Bearer ${testKey}`);
      await expect(page.getByText('Personal key', { exact: true })).toBeVisible();
      expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe(remember ? testKey : null);
      await page.getByRole('button', { name: 'Forget key' }).click();
      await expect(page.getByRole('heading', { name: 'Sign in to Ozwell' })).toBeVisible();
      expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    });
  }

  test('clears a rejected remembered key and restores sign-in', async ({ page }) => {
    await page.goto(widgetUrl);
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: storageKey, value: testKey });
    await page.route('**/v1/models/effective', route => route.fulfill({ status: 401, json: {} }));
    const rejected = page.waitForResponse('**/v1/models/effective');
    await page.reload();
    await rejected;
    await expect(page.getByRole('heading', { name: 'Sign in to Ozwell' })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  });

  test('shows the API explanation when OTP verification is denied', async ({ page }) => {
    await page.route('**/auth/otp/request', route => route.fulfill({ json: { challenge_id: 'otp_test' } }));
    await page.route('**/auth/otp/verify', route => route.fulfill({
      status: 403, json: { message: 'This account is not permitted to use widget sign-in.' },
    }));
    await page.goto(widgetUrl);
    await page.getByPlaceholder('you@example.com').fill('browser@example.test');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByPlaceholder('123456').fill('123456');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByText('This account is not permitted to use widget sign-in.')).toBeVisible();
  });

  test('signs out a session without persisting its token', async ({ page }) => {
    await page.route('**/auth/otp/request', route => route.fulfill({ json: { challenge_id: 'otp_test' } }));
    await page.route('**/auth/otp/verify', route => route.fulfill({ json: { session_token: 'sess_browser_test' } }));
    await page.route('**/auth/logout', route => route.fulfill({ json: { ok: true } }));
    await page.goto(widgetUrl);
    await page.getByPlaceholder('you@example.com').fill('browser@example.test');
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByPlaceholder('123456').fill('123456');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
    const logout = page.waitForRequest('**/auth/logout');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    expect((await logout).headers().authorization).toBe('Bearer sess_browser_test');
    await expect(page.getByRole('heading', { name: 'Sign in to Ozwell' })).toBeVisible();
  });
});