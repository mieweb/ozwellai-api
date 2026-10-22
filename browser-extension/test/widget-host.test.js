import test from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetHost, normalizeWidget } from '../widget-host.js';
import { WIDGET } from '../config.js';
const settle = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    this.focusCount = 0;
    if (tag === 'iframe') {
      this.sent = [];
      this.contentWindow = { postMessage: (message, origin) => this.sent.push({ message, origin }) };
    }
  }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  focus() { this.focusCount++; }
  get firstElementChild() { return this.children[0]; }
}

function fixture(t, callbacks = {}) {
  const originals = new Map(['document', 'window', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]));
  const listeners = new Set();
  const timers = new Map();
  globalThis.document = { createElement: tag => new Element(tag) };
  globalThis.window = {
    addEventListener: (type, listener) => { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener: (type, listener) => { assert.equal(type, 'message'); listeners.delete(listener); },
  };
  globalThis.setTimeout = callback => { const id = Symbol(); timers.set(id, callback); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  t.after(() => { for (const [key, value] of originals) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  } });
  const container = new Element('div');
  const host = createWidgetHost(container, callbacks);
  const message = (frame, data, { origin = WIDGET.origin, source = frame.contentWindow } = {}) => {
    for (const listener of listeners) listener({ origin, source, data });
  };
  return { host, container, timers, listeners, message };
}

test('toolbar widget configuration accepts HTTPS or loopback and pins frame/API to the same canonical origin', () => {
  assert.deepEqual(normalizeWidget(WIDGET), WIDGET);
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
    const widget = { origin, frameUrl: `${origin}/widget/frame/`, endpoint: `${origin}/v1/chat/completions` };
    assert.deepEqual(normalizeWidget(widget), widget);
  }
  for (const value of [
    undefined,
    { ...WIDGET, origin: `${WIDGET.origin}/path` },
    { ...WIDGET, origin: 'http://ui.mieweb.org' },
    { ...WIDGET, frameUrl: 'https://other.test/widget/frame/' },
    { ...WIDGET, endpoint: 'https://other.test/v1/chat/completions' },
    { ...WIDGET, frameUrl: 'javascript:alert(1)' },
  ]) assert.throws(() => normalizeWidget(value));
});

test('toolbar mounting preserves an existing conversation, and a ready handshake configures only once per readiness callback', t => {
  let readyCount = 0;
  const page = fixture(t, { onReady: () => readyCount++ });
  const frame = page.host.mount(WIDGET);
  assert.equal(frame.src, WIDGET.frameUrl);
  assert.equal(frame.title, 'Chat with ozwell');
  assert.equal(frame.hidden, true);
  assert.equal(page.host.mount({ ...WIDGET }), frame);
  assert.equal(page.container.children.length, 2);
  assert.equal(page.listeners.size, 1);
  assert.equal(page.timers.size, 1);
  page.host.focus();
  assert.equal(frame.focusCount, 0);
  page.message(frame, { source: 'ozwell-chat-widget', type: 'ready' });
  assert.equal(readyCount, 1);
  assert.equal(frame.hidden, false);
  assert.equal(page.container.children[0].hidden, true);
  assert.equal(page.timers.size, 0);
  assert.ok(frame.focusCount > 0);
  const configs = () => frame.sent.filter(item => item.message.type === 'config');
  assert.deepEqual(configs(), [{
    origin: WIDGET.origin,
    message: { source: 'ozwell-chat-parent', type: 'config', payload: { config: {
      endpoint: WIDGET.endpoint, title: 'ozwell', autoFocus: true, thinkingEnabled: false, tools: [],
      welcomeMessage: 'Hi, I’m ozwell. What would you like to work on?',
    } } },
  }]);
  assert.ok(frame.sent.some(item => item.message.source === 'ozwell-chat-parent' && item.message.type === 'focus'));
  page.message(frame, { source: 'ozwell-chat-widget', type: 'request-config' });
  assert.equal(readyCount, 1);
  assert.equal(configs().length, 2);
});

test('toolbar widget messages require the exact frame and configured origin', t => {
  const page = fixture(t);
  const frame = page.host.mount(WIDGET);
  const ready = { source: 'ozwell-chat-widget', type: 'ready' };
  page.message(frame, ready, { origin: 'https://other.test' });
  page.message(frame, ready, { source: {} });
  page.message(frame, null);
  page.message(frame, { jsonrpc: '2.0', method: 'tools/list' });
  assert.equal(frame.sent.length, 0);
  assert.equal(frame.hidden, true);
  page.message(frame, ready);
  assert.equal(frame.hidden, false);
});

