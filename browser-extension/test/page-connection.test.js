import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageConnection } from '../page-connection.js';

const url = 'https://ui.mieweb.org/workspace?mode=local';
const tools = [{ name: 'browser_snapshot' }, { name: 'browser_fill' }];
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { currentUrl = url, tabId = 42, getTab } = {}) {
  const originals = { setTimeout, clearTimeout };
  const timers = new Map(), messages = [], state = [], injections = [], connections = [];
  const listeners = { message: [], disconnect: [] };
  let disconnectCount = 0;
  globalThis.setTimeout = (callback, duration) => { const id = Symbol(); timers.set(id, { callback, duration }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  t.after(() => Object.assign(globalThis, originals));
  const port = {
    onMessage: { addListener: listener => listeners.message.push(listener) },
    onDisconnect: { addListener: listener => listeners.disconnect.push(listener) },
    postMessage: message => messages.push(message),
    disconnect() { disconnectCount++; },
  };
  const api = {
    tabs: {
      get: getTab || (async id => { assert.equal(id, tabId); return { id, url: currentUrl }; }),
      connect: (id, options) => { connections.push({ id, options }); return port; },
    },
    scripting: { executeScript: async options => injections.push(options) },
  };
  const connection = createPageConnection(tabId, url, { api, onStateChange: value => state.push(value) });
  const receive = message => listeners.message.forEach(listener => listener(message));
  const ready = () => receive({ type: 'ready', session: 'session-A', url, tools });
  return { connection, timers, messages, state, injections, connections, receive, ready, listeners, get disconnectCount() { return disconnectCount; } };
}

test('popup connection pins a captured tab, URL and main frame before exposing content tools', async t => {
  const page = fixture(t);
  await settle();
  assert.deepEqual(page.injections, [{ target: { tabId: 42, frameIds: [0] }, files: ['vendor/page-controller.js', 'page-tools.js', 'mcp-bridge.js', 'content-script.js'] }]);
  assert.deepEqual(page.connections, [{ id: 42, options: { name: 'ozwell:page-tools', frameId: 0 } }]);
  assert.deepEqual(page.messages, [{ type: 'hello', url }]);
  page.ready();
  assert.deepEqual(await page.connection.getTools(), tools);
  assert.deepEqual(page.state, [{ connected: true }]);
  assert.equal(page.timers.size, 0);
  page.connection.dispose();
});

test('page change before injection or a mismatched ready URL cannot bind a new page', async t => {
  const moved = fixture(t, { currentUrl: 'https://ui.mieweb.org/other' });
  await settle();
  assert.equal(moved.connection.disposed, true);
  assert.equal(moved.injections.length, 0);
  assert.deepEqual(await moved.connection.getTools(), []);
  const page = fixture(t);
  await settle();
  page.receive({ type: 'ready', session: 'session-A', url: 'https://other.test/', tools });
  assert.equal(page.connection.disposed, true);
  assert.equal(page.disconnectCount, 1);
  assert.deepEqual(await page.connection.getTools(), []);
});

test('calls accept only advertised names and exact session/integer response IDs', async t => {
  const page = fixture(t);
  await settle(); page.ready();
  await assert.rejects(page.connection.callTool('executeJavascript', {}), /Unknown page tool/);
  const request = page.connection.callTool('browser_fill', { value: 'Draft' });
  await settle();
  assert.deepEqual(page.messages.at(-1), { type: 'call', session: 'session-A', id: 1, name: 'browser_fill', args: { value: 'Draft' } });
  let settled = false;
  request.then(() => { settled = true; });
  page.receive({ type: 'result', session: 'wrong-session', id: 1, result: 'wrong' });
  page.receive({ type: 'result', session: 'session-A', id: '1', result: 'wrong' });
  await settle();
  assert.equal(settled, false);
  page.receive({ type: 'result', session: 'session-A', id: 1, result: { ok: true } });
  assert.deepEqual(await request, { ok: true });
  assert.equal(page.timers.size, 0);
  page.connection.dispose();
});

test('cancellation sends the session-scoped cancel and rejects once without accepting late replies', async t => {
  const page = fixture(t);
  await settle(); page.ready();
  const abort = new AbortController();
  const request = page.connection.callTool('browser_fill', { value: 'Never commit' }, { signal: abort.signal });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  await settle(); abort.abort(); await rejected;
  assert.deepEqual(page.messages.at(-1), { type: 'cancel', session: 'session-A', id: 1 });
  page.receive({ type: 'result', session: 'session-A', id: 1, result: 'late' });
  assert.equal(page.timers.size, 0);
  page.connection.dispose();
});

test('port disconnect and readiness/call deadlines revoke pending work without hanging chat', async t => {
  const page = fixture(t);
  await settle(); page.ready();
  const request = page.connection.callTool('browser_snapshot', {});
  const rejected = assert.rejects(request, /navigated/);
  await settle(); page.listeners.disconnect[0](); await rejected;
  assert.equal(page.connection.disposed, true);
  assert.deepEqual(await page.connection.getTools(), []);
  const waiting = fixture(t);
  await settle();
  [...waiting.timers.values()].find(timer => timer.duration === 10000).callback();
  assert.deepEqual(await waiting.connection.getTools(), []);
  assert.equal(waiting.connection.disposed, true);
  const timed = fixture(t);
  await settle(); timed.ready();
  const pending = timed.connection.callTool('browser_snapshot', {});
  const timedOut = assert.rejects(pending, { name: 'AbortError' });
  await settle();
  [...timed.timers.values()].find(timer => timer.duration === 28000).callback();
  await timedOut;
  assert.equal(timed.messages.at(-1).type, 'cancel');
  timed.connection.dispose();
});

test('disposing during permission/injection preparation prevents any later connection', async t => {
  let resolveTab;
  const pendingTab = new Promise(resolve => { resolveTab = resolve; });
  const page = fixture(t, { getTab: () => pendingTab });
  page.connection.dispose();
  resolveTab({ id: 42, url });
  await settle();
  assert.equal(page.injections.length, 0);
  assert.equal(page.connections.length, 0);
  assert.deepEqual(await page.connection.getTools(), []);
});
