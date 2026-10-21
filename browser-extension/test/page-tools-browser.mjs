// Real DOM/controller checks; run with the same Playwright/browser overrides as browser-smoke.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(new URL('../../landing-page/package.json', import.meta.url));
const entry = require.resolve(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { chromium } = await import(pathToFileURL(entry).href);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : { channel: 'chromium' }),
});
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const fixture = `<!doctype html><title>MIE page control fixture</title><style>body{font:16px system-ui}label{display:block;margin:12px}.spacer{height:1500px}</style>
<h1>MIE page control fixture</h1>
<button type="button" id="increment">Increment</button><output id="count">0</output>
<label>Message<input id="message" value="ordinary-value-not-shared"></label>
<label>Notes<textarea id="notes">ordinary-notes-not-shared</textarea></label>
<label>Owner<select id="owner"><option>Alex</option><option>Sam</option><option disabled>Unavailable</option></select></label>
<label>Secret<input id="password" type="password" value="password-must-not-appear"></label>
<label>API key<input id="api-key" value="key-must-not-appear"></label>
<label>Code<input id="otp" autocomplete="one-time-code" value="123456-secret-code"></label>
<div data-ozwell-private>private-subtree-must-not-appear<button type="button" id="private">Private button</button></div>
<div id="ozwell-extension-root">assistant-must-not-appear<button type="button">Assistant</button></div>
<iframe srcdoc="embedded-must-not-appear"></iframe>
<label>Read only<input id="readonly" readonly value="cannot-edit"></label>
<label>Disabled<input id="disabled" disabled></label>
<form><button id="submit">Submit form</button></form>
<a id="navigation" href="/other">Navigate</a>
<div class="spacer"></div><button type="button" id="bottom">Bottom control</button>
<script>document.querySelector('#increment').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);</script>`;