test('toolbar MCP supports async discovery while rejecting unadvertised tools and arbitrary methods', async t => {
  const page = fixture(t);
  const frame = page.host.mount(WIDGET);
  for (const [index, method] of ['initialize', 'tools/list', 'ping', 'tools/call', 'chrome.tabs.query'].entries()) {
    page.message(frame, { jsonrpc: '2.0', id: index + 1, method, params: { name: 'read-page' } });
  }
  await settle();
  const reply = id => frame.sent.find(item => item.message.id === id).message;
  assert.equal(reply(1).result.protocolVersion, '2025-11-25');
  assert.deepEqual(reply(2), { jsonrpc: '2.0', id: 2, result: { tools: [] } });
  assert.deepEqual(reply(3), { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(reply(4).error.code, -32602);
  assert.equal(reply(5).error.code, -32601);
  assert.ok(frame.sent.every(item => item.origin === WIDGET.origin));
});

test('toolbar host advertises connected page tools and cancels pending work on power-off', async t => {
  const calls = [];
  let finish;
  const page = fixture(t, {
    getTools: async () => [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }],
    callTool: (name, args, { signal }) => { calls.push({ name, args, signal }); return new Promise(resolve => { finish = resolve; }); },
  });
  const frame = page.host.mount(WIDGET);
  const documentId = '11111111111111111111111111111111';
  const send = (data, options) => page.message(frame, { ...data, ozwellDocumentId: documentId }, options);
  send({ source: 'ozwell-chat-widget', type: 'ready' });
  await settle();
  const config = frame.sent.filter(item => item.message.type === 'config').at(-1).message.payload.config;
  assert.equal(config.tools[0].function.name, 'postMessage_browser_snapshot');
  send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'postMessage_browser_snapshot', arguments: {} } }, { origin: 'https://other.test' });
  await settle();
  assert.equal(calls.length, 0);
  send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'postMessage_browser_snapshot', arguments: {} } });
  await settle();
  assert.equal(calls[0].name, 'browser_snapshot');
  page.host.destroy();
  assert.equal(calls[0].signal.aborted, true);
  finish({ late: true });
  await settle();
  assert.equal(frame.sent.filter(item => item.message.id === 10).length, 0);
});

