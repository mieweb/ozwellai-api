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
        headers: { 'content-security-policy': 'frame-ancestors * chrome-extension: safari-web-extension:;' },
        body: '<!doctype html><html><body><script defer src="../ozwell.js"></script></body></html>',
      });
    }
    if (url.pathname === '/widget/ozwell.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    if (url.pathname === '/auth/methods') return route.fulfill({ json: { email_otp: true, google: false, apple: false } });
    // Invented local credentials never reach a real API or issue a chat request.
    if (url.pathname === '/v1/keys/validate') return route.fulfill({ json: { valid: true, type: 'agent' } });
    if (url.pathname === '/v1/models/effective') return route.fulfill({ json: { data: [
      { provider: 'openai', model: 'gpt-5-mini', id: 'gpt-5-mini', label: 'gpt-5 mini' },
    ] } });
    if (url.pathname === '/v1/agents/me') return route.fulfill({ json: { id: 'fixture-agent', name: 'Local browser fixture' } });
    return route.fulfill({ status: 404, body: 'Missing fixture' });
  });
  await context.route('https://ui.mieweb.org/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><meta charset="utf-8"><title>MIE UI integration fixture</title><style>body{margin:0;padding:64px;font:16px system-ui;color:#101b46;background:#f5f7fc}header{display:flex;align-items:center;gap:12px;color:#0099c7;font-weight:650}h1{font-size:42px;letter-spacing:-1.5px;max-width:600px;margin:75px 0 18px}p{color:#71809c;max-width:560px;line-height:1.8}.card{margin-top:45px;max-width:650px;padding:28px;background:white;border:1px solid #e3e8f2;border-radius:16px}</style><header>MIE &middot; Interface workspace</header><h1>A little help, right where you work.</h1><p>This local browser fixture verifies ozwell on ui.mieweb.org. The extension serves chat from its configured widget origin.</p><div class="card">Open ozwell from the browser toolbar or the page launcher.</div>',
  }));
  await context.route('https://other.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Other</title><h1>Other page</h1>',
  }));

  const page = await context.newPage();
  await page.goto('https://ui.mieweb.org/');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://ui.mieweb.org/' }))[0].id);
  assert.equal(await page.locator('#ozwell-extension-root').count(), 0);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 420, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#power-button:enabled').waitFor();
  assert.equal(await popup.locator('h1').innerText(), 'ozwell');
  assert.equal(await popup.locator('#current-site').innerText(), 'ui.mieweb.org');
  async function toolbarWidget() {
    await popup.locator('#chat-container iframe').waitFor();
    const frame = await (await popup.locator('#chat-container iframe').elementHandle()).contentFrame();
    await frame.locator('input[type="email"]').waitFor({ timeout: 15000 });
    const widgetState = await frame.evaluate(() => window.OzwellDebug?.getState());
    assert.equal(widgetState.config.endpoint, WIDGET.endpoint);
    assert.deepEqual(widgetState.config.tools, []);
    assert.equal(await frame.locator('input[type="password"]').count(), 0, 'The initial sign-in requires no API key or password.');
    return frame;
  }
  const initialWidget = await toolbarWidget();
  assert(requests.includes('/widget/ozwell.js'), 'The toolbar runs the actual built ozwell widget.');
  assert.equal(await page.locator('#ozwell-extension-root').count(), 0, 'Toolbar chat is available without injecting the page launcher.');
  await mkdir(output, { recursive: true });
  await popup.screenshot({ path: path.join(output, 'toolbar-sign-in.png') });
  await initialWidget.getByRole('tab', { name: 'Use my key' }).click();
  await initialWidget.locator('input[type="password"]').fill('agnt_key-demo_local_browser_fixture');
  await initialWidget.getByRole('button', { name: 'Use key', exact: true }).click();
  await initialWidget.locator('textarea').waitFor();
  await initialWidget.getByText('Hi, I’m ozwell. What would you like to work on?', { exact: true }).waitFor();
  await initialWidget.waitForFunction(() => document.activeElement?.matches('textarea'));
  const screenshotPrompt = 'Help me get started with this page.';
  await initialWidget.locator('textarea').pressSequentially(screenshotPrompt, { delay: 40 });
  await initialWidget.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await initialWidget.locator('textarea').inputValue(), screenshotPrompt);
  assert.equal(requests.includes('/v1/chat/completions'), false, 'The screenshot prompt is typed without sending a chat request.');
  await popup.screenshot({ path: path.join(output, 'toolbar-chat.png') });

  async function savedSettings() {
    return worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  }
  async function saveMode(mode) {
    if (!await popup.locator('#settings-details').evaluate(details => details.open)) {
      await popup.locator('#settings-details > summary').click();
    }
    await popup.locator(`button[data-mode="${mode}"]`).click();
    await popup.locator('#save').click();
    await popup.getByText('Page settings saved.', { exact: true }).waitFor({ timeout: 5000 });
  }
  await popup.locator('#settings-details > summary').click();
  await popup.locator('button[data-mode="allowlist"]').click();
  await popup.locator('#domains').fill('ui.mieweb.org');
  await saveMode('allowlist');
  await page.locator('#ozwell-extension-root').waitFor();
  await popup.locator('#settings-details').screenshot({ path: path.join(output, 'toolbar-page-settings.png') });
  await popup.locator('#settings-details > summary').click();
  await popup.locator('#power-button').click();
  await popup.locator('#chat-container iframe').waitFor({ state: 'detached' });
  await popup.locator('#chat-empty').waitFor({ state: 'visible' });
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  assert.deepEqual(await savedSettings(), { mode: 'off', domains: ['ui.mieweb.org'], resumeMode: 'allowlist' });
  await popup.locator('#power-button[aria-pressed="false"]:enabled').waitFor();
  assert.equal(await popup.locator('#power-button').getAttribute('aria-pressed'), 'false');
  await popup.screenshot({ path: path.join(output, 'toolbar-off.png') });
  await popup.locator('#power-button:enabled').click();
  await toolbarWidget();
  await page.locator('#ozwell-extension-root').waitFor();
  assert.equal((await savedSettings()).mode, 'allowlist', 'Power restores the last enabled page mode immediately.');
  await saveMode('manual');
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  const frameRequestsBeforeToggle = requests.filter(request => request === '/widget/frame/').length;
  await popup.locator('#toggle-tab:enabled').click();
  await page.locator('#ozwell-extension-root').waitFor();
  assert.equal(requests.filter(request => request === '/widget/frame/').length, frameRequestsBeforeToggle, 'Showing the page launcher does not load a page frame.');
  await page.screenshot({ path: path.join(output, 'page-launcher.png') });

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
  await clickShadow('Open ozwell assistant');
  const widget = await widgetNavigation;
  await widget.locator('input[type="email"]').waitFor({ timeout: 15000 });
  assert(requests.includes('/widget/ozwell.js'), 'The frame runs the actual built Ozwell widget.');
  const widgetState = await widget.evaluate(() => window.OzwellDebug?.getState());
  assert.equal(widgetState.config.endpoint, WIDGET.endpoint);
  assert.deepEqual(widgetState.config.tools, []);
  await page.screenshot({ path: path.join(output, 'page-chat.png') });
  await clickShadow('Close ozwell assistant');
  assert.equal(page.frames().filter(frame => frame.url().includes('/widget/frame/')).length, 1, 'Closing preserves the widget session.');
  await page.evaluate(() => history.pushState({}, '', '/workspace'));
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  await popup.reload();
  await popup.locator('#power-button:enabled').waitFor();
  await toolbarWidget();
  await popup.locator('#settings-details > summary').click();
  await popup.locator('#toggle-tab:enabled').click();
  await page.locator('#ozwell-extension-root').waitFor();
  await page.reload();
  assert.equal(await page.locator('#ozwell-extension-root').count(), 0, 'On-demand mode resets on reload.');
  await saveMode('allowlist');
  await page.locator('#ozwell-extension-root').waitFor();
  await page.reload();
  await page.locator('#ozwell-extension-root').waitFor();
  const other = await context.newPage();
  await other.goto('https://other.test/');
  assert.equal(await other.locator('#ozwell-extension-root').count(), 0);
  await saveMode('always');
  await other.locator('#ozwell-extension-root').waitFor();
  await popup.locator('#power-button:enabled').click();
  await popup.locator('#chat-container iframe').waitFor({ state: 'detached' });
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  await other.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
  await popup.locator('#power-button:enabled').click();
  await toolbarWidget();
  await page.locator('#ozwell-extension-root').waitFor();
  await other.locator('#ozwell-extension-root').waitFor();
  assert.equal((await savedSettings()).mode, 'always');
  await popup.locator('#power-button:enabled').click();
  await popup.locator('#chat-container iframe').waitFor({ state: 'detached' });
  await page.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  await other.locator('#ozwell-extension-root').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('PASS: toolbar chat/sign-in, direct power/resume, page settings, lazy page chat, SPA/reload reset, all modes, and no browser errors.');
} finally {
  try {
    await context?.close();
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