try {
  await page.route('https://ui.mieweb.org/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://ui.mieweb.org/page?token=URL-secret-must-not-appear#private-fragment');
  await page.addScriptTag({ content: await readFile(new URL('../vendor/page-controller.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('../page-tools.js', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.authorized = true;
    window.tools = window.__ozwellCreatePageTools({ isAuthorized: () => window.authorized });
  });
  const call = (name, args = {}) => page.evaluate(({ name, args }) => window.tools.callTool(name, args), { name, args });
  const read = result => {
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const snapshot = async () => read(await call('browser_snapshot'));
  const index = (state, id) => {
    const line = state.content.split('\n').find(value => value.includes(`id=${id} `) || value.includes(`id=${id}>`) || value.includes(`id=${id} />`));
    assert.ok(line, `Expected indexed control ${id}: ${state.content}`);
    return Number(line.match(/\[(\d+)\]/)[1]);
  };
  const error = result => { assert.equal(result.isError, true); return JSON.parse(result.content[0].text).error; };
  let state = await snapshot();
  assert.equal(state.url, 'https://ui.mieweb.org/page');
  for (const secret of ['URL-secret', 'private-fragment', 'password-must', 'key-must', '123456-secret', 'private-subtree', 'assistant-must', 'embedded-must', 'ordinary-value-not-shared', 'ordinary-notes-not-shared']) assert.ok(!JSON.stringify(state).includes(secret), `Snapshot disclosed ${secret}`);
  assert.equal(await page.locator('[id^="page-agent-runtime_"]').count(), 0, 'Zero-opacity extraction must not draw controller overlays.');
  assert.equal(await page.locator('#message').inputValue(), 'ordinary-value-not-shared', 'Snapshot redaction must not alter the page.');
  assert.equal(await page.locator('#notes').inputValue(), 'ordinary-notes-not-shared');

  const old = state;
  state = read(await call('browser_click', { snapshotId: state.snapshotId, index: index(state, 'increment') }));
  assert.equal(await page.locator('#count').innerText(), '1');
  assert.match(error(await call('browser_click', { snapshotId: old.snapshotId, index: index(old, 'increment') })), /Stale snapshot/);
  state = read(await call('browser_fill', { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'A new message' }));
  assert.equal(await page.locator('#message').inputValue(), 'A new message');
  state = read(await call('browser_fill', { snapshotId: state.snapshotId, index: index(state, 'notes'), value: 'Fresh notes' }));
  assert.equal(await page.locator('#notes').inputValue(), 'Fresh notes');
  state = read(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, 'owner'), value: 'Sam' }));
  assert.equal(await page.locator('#owner').inputValue(), 'Sam');
  assert.match(error(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, 'owner'), value: 'Unavailable' })), /unavailable/);
  assert.ok(!state.content.includes('id=disabled'), 'Disabled controls are not indexed.');
  for (const id of ['readonly', 'submit', 'navigation']) {
    state = await snapshot();
    assert.match(error(await call('browser_click', { snapshotId: state.snapshotId, index: index(state, id) })), /unavailable|blocked/);
  }
  assert.match(error(await call('executeJavascript', {})), /Unknown page tool/);
  assert.match(error(await call('browser_snapshot', { extra: true })), /Invalid tool arguments/);
  state = await snapshot();
  assert.match(error(await call('browser_fill', { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'x'.repeat(4001) })), /Invalid field value/);
  assert.match(error(await call('browser_scroll', { snapshotId: state.snapshotId, direction: 'down', amount: 2001 })), /Invalid scroll arguments/);

  // A real input event invalidates references before any action can commit.
  state = await snapshot();
  await page.locator('#message').fill('A manual edit');
  assert.match(error(await call('browser_fill', { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'must-not-overwrite' })), /Stale snapshot/);
  assert.equal(await page.locator('#message').inputValue(), 'A manual edit');

  // Cancellation/disposal during the preview prevents current and queued mutations.
  state = await snapshot();
  const fillArgs = { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'cancelled-value' };
  const cancelled = await page.evaluate(async args => {
    const abort = new AbortController();
    const result = window.tools.callTool('browser_fill', args, { signal: abort.signal });
    setTimeout(() => abort.abort(), 30);
    return result;
  }, fillArgs);
  assert.match(error(cancelled), /stopped/);
  assert.equal(await page.locator('#message').inputValue(), 'A manual edit');
  const revoked = await page.evaluate(async args => {
    const result = window.tools.callTool('browser_fill', args);
    setTimeout(() => { window.authorized = false; }, 30);
    return result;
  }, fillArgs);
  assert.match(error(revoked), /not enabled/);
  assert.equal(await page.locator('#message').inputValue(), 'A manual edit');
  await page.evaluate(() => { window.authorized = true; });
  const stopped = await page.evaluate(async args => {
    const first = window.tools.callTool('browser_fill', args);
    const second = window.tools.callTool('browser_fill', args);
    setTimeout(() => window.tools.dispose(), 30);
    return Promise.all([first, second]);
  }, fillArgs);
  stopped.forEach(result => assert.match(error(result), /stopped/));
  assert.equal(await page.locator('#message').inputValue(), 'A manual edit');
  assert.equal(await page.locator('[data-ozwell-owned="action-preview"]').count(), 0);

  await page.evaluate(() => { window.tools = window.__ozwellCreatePageTools({ isAuthorized: () => window.authorized }); });
  state = await snapshot();
  await page.evaluate(() => { window.authorized = false; });
  assert.match(error(await call('browser_click', { snapshotId: state.snapshotId, index: index(state, 'increment') })), /not enabled/);
  await page.evaluate(() => { window.authorized = true; });
  state = await snapshot();
  const scrollBefore = await page.evaluate(() => scrollY);
  state = read(await call('browser_scroll', { snapshotId: state.snapshotId, direction: 'down', amount: 400 }));
  assert.ok(await page.evaluate(() => scrollY) > scrollBefore);
  await page.evaluate(() => history.pushState({}, '', '/changed?private=query'));
  assert.match(error(await call('browser_snapshot')), /page changed/i);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Page tools passed in actual Chromium: redaction, URL sanitization, click/fill/select/scroll, stale references, guards, cancellation, disposal, authorization, navigation.');
} finally { await browser.close(); }