test('widget document identity cancels old work, rejects retired traffic and permits reused MCP IDs', async t => {
  const firstId = '11111111-1111-4111-8111-111111111111';
  const nextId = '22222222-2222-4222-8222-222222222222';
  const states = [], calls = [];
  const page = fixture(t, {
    onDocumentChange: state => states.push(state.active),
    getTools: async () => [{ name: 'browser_snapshot' }],
    callTool: (name, args, { signal }) => new Promise(resolve => calls.push({ signal, resolve })),
  });
  const frame = page.host.mount(WIDGET);
  const send = (documentId, data, options) => page.message(frame, { ...data, ozwellDocumentId: documentId }, options);
  const handshake = documentId => send(documentId, { source: 'ozwell-chat-widget', type: 'ready' });
  const call = documentId => send(documentId, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' } });
  handshake(firstId);
  frame.listeners.get('load')();
  call(firstId);
  await settle();
  send(firstId, { source: 'ozwell-chat-widget', type: 'request-config' });
  assert.deepEqual(states, [true], 'Ordinary configuration refresh keeps the current connection.');
  assert.equal(calls[0].signal.aborted, false);
  send(nextId, { source: 'ozwell-chat-widget', type: 'pagehide' }, { source: null });
  send(undefined, { source: 'ozwell-chat-widget', type: 'pagehide' }, { source: null });
  send(firstId, { source: 'ozwell-chat-widget', type: 'pagehide' }, { source: {} });
  send(firstId, { source: 'ozwell-chat-widget', type: 'pagehide' }, { source: null, origin: 'https://other.test' });
  send(firstId, { source: 'ozwell-chat-widget', type: 'pagehide', injected: true }, { source: null });
  assert.equal(calls[0].signal.aborted, false, 'Null-source unload requires the exact current document, origin and message shape.');
  send(firstId, { source: 'ozwell-chat-widget', type: 'pagehide' }, { source: null });
  assert.equal(calls[0].signal.aborted, true, 'Cancel on unload, before replacement load.');
  assert.deepEqual(states, [true, false]);
  handshake(nextId);
  frame.listeners.get('load')();
  for (const type of ['ready', 'request-config', 'pagehide']) send(firstId, { source: 'ozwell-chat-widget', type });
  for (const type of ['ready', 'request-config']) page.message(frame, { source: 'ozwell-chat-widget', type });
  for (const type of ['ready', 'request-config']) page.message(frame, { source: 'ozwell-chat-widget', type, ozwellDocumentId: 'invalid' });
  page.message(frame, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' } });
  call(firstId);
  call(nextId);
  await settle();
  assert.deepEqual(states, [true, false, true]);
  assert.equal(calls.length, 2);
  calls[0].resolve({ old: true });
  calls[1].resolve({ fresh: true });
  await settle();
  assert.deepEqual(frame.sent.filter(item => item.message.id === 4).map(item => item.message), [
    { jsonrpc: '2.0', id: 4, result: { fresh: true }, ozwellDocumentId: nextId },
  ]);
  page.host.destroy();
});

test('legacy widgets retain chat but never receive page tools across iframe reloads', async t => {
  const states = [], calls = [];
  const page = fixture(t, {
    onDocumentChange: state => states.push(state.active),
    getTools: async () => [{ name: 'browser_snapshot' }],
    callTool: (name, args, { signal }) => new Promise(resolve => calls.push({ signal, resolve })),
  });
  const frame = page.host.mount(WIDGET);
  const ready = { source: 'ozwell-chat-widget', type: 'ready' };
  const call = { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' } };
  page.message(frame, ready);
  frame.listeners.get('load')();
  page.message(frame, call);
  await settle();
  assert.equal(calls.length, 0);
  page.message(frame, ready);
  frame.listeners.get('load')();
  assert.deepEqual(states, [false, false, false]);
  page.message(frame, call);
  await settle();
  assert.equal(calls.length, 0);
  assert(frame.sent.filter(item => item.message.id === 4).every(item => item.message.error.code === -32602));
  const config = frame.sent.filter(item => item.message.type === 'config').at(-1).message.payload.config;
  assert.deepEqual(config.tools, []);
  page.host.destroy();
});

test('power-off teardown removes credentials frame, timer and listener, ignoring stale frame messages', t => {
  const page = fixture(t);
  const frame = page.host.mount(WIDGET);
  page.host.destroy();
  page.host.destroy();
  assert.equal(page.container.children.length, 0);
  assert.equal(page.listeners.size, 0);
  assert.equal(page.timers.size, 0);
  page.message(frame, { source: 'ozwell-chat-widget', type: 'ready' });
  assert.equal(frame.sent.length, 0);
  const next = page.host.mount(WIDGET);
  assert.notEqual(next, frame);
  assert.equal(page.listeners.size, 1);
  assert.equal(page.timers.size, 1);
});

test('queued load and error events from a removed iframe cannot retire its replacement', t => {
  const states = [], errors = [];
  const page = fixture(t, { onDocumentChange: state => states.push(state.active), onError: error => errors.push(error) });
  const old = page.host.mount(WIDGET);
  page.message(old, { source: 'ozwell-chat-widget', type: 'ready', ozwellDocumentId: '11111111111111111111111111111111' });
  page.host.destroy();
  const replacement = page.host.mount(WIDGET);
  page.message(replacement, { source: 'ozwell-chat-widget', type: 'ready', ozwellDocumentId: '22222222222222222222222222222222' });
  old.listeners.get('load')();
  old.listeners.get('load')();
  old.listeners.get('error')();
  assert.deepEqual(states, [true, false, true]);
  assert.deepEqual(errors, []);
  page.host.destroy();
});

test('toolbar load failures expose a safe direct-frame fallback and notify the host', t => {
  const failures = [];
  const page = fixture(t, { onError: error => failures.push(error) });
  const frame = page.host.mount(WIDGET);
  for (const callback of page.timers.values()) callback();
  const link = page.container.children[0].children[1];
  assert.equal(link.hidden, false);
  assert.equal(link.href, WIDGET.frameUrl);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(frame.hidden, true);
  assert.equal(failures.length, 1);
});
