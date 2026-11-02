// Real loaded-extension regression for remote-widget reloads. All website/API
// responses are local fixtures on ui.mieweb.org and the configured widget origin.
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WIDGET } from '../config.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const runtimeRequire = createRequire(new URL('../../landing-page/package.json', import.meta.url));
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
const entry = runtimeRequire.resolve(modulePath ? path.resolve(repository, modulePath) : 'playwright');
const playwright = await import(pathToFileURL(entry).href);
const { chromium } = playwright.default || playwright;
const bundle = await readFile(process.env.OZWELL_WIDGET_BUNDLE
  ? path.resolve(repository, process.env.OZWELL_WIDGET_BUNDLE)
  : new URL('../../reference-server/embed/ozwell.js', import.meta.url));
const fixture = await mkdtemp(path.join(tmpdir(), 'ozwell-widget-reload-'));
const extension = path.join(fixture, 'extension');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let context;
let holdBundle, activeGate;
try {
  await cp(new URL('../', import.meta.url), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.host_permissions = ['*://*/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(fixture, 'profile'), {
    ...(process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: path.resolve(repository, process.env.CHROMIUM_EXECUTABLE_PATH) }
      : { channel: 'chromium' }),
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.addInitScript(() => {
    window.__reloadReplies = [];
    addEventListener('message', event => {
      if (event.source !== parent) return;
      if (typeof event.data?.ozwellDocumentId === 'string') window.__reloadDocumentId = event.data.ozwellDocumentId;
      if (event.data?.jsonrpc === '2.0') window.__reloadReplies.push(event.data);
    });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
  let chatRequests = 0;
  await context.route(`${WIDGET.origin}/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/widget/frame/') return route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': 'frame-ancestors * chrome-extension: safari-web-extension:;' },
      body: '<!doctype html><html><body><script defer src="../ozwell.js"></script></body></html>',
    });
    if (pathname === '/widget/ozwell.js') {
      if (holdBundle) {
        const gate = holdBundle;
        holdBundle = undefined;
        gate.requested.resolve();
        await gate.release.promise;
      }
      return route.fulfill({ contentType: 'text/javascript', body: bundle });
    }
    if (pathname === '/auth/methods') return route.fulfill({ json: { email_otp: true, google: false, apple: false } });
    if (pathname === '/v1/chat/completions') chatRequests++;
    return route.fulfill({ status: 404, body: 'No live API request in this fixture' });
  });
  await context.route('https://ui.mieweb.org/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <title>MIE widget reload fixture</title><h1>Widget reload</h1>
    <label>Page note<input id="page-note" value="unchanged"></label>
    <button type="button" id="increment">Activate</button>` }));
  const page = await context.newPage();
  await page.goto('https://ui.mieweb.org/widget-reload-fixture');
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://ui.mieweb.org/widget-reload-fixture' }))[0].id);
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/popup.html`);
  await worker.evaluate(id => chrome.tabs.update(id, { active: true }), tabId);
  await popup.reload();
  await popup.locator('#power-button:enabled').waitFor();
  await widgetFor(popup);

  // Observe the real isolated factory without replacing its actions or timers.
  // This makes cancellation/factory disposal explicit, instead of relying only
  // on a field remaining unchanged while its action might still be queued.
  await worker.evaluate(id => chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, func: () => {
    const original = globalThis.__ozwellCreatePageTools;
    globalThis.__reloadFactories = [];
    globalThis.__ozwellCreatePageTools = options => {
      const factory = original(options);
      const record = { disposed: false, calls: [] };
      globalThis.__reloadFactories.push(record);
      return { ...factory,
        callTool(name, args, options) { record.calls.push({ name, signal: options?.signal }); return factory.callTool(name, args, options); },
        dispose() { record.disposed = true; factory.dispose(); },
      };
    };
  } }), tabId);
  const nativeState = () => worker.evaluate(async id => (await chrome.scripting.executeScript({
    target: { tabId: id, frameIds: [0] }, func: () => globalThis.__reloadFactories.map(record => ({
      disposed: record.disposed, calls: record.calls.map(call => ({ name: call.name, aborted: Boolean(call.signal?.aborted) })),
    })),
  }))[0].result, tabId);

  async function widgetFor(owner) {
    const deadline = Date.now() + 15000;
    let child;
    do {
      child = owner.frames().find(frame => frame.url().startsWith(`${WIDGET.origin}/widget/frame/`));
      if (child) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert(child, 'The actual widget iframe must exist.');
    await child.waitForFunction(() => window.OzwellDebug?.getState()?.config.tools?.length === 5 && !!window.__reloadDocumentId);
    return child;
  }
  async function send(frame, id, name, args = {}) {
    await frame.evaluate(({ id, name, args, origin }) => parent.postMessage({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: `postMessage_browser_${name}`, arguments: args },
      ozwellDocumentId: window.__reloadDocumentId,
    }, origin), { id, name, args, origin: extensionOrigin });
  }
  async function response(frame, id) {
    await frame.waitForFunction(id => window.__reloadReplies.some(reply => reply.id === id), id);
    return frame.evaluate(id => window.__reloadReplies.find(reply => reply.id === id), id);
  }
  async function call(frame, id, name, args) { await send(frame, id, name, args); return response(frame, id); }
  const snapshot = reply => {
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    assert.notEqual(reply.result.isError, true, reply.result.content?.[0]?.text);
    return JSON.parse(reply.result.content[0].text);
  };
  const fillArgs = (state, value) => {
    const line = state.content.split('\n').find(line => /id=page-note(?: |>|$)/.test(line));
    assert(line, state.content);
    return { snapshotId: state.snapshotId, index: Number(line.match(/\[(\d+)\]/)[1]), value };
  };

  async function verifyReload(owner, label) {
    let widget = await widgetFor(owner);
    const oldDocumentId = await widget.evaluate(() => window.__reloadDocumentId);
    const state = snapshot(await call(widget, 3, 'snapshot'));
    // First reconnect through a BFCache-style lifecycle so the observed native
    // wrapper owns this session, including the initially connected popup.
    await widget.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await widget.waitForFunction(oldId => window.__reloadDocumentId !== oldId && window.OzwellDebug?.getState()?.config.tools?.length === 5, oldDocumentId);
    const beforeReloadId = await widget.evaluate(() => window.__reloadDocumentId);
    const beforeReload = snapshot(await call(widget, 30, 'snapshot'));
    assert.notEqual(state.snapshotId, beforeReload.snapshotId, 'BFCache restoration starts a new factory.');

    await page.evaluate(() => {
      window.__reloadPreview = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (!document.querySelector('[data-ozwell-owned="action-preview"]')) return;
          clearTimeout(timer); observer.disconnect(); resolve(true);
        });
        const timer = setTimeout(() => { observer.disconnect(); resolve(false); }, 5000);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    });
    await send(widget, 4, 'fill', fillArgs(beforeReload, `${label}-must-not-commit`));
    assert.equal(await page.evaluate(() => window.__reloadPreview), true, 'The native fill must reach its actual preview.');
    const gate = { requested: deferred(), release: deferred() };
    activeGate = gate;
    holdBundle = gate;
    // Load a new real widget document, holding its JavaScript so we can verify
    // early pagehide cancellation before its replacement sends ready.
    await widget.evaluate(() => { location.reload(); });
    await gate.requested.promise;
    let duringReload;
    const cancelDeadline = Date.now() + 1000;
    do {
      duringReload = await nativeState();
      if (duringReload.some(factory => factory.disposed && factory.calls.some(call => call.name === 'browser_fill' && call.aborted))) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < cancelDeadline);
    assert(duringReload.some(factory => factory.disposed && factory.calls.some(call => call.name === 'browser_fill' && call.aborted)), `${label}: old native action and factory must be cancelled before replacement readiness: ${JSON.stringify(duringReload)}`);
    assert.equal(await page.locator('#page-note').inputValue(), 'unchanged');
    gate.release.resolve();
    activeGate = undefined;
    await widget.waitForLoadState('load');
    widget = await widgetFor(owner);
    const newDocumentId = await widget.evaluate(() => window.__reloadDocumentId);
    assert.notEqual(newDocumentId, beforeReloadId);
    assert.deepEqual(await widget.evaluate(() => window.__reloadReplies.filter(reply => reply.id === 4)), [], 'No old response reaches the new document.');
    // Delayed messages from the old document cannot retire/reactivate the new
    // session or reserve its request ID. Missing tokens cannot downgrade it.
    await widget.evaluate(({ oldId, origin }) => {
      for (const type of ['ready', 'request-config', 'pagehide']) parent.postMessage({ source: 'ozwell-chat-widget', type, ozwellDocumentId: oldId }, origin);
      parent.postMessage({ source: 'ozwell-chat-widget', type: 'ready' }, origin);
      parent.postMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' }, ozwellDocumentId: oldId }, origin);
    }, { oldId: beforeReloadId, origin: extensionOrigin });
    const fresh = snapshot(await call(widget, 4, 'snapshot'));
    assert.notEqual(fresh.snapshotId, beforeReload.snapshotId);
    assert.equal((await widget.evaluate(() => window.__reloadReplies.filter(reply => reply.id === 4))).length, 1, 'Reused ID resolves exactly once for the new document.');
    const stale = await call(widget, 5, 'fill', fillArgs(beforeReload, 'stale-snapshot-must-not-commit'));
    assert.equal(stale.result.isError, true, 'Old snapshot tokens must be invalid in the new factory.');
    snapshot(await call(widget, 6, 'fill', fillArgs(fresh, `${label}-fresh-fill`)));
    assert.equal(await page.locator('#page-note').inputValue(), `${label}-fresh-fill`);
    await page.locator('#page-note').fill('unchanged');
    console.log(`PASS: ${label} widget reload aborts native fill, rotates factory/snapshots, ignores old packets and allows reused MCP IDs; BFCache handshake recovers.`);
  }
  await verifyReload(popup, 'toolbar');
  await popup.locator('summary').click();
  await popup.locator('#toggle-tab:enabled').click();
  // The content script fetches its state after asynchronous script injection.
  await page.locator('#ozwell-extension-root').waitFor({ state: 'attached' });
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  const { nodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
  const launcher = nodes.find(node => node.attributes?.some((value, index, attributes) => value === 'aria-label' && attributes[index + 1] === 'Open ozwell assistant'));
  assert(launcher, 'The page launcher must be present.');
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: launcher.nodeId });
  await page.mouse.click((model.content[0] + model.content[2]) / 2, (model.content[1] + model.content[5]) / 2);
  await verifyReload(page, 'page-host');
  assert.equal(chatRequests, 0, 'No model prompt or live API request is used.');
  assert.deepEqual(errors, []);
} finally {
  holdBundle?.release.resolve();
  activeGate?.release.resolve();
  await context?.close();
  await rm(fixture, { recursive: true, force: true });
}
