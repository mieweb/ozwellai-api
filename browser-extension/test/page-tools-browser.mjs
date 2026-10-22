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
<label>Duplicate disabled owner<select id="duplicate-disabled"><option value="shared" disabled>Disabled owner</option><option value="shared">Requested owner</option><option value="initial" selected>Initial owner</option></select></label>
<label>Duplicate label owner<select id="duplicate-label"><option value="shared">Different owner</option><option value="shared">Requested owner</option><option value="initial" selected>Initial owner</option></select></label>
<label>Hidden duplicate label<select id="hidden-option"><option value="hidden" hidden>Sam</option><option value="visible">Sam</option><option value="initial" selected>Initial owner</option></select></label>
<label>Disabled duplicate label<select id="disabled-option"><option value="disabled" disabled>Sam</option><option value="visible">Sam</option><option value="initial" selected>Initial owner</option></select></label>
<label>Hidden group duplicate label<select id="hidden-group"><optgroup label="Hidden" style="display:none"><option value="hidden">Sam</option></optgroup><option value="visible">Sam</option><option value="initial" selected>Initial owner</option></select></label>
<label>Disabled group duplicate label<select id="disabled-group"><optgroup label="Disabled" disabled><option value="disabled">Sam</option></optgroup><option value="visible">Sam</option><option value="initial" selected>Initial owner</option></select></label>
<label>Transparent duplicate label<select id="transparent-option"><option value="hidden" style="opacity:0">Sam</option><option value="visible">Sam</option><option value="initial" selected>Initial owner</option></select></label>
<label>Explicit option label<select id="explicit-label"><option value="initial" selected>Initial owner</option><option label="Sam" value="visible">internal-owner</option></select></label>
<label>Unavailable hidden label<select id="hidden-only"><option value="hidden" hidden>Hidden only</option><option value="initial" selected>Initial owner</option></select></label>
<label>Overridden owner<select id="overridden"><option value="shared">Original owner</option><option value="shared">Requested owner</option></select></label>
<div style="visibility:hidden"><button type="button" id="restored-visibility" style="visibility:visible">Restored visibility action</button></div>
<div style="display:contents"><button type="button" id="contents-ancestor">Display contents action</button></div>
<div id="slotted-host"><button type="button" id="slotted-control" slot="controls">Slotted control</button></div>
<section id="inert-section" inert><div><label>Inert message<input id="inert-message" value="inert-original"></label><button type="button" id="inert-action">Inert action</button><label>Inert owner<select id="inert-owner"><option>Alex</option><option>Sam</option></select></label></div></section>
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
<script>document.querySelector('#increment').onclick=()=>document.querySelector('#count').textContent=String(Number(document.querySelector('#count').textContent)+1);document.querySelector('#slotted-host').attachShadow({mode:'open'}).innerHTML='<div id="slot-ancestor"><slot name="controls"></slot></div>';</script>`;

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
  // Visible labels identify an option even when its value matches another option.
  for (const id of ['duplicate-disabled', 'duplicate-label']) {
    state = await snapshot();
    state = read(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, id), value: 'Requested owner' }));
    assert.deepEqual(await page.locator(`#${id}`).evaluate(element => ({ index: element.selectedIndex, label: element.selectedOptions[0].textContent })), { index: 1, label: 'Requested owner' });
  }
  // Hidden/disabled predecessors must not shadow an available visible label.
  for (const id of ['hidden-option', 'disabled-option', 'hidden-group', 'disabled-group', 'transparent-option', 'explicit-label']) {
    state = await snapshot();
    state = read(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, id), value: 'Sam' }));
    assert.deepEqual(await page.locator(`#${id}`).evaluate(element => ({ index: element.selectedIndex, label: element.selectedOptions[0].label, value: element.value })), { index: 1, label: 'Sam', value: 'visible' });
  }
  state = await snapshot();
  assert.match(error(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, 'hidden-only'), value: 'Hidden only' })), /unavailable/);
  assert.equal(await page.locator('#hidden-only').inputValue(), 'initial');
  // Restored CSS visibility and display:contents ancestors still render controls.
  await page.evaluate(() => {
    window.visibleClicks = [];
    for (const id of ['restored-visibility', 'contents-ancestor']) document.querySelector(`#${id}`).onclick = () => window.visibleClicks.push(id);
  });
  for (const id of ['restored-visibility', 'contents-ancestor']) {
    state = await snapshot();
    state = read(await call('browser_click', { snapshotId: state.snapshotId, index: index(state, id) }));
  }
  assert.deepEqual(await page.evaluate(() => window.visibleClicks), ['restored-visibility', 'contents-ancestor']);
  // A slot's rendering ancestor lives outside the body's mutation observer.
  state = await snapshot();
  const hiddenSlot = await page.evaluate(async args => {
    const ancestor = document.querySelector('#slotted-host').shadowRoot.querySelector('#slot-ancestor');
    ancestor.style.opacity = '0';
    try { return await window.tools.callTool('browser_click', args); }
    finally { ancestor.style.opacity = ''; }
  }, { snapshotId: state.snapshotId, index: index(state, 'slotted-control') });
  assert.match(error(hiddenSlot), /not visible/);
  // Matching values are insufficient evidence that input/change handlers kept the requested option.
  for (const event of ['input', 'change']) {
    await page.locator('#overridden').evaluate((element, event) => {
      element.oninput = element.onchange = null;
      element.selectedIndex = 0;
      element[`on${event}`] = () => { element.selectedIndex = 0; };
    }, event);
    state = await snapshot();
    assert.match(error(await call('browser_select', { snapshotId: state.snapshotId, index: index(state, 'overridden'), value: 'Requested owner' })), /did not retain the requested option/);
    assert.equal(await page.locator('#overridden').evaluate(element => element.selectedIndex), 0);
  }
  // Native programmatic APIs can mutate inert descendants, so the action guard must reject them.
  await page.evaluate(() => {
    window.inertEvents = [];
    for (const event of ['click', 'focus', 'input', 'change']) document.querySelector('#inert-section').addEventListener(event, () => window.inertEvents.push(event), true);
  });
  for (const [name, id, value] of [['browser_fill', 'inert-message', 'must-not-fill'], ['browser_click', 'inert-action'], ['browser_select', 'inert-owner', 'Sam']]) {
    state = await snapshot();
    assert.match(error(await call(name, { snapshotId: state.snapshotId, index: index(state, id), ...(value === undefined ? {} : { value }) })), /unavailable|inert/);
  }
  assert.equal(await page.locator('#inert-message').inputValue(), 'inert-original');
  assert.equal(await page.locator('#inert-owner').inputValue(), 'Alex');
  assert.deepEqual(await page.evaluate(() => window.inertEvents), []);
  // The document ancestor lies outside the observed body; changing it during preview must still revoke the action.
  state = await snapshot();
  const inertDuringPreview = await page.evaluate(async args => {
    const previewStarted = new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-ozwell-owned="action-preview"]')) { observer.disconnect(); resolve(); }
      });
      observer.observe(document.documentElement, { childList: true });
    });
    const result = window.tools.callTool('browser_fill', args);
    await previewStarted;
    document.documentElement.inert = true;
    try { return await result; }
    finally { document.documentElement.inert = false; }
  }, { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'must-not-fill-during-inert' });
  assert.match(error(inertDuringPreview), /unavailable|inert/);
  assert.equal(await page.locator('#message').inputValue(), 'A new message');
  // html is outside the observed body. Its CSS can hide an indexed control
  // without changing its fingerprint or snapshot revision.
  for (const [property, value] of [['opacity', '0'], ['display', 'none'], ['contentVisibility', 'hidden']]) {
    state = await snapshot();
    const hiddenBeforeAction = await page.evaluate(async ({ args, property, value }) => {
      const original = document.documentElement.style[property];
      document.documentElement.style[property] = value;
      try { return await window.tools.callTool('browser_fill', args); }
      finally { document.documentElement.style[property] = original; }
    }, { args: { snapshotId: state.snapshotId, index: index(state, 'message'), value: 'must-not-fill-hidden' }, property, value });
    assert.match(error(hiddenBeforeAction), /not visible/);
    assert.equal(await page.locator('#message').inputValue(), 'A new message');
  }
  // Recheck composed ancestor visibility after the 150ms action preview for
  // every mutating control, before any click, focus, input, or change event.
  await page.evaluate(() => {
    window.hiddenActionEvents = [];
    for (const event of ['click', 'focus', 'input', 'change']) document.addEventListener(event, () => window.hiddenActionEvents.push(event), true);
  });
  for (const [name, id, value] of [['browser_click', 'increment'], ['browser_fill', 'message', 'must-not-fill-preview'], ['browser_select', 'owner', 'Alex']]) {
    state = await snapshot();
    const hiddenDuringPreview = await page.evaluate(async ({ name, args }) => {
      const previewStarted = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('[data-ozwell-owned="action-preview"]')) { observer.disconnect(); resolve(); }
        });
        observer.observe(document.documentElement, { childList: true });
      });
      const result = window.tools.callTool(name, args);
      await previewStarted;
      document.documentElement.style.opacity = '0';
      try { return await result; }
      finally { document.documentElement.style.opacity = ''; }
    }, { name, args: { snapshotId: state.snapshotId, index: index(state, id), ...(value === undefined ? {} : { value }) } });
    assert.match(error(hiddenDuringPreview), /not visible/);
  }
  assert.equal(await page.locator('#count').innerText(), '1');
  assert.equal(await page.locator('#message').inputValue(), 'A new message');
  assert.equal(await page.locator('#owner').inputValue(), 'Sam');
  assert.deepEqual(await page.evaluate(() => window.hiddenActionEvents), []);
  state = await snapshot();
  assert.doesNotMatch(state.content, /\bid=disabled(?:\s|>)/, 'Disabled controls are not indexed.');
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
  console.log('Page tools passed in actual Chromium: redaction, URL sanitization, click/fill/select/scroll, visible enabled option labels, duplicate option values, selection postconditions, inert/rendering ancestors before/during preview, restored visibility, stale references, guards, cancellation, disposal, authorization, navigation.');
} finally { await browser.close(); }
