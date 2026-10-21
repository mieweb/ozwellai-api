// Optional real Chromium check; excluded from the dependency-free *.test.js suite.
// Build reference-server/embed/ozwell.js first with `npm --prefix reference-server run build:widget`.
// Uses landing-page's Playwright, or an installed module at PLAYWRIGHT_MODULE_PATH.
// CHROMIUM_EXECUTABLE_PATH selects a browser; OZWELL_WIDGET_BUNDLE selects a built widget.
// Set OZWELL_SMOKE_OUTPUT_DIR to preserve screenshots outside the temporary fixture.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WIDGET } from '../config.js';

const extensionSource = fileURLToPath(new URL('../', import.meta.url));
const repository = fileURLToPath(new URL('../../', import.meta.url));
const resolvePath = value => path.resolve(repository, value);
const runtimeRequire = createRequire(new URL('../../landing-page/package.json', import.meta.url));
let playwright;
try {
  const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
  const entry = runtimeRequire.resolve(modulePath ? resolvePath(modulePath) : 'playwright');
  playwright = await import(pathToFileURL(entry).href);
} catch (cause) {
  throw new Error('Install landing-page dependencies or set PLAYWRIGHT_MODULE_PATH to an installed Playwright module.', { cause });
}
const { chromium } = playwright.default || playwright;
const bundlePath = process.env.OZWELL_WIDGET_BUNDLE
  ? resolvePath(process.env.OZWELL_WIDGET_BUNDLE)
  : fileURLToPath(new URL('../../reference-server/embed/ozwell.js', import.meta.url));
let bundle;
try {
  bundle = await readFile(bundlePath);
} catch (cause) {
  throw new Error('Build the Ozwell widget with `npm --prefix reference-server run build:widget`, or set OZWELL_WIDGET_BUNDLE.', { cause });
}

const fixture = await mkdtemp(path.join(tmpdir(), 'ozwell-extension-browser-'));
const extension = path.join(fixture, 'extension');
const output = process.env.OZWELL_SMOKE_OUTPUT_DIR
  ? resolvePath(process.env.OZWELL_SMOKE_OUTPUT_DIR)
  : path.join(fixture, 'screenshots');
let context;

try {
  await cp(extensionSource, extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Pregrant hosts in this temporary copy only so headless Chrome never needs a
  // permission dialog. This exercises the real popup request API and mode policy,
  // but does not validate manual permission-prompt acceptance or activeTab grants.
  // The wildcard scheme matches the popup's exact-host permission requests.
  manifest.host_permissions = ['*://*/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(fixture, 'profile'), {
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: resolvePath(process.env.CHROMIUM_EXECUTABLE_PATH) }
      : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const requests = [];
  await context.route(`${WIDGET.origin}/**`, async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.pathname === '/widget/frame/') {
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><script defer src="../ozwell.js"></script></body></html>',
      });
    }
    if (url.pathname === '/widget/ozwell.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/auth/methods') return route.fulfill({ json: { email_otp: true, google: false, apple: false } });
    return route.fulfill({ status: 404, body: 'Missing fixture' });
  });
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Example</title><h1>Example page</h1><p>Minimal extension integration fixture.</p>',
  }));
  await context.route('https://other.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Other</title><h1>Other page</h1>',
  }));

  const page = await context.newPage();
  await page.goto('https://example.test/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://example.test/' }))[0].id);
  assert.equal(await page.locator('#ozwell-extension-root').count(), 0);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#mode:enabled').waitFor();
  assert.equal(await popup.locator('#current-site').innerText(), 'example.test');
  await popup.locator('#toggle-tab').click();
  await page.locator('#ozwell-extension-root').waitFor();
  assert.equal(requests.length, 0, 'The hosted frame loads only when the launcher opens.');

  // The launcher deliberately uses a closed shadow root. CDP clicks its visible
  // controls while preserving that production encapsulation.
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  async function clickShadow(label) {
    const { nodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
    const node = nodes.find(candidate => candidate.attributes?.some((value, index, attributes) =>
      value === 'aria-label' && attributes[index + 1] === label));
    assert(node, `Missing visible control: ${label}`);
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
    await page.mouse.click((model.content[0] + model.content[2]) / 2, (model.content[1] + model.content[5]) / 2);
  }
  const widgetNavigation = page.waitForEvent('framenavigated', {
    predicate: frame => frame.url().startsWith(`${WIDGET.origin}/widget/frame/`),
    timeout: 15000,
  });
  await clickShadow('Open Ozwell assistant');
  const widget = await widgetNavigation;
  await widget.getByPlaceholder('you@example.com').waitFor({ timeout: 15000 });
  assert(requests.includes('/widget/ozwell.js'), 'The frame runs the actual built Ozwell widget.');
  const widgetState = await widget.evaluate(() => window.OzwellDebug?.getState());
  assert.equal(widgetState.config.endpoint, WIDGET.endpoint);
  assert.deepEqual(widgetState.config.tools, []);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'widget.png') });
  await popup.screenshot({ path: path.join(output, 'popup.png') });
  await clickShadow('Close Ozwell assistant');
  assert.equal(page.frames().filter(frame => frame.url().includes('/widget/frame/')).length, 1, 'Closing preserves the widget session.');
  await page.reload();
  assert.equal(await page.locator('#ozwell-extension-root').count(), 0, 'On-demand mode resets on reload.');

  async function saveMode(mode) {
    await popup.locator('#mode').selectOption(mode);
    await popup.locator('#save').click();
    await popup.getByText('Settings saved.', { exact: true }).waitFor({ timeout: 5000 });
  }
  await popup.reload();
  await popup.locator('#mode:enabled').waitFor();
  await popup.locator('#mode').selectOption('allowlist');
  await popup.locator('#domains').fill('example.test');
  await saveMode('allowlist');
  await page.locator('#ozwell-extension-root').waitFor();
  await page.reload();
  await page.locator('#ozwell-extension-root').waitFor();
  const other = await context.newPage();
  await other.goto('https://other.test/');
  assert.equal(await other.locator('#ozwell-extension-root').count(), 0);
  await saveMode('always');
  await other.locator('#ozwell-extension-root').waitFor();
  await saveMode('off');
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  await other.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
  assert.deepEqual(errors, []);
  console.log('PASS: MV3 popup, lazy hosted widget sign-in/config, close/reload, allowlist, always, off, and no browser errors.');
} finally {
  try {
    await context?.close();
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
