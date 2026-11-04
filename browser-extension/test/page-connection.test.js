import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageConnection, createPageHostConnection } from '../page-connection.js';

const url = 'https://ui.mieweb.org/workspace?mode=local';
const tools = [{ name: 'browser_snapshot' }, { name: 'browser_fill' }];
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { currentUrl = url, tabId = 42, getTab, hostToken } = {}) {
  const originals = { setTimeout, clearTimeout, setInterval, clearInterval };
  const timers = new Map(), intervals = new Map(), messages = [], state = [], injections = [], connections = [];
  const listeners = { message: [], disconnect: [] };
  let disconnectCount = 0;
  globalThis.setTimeout = (callback, duration) => { const id = Symbol(); timers.set(id, { callback, duration }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.setInterval = (callback, duration) => { const id = Symbol(); intervals.set(id, { callback, duration }); return id; };
  globalThis.clearInterval = id => intervals.delete(id);
  t.after(() => Object.assign(globalThis, originals));
  const port = {
    onMessage: { addListener: listener => listeners.message.push(listener) },
    onDisconnect: { addListener: listener => listeners.disconnect.push(listener) },
    postMessage: message => messages.push(message),
    disconnect() { disconnectCount++; },
  };
  const api = {
    runtime: { connect: options => { connections.push({ runtime: options }); return port; } },
    tabs: {
      get: getTab || (async id => { assert.equal(id, tabId); return { id, url: currentUrl }; }),
      connect: (id, options) => { connections.push({ id, options }); return port; },
    },
    scripting: { executeScript: async options => injections.push(options) },
  };
  const options = { api, onStateChange: value => state.push(value) };
  const connection = hostToken === undefined ? createPageConnection(tabId, url, options) : createPageHostConnection(hostToken, options);
  const receive = message => listeners.message.forEach(listener => listener(message));
  const ready = () => receive({ type: 'ready', session: 'session-A', url, tools });
  return { connection, timers, intervals, messages, state, injections, connections, receive, ready, listeners, get disconnectCount() { return disconnectCount; } };
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
  assert.equal(page.intervals.size, 0, 'Direct popup ports do not need a worker heartbeat.');
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

test('embedded page host connects only to the worker relay and never selects or injects a tab', async t => {
  const token = '0123456789abcdef0123456789abcdef';
  const page = fixture(t, { hostToken: token });
  await settle();
  assert.deepEqual(page.connections, [{ runtime: { name: 'ozwell:page-host' } }]);
  assert.deepEqual(page.messages, [{ type: 'hello', token }]);
  assert.deepEqual(page.injections, []);
  page.ready();
  assert.deepEqual(await page.connection.getTools(), tools);
  page.connection.dispose();
  const invalid = fixture(t, { hostToken: 'not-a-private-token' });
  await settle();
  assert.equal(invalid.connection.disposed, true);
  assert.deepEqual(invalid.connections, []);
  assert.deepEqual(await invalid.connection.getTools(), []);
});

test('host ready rotation revokes pending work and refreshes tools across panel close and reopen', async t => {
  const page = fixture(t, { hostToken: '0123456789abcdef0123456789abcdef' });
  await settle(); page.ready();
  const request = page.connection.callTool('browser_snapshot', {});
  const rejected = assert.rejects(request, /session changed/);
  await settle();
  page.receive({ type: 'ready', session: 'session-closed', url, tools: [] });
  await rejected;
  assert.deepEqual(await page.connection.getTools(), []);
  assert.equal(page.connection.disposed, false, 'Closing the page panel must leave its chat connection alive.');
  await assert.rejects(page.connection.callTool('browser_snapshot', {}), /Unknown page tool/);
  page.receive({ type: 'result', session: 'session-A', id: 1, result: 'late-old-result' });
  page.receive({ type: 'ready', session: 'session-reopened', url, tools });
  assert.deepEqual(await page.connection.getTools(), tools, 'getTools must use the current list, not the original ready promise value.');
  assert.deepEqual(page.state, [{ connected: true }, { connected: false }, { connected: true }]);
  const next = page.connection.callTool('browser_snapshot', {});
  await settle();
  assert.deepEqual(page.messages.at(-1), { type: 'call', session: 'session-reopened', id: 2, name: 'browser_snapshot', args: {} });
  page.receive({ type: 'result', session: 'session-reopened', id: 2, result: { ok: true } });
  assert.deepEqual(await next, { ok: true });
  page.connection.dispose();
});

test('host pins the first regular website URL through every ready rotation', async t => {
  for (const initialURL of ['chrome://settings/', 'javascript:alert(1)', undefined]) {
    const page = fixture(t, { hostToken: '0123456789abcdef0123456789abcdef' });
    await settle();
    page.receive({ type: 'ready', session: 'session-A', url: initialURL, tools });
    assert.equal(page.connection.disposed, true);
    assert.deepEqual(await page.connection.getTools(), []);
  }
  const page = fixture(t, { hostToken: '0123456789abcdef0123456789abcdef' });
  await settle(); page.ready();
  page.receive({ type: 'ready', session: 'session-B', url: 'https://ui.mieweb.org/another-page', tools });
  assert.equal(page.connection.disposed, true);
  assert.deepEqual(await page.connection.getTools(), []);
});

test('popup ready rotation still requires the exact captured URL', async t => {
  const page = fixture(t);
  await settle(); page.ready();
  page.receive({ type: 'ready', session: 'session-B', url: 'https://ui.mieweb.org/workspace?mode=changed', tools });
  assert.equal(page.connection.disposed, true);
  assert.deepEqual(await page.connection.getTools(), []);
});

test('host heartbeat runs only after authenticated readiness and stays singular across session rotations', async t => {
  const page = fixture(t, { hostToken: '0123456789abcdef0123456789abcdef' });
  await settle();
  assert.equal(page.intervals.size, 0);
  page.ready();
  assert.equal(page.intervals.size, 1);
  const [intervalId, interval] = [...page.intervals][0];
  assert.equal(interval.duration, 20000);
  interval.callback();
  assert.deepEqual(page.messages.at(-1), { type: 'ping' });
  page.receive({ type: 'pong' });
  assert.deepEqual(await page.connection.getTools(), tools);
  page.receive({ type: 'ready', session: 'closed-session', url, tools: [] });
  page.receive({ type: 'ready', session: 'reopened-session', url, tools });
  assert.equal(page.intervals.size, 1);
  assert.equal([...page.intervals][0][0], intervalId);
  interval.callback();
  assert.deepEqual(page.messages.at(-1), { type: 'ping' });
  page.connection.dispose();
  assert.equal(page.intervals.size, 0);
});

test('host disconnect stops its worker heartbeat', async t => {
  const page = fixture(t, { hostToken: '0123456789abcdef0123456789abcdef' });
  await settle(); page.ready();
  assert.equal(page.intervals.size, 1);
  page.listeners.disconnect[0]();
  assert.equal(page.intervals.size, 0);
  assert.equal(page.connection.disposed, true);
});
