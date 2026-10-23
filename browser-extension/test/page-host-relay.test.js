import test from 'node:test';
import assert from 'node:assert/strict';
import { installPageHostRelay } from '../page-host-relay.js';

const token = '0123456789abcdef0123456789abcdef';
const extensionId = 'ozwell-extension-id';
const hostURL = `chrome-extension://${extensionId}/page-host.html`;
function event() {
  const listeners = new Set();
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach(listener => listener(...args)),
    get size() { return listeners.size; },
  };
}
function port({ name = '', sender } = {}) {
  let disconnected = false;
  return {
    name, sender, messages: [], disconnectCount: 0,
    onMessage: event(), onDisconnect: event(),
    postMessage(message) { assert.equal(disconnected, false); this.messages.push(message); },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      this.disconnectCount++;
      this.onDisconnect.emit();
    },
  };
}
function fixture(t, changes = {}) {
  const page = port();
  const connections = [];
  const api = {
    runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}`, onConnect: event() },
    tabs: { connect(tabId, options) { connections.push({ tabId, options }); return page; } },
  };
  const dispose = installPageHostRelay(api);
  t.after(dispose);
  const sender = { id: extensionId, url: `${hostURL}#token=${token}`, tab: { id: 42 }, frameId: 9, ...changes };
  const host = port({ name: 'ozwell:page-host', sender });
  api.runtime.onConnect.emit(host);
  const hello = (message = { type: 'hello', token }) => host.onMessage.emit(message);
  return { api, page, host, connections, hello, dispose };
}

test('relay authenticates the exact extension host URL, private token, native tab and child frame', t => {
  const invalid = [
    { id: 'another-extension' }, { id: undefined },
    { url: 'https://ui.mieweb.org/page-host.html#token=' + token },
    { url: hostURL }, { url: `${hostURL}?query=1#token=${token}` },
    { url: `${hostURL}/other#token=${token}` }, { url: `${hostURL}#token=not-a-token` },
    { url: `${hostURL}#token=${token}&other=1` },
    { tab: undefined }, { tab: { id: '42' } }, { tab: { id: -1 } },
    { frameId: undefined }, { frameId: 0 }, { frameId: -1 }, { frameId: 1.5 },
  ];
  for (const sender of invalid) {
    const relay = fixture(t, sender);
    assert.equal(relay.host.disconnectCount, 1, JSON.stringify(sender));
    assert.deepEqual(relay.connections, []);
  }
  const valid = fixture(t);
  assert.equal(valid.host.disconnectCount, 0);
  assert.deepEqual(valid.connections, [], 'The relay waits for a matching hello before connecting to a tab.');
  valid.hello();
  assert.deepEqual(valid.connections, [{ tabId: 42, options: { name: 'ozwell:hosted-page-tools', frameId: 0 } }]);
  assert.deepEqual(valid.page.messages, [{ type: 'hello', token, frameId: 9 }]);
});

test('unrelated runtime ports are ignored', t => {
  const relay = fixture(t);
  const other = port({ name: 'unrelated' });
  relay.api.runtime.onConnect.emit(other);
  assert.equal(other.disconnectCount, 0);
  assert.deepEqual(relay.connections, []);
});

test('wrong tokens and malformed initial messages cannot open a target port', t => {
  for (const message of [null, [], {}, { type: 'ping' }, { type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: {} }, { type: 'hello', token: 'f'.repeat(32) }, { type: 'hello', token, tabId: 100 }, { type: 'hello', token, frameId: 7 }, { type: 'hello', token, url: 'https://ui.mieweb.org/other' }]) {
    const relay = fixture(t);
    relay.hello(message);
    assert.equal(relay.host.disconnectCount, 1, JSON.stringify(message));
    assert.deepEqual(relay.connections, []);
  }
});

