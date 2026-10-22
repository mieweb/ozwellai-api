// Focus regression against the actual built widget in Chromium. No live API,
// credentials, or model requests are used. Build the widget before running.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../landing-page/package.json', import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const entry = require.resolve(modulePath ? path.resolve(repository, modulePath) : 'playwright');
const playwright = await import(pathToFileURL(entry).href);
const { chromium } = playwright.default || playwright;
const bundle = await readFile(process.env.OZWELL_WIDGET_BUNDLE
  ? path.resolve(repository, process.env.OZWELL_WIDGET_BUNDLE)
  : fileURLToPath(new URL('../../reference-server/embed/ozwell.js', import.meta.url)));
const apiOrigin = 'https://api.ozwell.ai';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: path.resolve(repository, process.env.CHROMIUM_EXECUTABLE_PATH) }
    : { channel: 'chromium' }),
  headless: true,
});

async function fixture({ autoFocus = true } = {}) {
  const context = await browser.newContext();
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let releaseMethods;
  let markMethodsRequested;
  const methodsRequested = new Promise(resolve => { markMethodsRequested = resolve; });
  const methods = new Promise(resolve => { releaseMethods = resolve; });
  await context.route('https://ui.mieweb.org/**', route => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>Ozwell focus regression</title><iframe title="ozwell" src="${apiOrigin}/widget/frame/"></iframe>`,
  }));
  await context.route(`${apiOrigin}/**`, async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/widget/frame/') return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><script>window.OZWELL_CONFIG=${JSON.stringify({ autoFocus, endpoint: `${apiOrigin}/v1/chat/completions` })};</script><script defer src="/widget/ozwell.js"></script>`,
    });
    if (pathname === '/widget/ozwell.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (pathname === '/auth/methods') {
      markMethodsRequested();
      return route.fulfill({ json: await methods });
    }
    if (pathname === '/auth/otp/request') return route.fulfill({ json: { challenge_id: 'local-focus-fixture' } });
    if (pathname === '/v1/keys/validate') return route.fulfill({ json: { valid: true, type: 'agent' } });
    if (pathname === '/v1/models/effective') return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404, body: 'Missing focus fixture' });
  });
  const page = await context.newPage();
  await page.goto('https://ui.mieweb.org/widget-focus');
  const frame = await (await page.locator('iframe').elementHandle()).contentFrame();
  await methodsRequested;
  await frame.getByRole('heading', { name: 'Sign in to Ozwell' }).waitFor();
  assert.equal(await frame.getByRole('textbox', { name: 'Email address' }).count(), 0,
    'The auth methods response must remain pending until the test releases it.');
  return {
    context, frame, errors,
    releaseMethods: (emailEnabled = true) => releaseMethods({ email_otp: emailEnabled, google: false, apple: false }),
    async close() {
      assert.deepEqual(errors, [], 'The actual widget must render without browser errors.');
      await context.close();
    },
  };
}

async function assertFocused(frame, label) {
  await frame.waitForFunction(label => document.activeElement?.getAttribute('aria-label') === label, label);
  assert.equal(await frame.getByLabel(label, { exact: true }).evaluate(input => document.activeElement === input), true);
}

// Two frames allow any queued mount callback to finish before negative checks.
const settleFocus = frame => frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const delayed = await fixture();
  delayed.releaseMethods();
  await assertFocused(delayed.frame, 'Email address');
  await delayed.frame.getByRole('tab', { name: 'Use my key' }).click();
  await assertFocused(delayed.frame, 'Ozwell API key');
  await delayed.frame.getByLabel('Remember on this device').click();
  await settleFocus(delayed.frame);
  assert.equal(await delayed.frame.getByLabel('Remember on this device').evaluate(input => document.activeElement === input), true,
    'An unrelated auth rerender must preserve focus on the remember checkbox.');
  await delayed.frame.getByRole('tab', { name: 'Email sign-in' }).click();
  await assertFocused(delayed.frame, 'Email address');
  await delayed.frame.getByLabel('Email address', { exact: true }).fill('focus@ui.mieweb.org');
  await delayed.frame.getByRole('button', { name: 'Send code', exact: true }).click();
  await assertFocused(delayed.frame, 'One-time code');
  await delayed.frame.getByRole('button', { name: 'Use a different email', exact: true }).click();
  await assertFocused(delayed.frame, 'Email address');
  await delayed.frame.getByRole('tab', { name: 'Use my key' }).click();
  await delayed.frame.getByLabel('Ozwell API key', { exact: true }).fill('agnt_key-local_focus_fixture');
  await delayed.frame.getByRole('button', { name: 'Use key', exact: true }).click();
  await delayed.frame.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await delayed.close();
  console.log('PASS: delayed auth methods, email/key tab changes, OTP stage, and authenticated composer focus.');

  for (const emailEnabled of [true, false]) {
    const respected = await fixture();
    await respected.frame.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'user-selected-input';
      document.body.appendChild(input);
      input.focus();
    });
    respected.releaseMethods(emailEnabled);
    await respected.frame.getByLabel(emailEnabled ? 'Email address' : 'Ozwell API key', { exact: true }).waitFor();
    await settleFocus(respected.frame);
    assert.equal(await respected.frame.evaluate(() => document.activeElement?.id), 'user-selected-input',
      'A late auth response must preserve another input the user selected.');
    await respected.close();
  }
  console.log('PASS: late email and key-only auth responses preserve user-selected focus elsewhere.');

  const disabled = await fixture({ autoFocus: false });
  disabled.releaseMethods();
  await disabled.frame.getByLabel('Email address', { exact: true }).waitFor();
  await settleFocus(disabled.frame);
  assert.equal(await disabled.frame.evaluate(() => document.activeElement?.tagName), 'BODY');
  await disabled.frame.getByRole('tab', { name: 'Use my key' }).click();
  await settleFocus(disabled.frame);
  assert.equal(await disabled.frame.getByRole('tab', { name: 'Use my key' }).evaluate(tab => document.activeElement === tab), true,
    'Embeds without autoFocus must keep their existing tab focus behavior.');
  await disabled.close();
  console.log('PASS: autoFocus=false preserves normal page and tab focus behavior.');
} finally {
  await browser.close();
}
