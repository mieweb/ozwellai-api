import test from 'node:test';
import assert from 'node:assert/strict';
import { createWidgetHost, normalizeWidget } from '../widget-host.js';
import { WIDGET } from '../config.js';

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

test('toolbar MCP supports initialization and empty tools without allowing page or extension commands', t => {
  const page = fixture(t);
  const frame = page.host.mount(WIDGET);
  for (const [index, method] of ['initialize', 'tools/list', 'ping', 'tools/call', 'chrome.tabs.query'].entries()) {
    page.message(frame, { jsonrpc: '2.0', id: index + 1, method, params: { name: 'read-page' } });
  }
  assert.equal(frame.sent[0].message.result.protocolVersion, '2025-11-25');
  assert.deepEqual(frame.sent[1].message, { jsonrpc: '2.0', id: 2, result: { tools: [] } });
  assert.deepEqual(frame.sent[2].message, { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(frame.sent[3].message.error.code, -32601);
  assert.equal(frame.sent[4].message.error.code, -32601);
  assert.ok(frame.sent.every(item => item.origin === WIDGET.origin));
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