test('relay pins the native sender and forwards only the scoped call/cancel protocol', t => {
  const relay = fixture(t);
  relay.host.sender.tab.id = 99;
  relay.host.sender.frameId = 100;
  relay.hello();
  assert.deepEqual(relay.connections, [{ tabId: 42, options: { name: 'ozwell:hosted-page-tools', frameId: 0 } }]);
  assert.deepEqual(relay.page.messages[0], { type: 'hello', token, frameId: 9 });
  const call = { type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: {} };
  relay.host.onMessage.emit(call);
  const cancel = { type: 'cancel', session: 'A', id: 1 };
  relay.host.onMessage.emit(cancel);
  assert.deepEqual(relay.page.messages.slice(1), [call, cancel]);
  const ready = { type: 'ready', session: 'A', url: 'https://ui.mieweb.org/workspace', tools: [{ name: 'browser_snapshot' }] };
  const result = { type: 'result', session: 'A', id: 1, result: { content: [] } };
  const error = { type: 'error', session: 'A', id: 2, error: { message: 'Stopped' } };
  for (const message of [ready, result, error]) relay.page.onMessage.emit(message);
  assert.deepEqual(relay.host.messages, [ready, result, error]);
  relay.host.onMessage.emit({ ...call, tabId: 100 });
  assert.equal(relay.host.disconnectCount, 1);
  assert.equal(relay.page.disconnectCount, 1);
  assert.equal(relay.connections.length, 1, 'Client tab data cannot redirect the relay.');
});

test('malformed or unsupported messages close both ends of an established relay', t => {
  for (const message of [
    { type: 'hello', token }, { type: 'ready', session: 'A' },
    { type: 'call', session: '', id: 1, name: 'browser_snapshot', args: {} },
    { type: 'call', session: 'A', id: '1', name: 'browser_snapshot', args: {} },
    { type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: [] },
    { type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: {}, frameId: 100 },
    { type: 'cancel', session: 'A', id: 0 }, { type: 'cancel', session: 'A', id: 1, url: 'https://ui.mieweb.org/other' },
    { type: 'ping', tabId: 100 }, { type: 'ping', frameId: 7 }, { type: 'ping', url: 'https://ui.mieweb.org/other' },
  ]) {
    const relay = fixture(t);
    relay.hello();
    relay.host.onMessage.emit(message);
    assert.equal(relay.host.disconnectCount, 1, JSON.stringify(message));
    assert.equal(relay.page.disconnectCount, 1);
    assert.equal(relay.page.messages.length, 1);
  }
});

test('disconnect from either side removes listeners and closes the other port once', t => {
  for (const side of ['host', 'page']) {
    const relay = fixture(t);
    relay.hello();
    relay[side].disconnect();
    assert.equal(relay.host.disconnectCount, 1);
    assert.equal(relay.page.disconnectCount, 1);
    for (const endpoint of [relay.host, relay.page]) {
      assert.equal(endpoint.onMessage.size, 0);
      assert.equal(endpoint.onDisconnect.size, 0);
    }
    relay.host.onMessage.emit({ type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: {} });
    assert.equal(relay.page.messages.length, 1);
  }
});

test('connection failures and shutdown clean up all relay ports', t => {
  const failed = fixture(t);
  failed.api.tabs.connect = () => { throw new Error('Page access ended'); };
  failed.hello();
  assert.equal(failed.host.disconnectCount, 1);
  const stopped = fixture(t);
  stopped.hello();
  stopped.dispose();
  assert.equal(stopped.host.disconnectCount, 1);
  assert.equal(stopped.page.disconnectCount, 1);
  assert.equal(stopped.api.runtime.onConnect.size, 0);
  const invalidServer = fixture(t);
  invalidServer.hello();
  invalidServer.page.onMessage.emit({ type: 'call', session: 'A', id: 1, name: 'browser_snapshot', args: {} });
  assert.equal(invalidServer.host.disconnectCount, 1);
  assert.equal(invalidServer.page.disconnectCount, 1);
});

test('authenticated host heartbeat is answered locally without changing or forwarding its pinned endpoint', t => {
  const relay = fixture(t);
  relay.hello();
  relay.host.onMessage.emit({ type: 'ping' });
  relay.host.onMessage.emit({ type: 'ping' });
  assert.deepEqual(relay.host.messages, [{ type: 'pong' }, { type: 'pong' }]);
  assert.deepEqual(relay.connections, [{ tabId: 42, options: { name: 'ozwell:hosted-page-tools', frameId: 0 } }]);
  assert.deepEqual(relay.page.messages, [{ type: 'hello', token, frameId: 9 }]);
  relay.host.disconnect();
  relay.host.onMessage.emit({ type: 'ping' });
  assert.equal(relay.host.messages.length, 2);
  assert.equal(relay.page.disconnectCount, 1);
});
