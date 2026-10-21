import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { WIDGET } from '../config.js';

const source = await readFile(new URL('../content-script.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = false;
    if (tag === 'iframe') {
      this.sent = [];
      this.contentWindow = { postMessage: (message, origin) => this.sent.push({ message: plain(message), origin }) };
    }
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  attachShadow({ mode }) { this.shadowMode = mode; return this.shadow = new Element('shadow'); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, listener) {
    const list = this.listeners.get(name) || [];
    list.push(listener);
    this.listeners.set(name, list);
  }
  dispatch(name, event = {}) { for (const listener of this.listeners.get(name) || []) listener(event); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  focus() { this.focused = true; }
  get firstElementChild() { return this.children[0]; }
  querySelector(selector) { return descendants(this).find(child => child.tagName === selector); }
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

async function setup({ enabled = true, response } = {}) {
  const root = new Element('html');
  const windowListeners = new Map();
  const syncListeners = [];
  const timers = new Set();
  const state = { tab: { enabled }, widget: plain(WIDGET) };
  const context = vm.createContext({
    URL,
    document: { documentElement: root, createElement: tag => new Element(tag) },
    window: { addEventListener(name, listener) {
      const list = windowListeners.get(name) || [];
      list.push(listener);
      windowListeners.set(name, list);
    } },
    chrome: { runtime: {
      id: 'ozwell-test-extension',
      sendMessage: response || (async () => state),
      onMessage: { addListener: listener => syncListeners.push(listener) },
    } },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
  });
  const run = () => vm.runInContext(source, context);
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const sync = (message, sender = { id: 'ozwell-test-extension' }) => {
    for (const listener of syncListeners) listener({ type: 'ozwell:sync', widget: WIDGET, ...message }, sender);
  };
  const message = event => { for (const listener of windowListeners.get('message') || []) listener(event); };
  const find = tag => descendants(root.children[0].shadow).find(element => element.tagName === tag);
  const byLabel = label => descendants(root.children[0].shadow).find(element => element.attributes['aria-label'] === label);
  run();
  await settle();
  return { root, context, timers, state, syncListeners, windowListeners, sync, message, find, byLabel, run, settle };
}

test('content shell mounts once and creates the hosted widget only when opened', async () => {
  const page = await setup();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.root.children[0].shadowMode, 'closed');
  assert.equal(page.find('iframe'), undefined);
  const launcher = page.byLabel('Open Ozwell assistant');
  launcher.dispatch('click');
  const frame = page.find('iframe');
  assert.equal(frame.src, WIDGET.frameUrl);
  assert.equal(frame.title, 'Ozwell assistant');
  assert.equal(frame.hidden, true);
  assert.equal(launcher.attributes['aria-expanded'], 'true');
  const panel = page.byLabel('Ozwell assistant');
  assert.equal(panel.hidden, false);
  assert.equal(page.byLabel('Close Ozwell assistant').focused, true);
  page.byLabel('Close Ozwell assistant').dispatch('click');
  assert.equal(panel.hidden, true);
  assert.equal(launcher.focused, true);
  launcher.dispatch('click');
  assert.equal(page.find('iframe'), frame);
  page.run();
  await page.settle();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.syncListeners.length, 1);
  assert.equal(page.windowListeners.get('message').length, 1);
});

test('widget ready handshake requires both the hosted origin and this exact frame', async () => {
  const page = await setup();
  page.byLabel('Open Ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  const data = { source: 'ozwell-chat-widget', type: 'ready' };
  page.message({ source: frame.contentWindow, origin: 'https://evil.test', data });
  page.message({ source: {}, origin: WIDGET.origin, data });
  assert.equal(frame.sent.length, 0);
  assert.equal(frame.hidden, true);
  page.message({ source: frame.contentWindow, origin: WIDGET.origin, data });
  assert.equal(frame.hidden, false);
  assert.equal(page.timers.size, 0);
  assert.deepEqual(frame.sent, [{
    origin: WIDGET.origin,
    message: { source: 'ozwell-chat-parent', type: 'config', payload: { config: {
      endpoint: WIDGET.endpoint, title: 'Ozwell', thinkingEnabled: false, tools: [],
    } } },
  }]);
});

test('MCP handshake exposes an empty tool list and rejects arbitrary tool execution', async () => {
  const page = await setup();
  page.byLabel('Open Ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  const request = (method, id) => page.message({
    source: frame.contentWindow, origin: WIDGET.origin,
    data: { jsonrpc: '2.0', method, id, params: { name: 'read-page', arguments: {} } },
  });
  request('initialize', 1);
  request('tools/list', 2);
  request('ping', 3);
  request('tools/call', 4);
  assert.equal(frame.sent[0].message.result.serverInfo.name, 'ozwell-browser-extension');
  assert.deepEqual(frame.sent[1].message, { jsonrpc: '2.0', id: 2, result: { tools: [] } });
  assert.deepEqual(frame.sent[2].message, { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(frame.sent[3].message.error.code, -32601);
  assert.ok(frame.sent.every(item => item.origin === WIDGET.origin));
});

test('off removes the mounted frame, clears timers, and stale frame messages cannot remount it', async () => {
  const page = await setup();
  page.byLabel('Open Ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  assert.equal(page.timers.size, 1);
  page.sync({ enabled: false });
  assert.equal(page.root.children.length, 0);
  assert.equal(page.timers.size, 0);
  page.message({ source: frame.contentWindow, origin: WIDGET.origin, data: { source: 'ozwell-chat-widget', type: 'ready' } });
  assert.equal(page.root.children.length, 0);
  assert.equal(frame.sent.length, 0);
  page.sync({ enabled: true });
  assert.equal(page.root.children.length, 1);
  assert.equal(page.find('iframe'), undefined);
});

test('malformed or untrusted widget configuration cannot create a remote frame', async () => {
  const page = await setup({ enabled: false });
  for (const widget of [
    { ...WIDGET, origin: 'https://evil.test' },
    { ...WIDGET, frameUrl: 'https://ozwell.ai.evil.test/widget' },
    { ...WIDGET, endpoint: 'https://evil.test/chat' },
    { ...WIDGET, frameUrl: 'javascript:alert(1)' },
    { origin: 'http://example.com', frameUrl: 'http://example.com/widget', endpoint: 'http://example.com/api' },
  ]) {
    page.sync({ enabled: true, widget });
    assert.equal(page.root.children.length, 0);
  }
  page.sync({ enabled: true });
  assert.equal(page.root.children.length, 1);
});

test('runtime messages require this extension sender and support configured loopback development origins', async () => {
  const page = await setup({ enabled: false });
  page.sync({ enabled: true }, { id: 'other-extension' });
  assert.equal(page.root.children.length, 0);
  const widget = {
    origin: 'http://localhost:3000',
    frameUrl: 'http://localhost:3000/widget/frame/?ozwellLoader=1',
    endpoint: 'http://localhost:3000/v1/chat/completions',
  };
  page.sync({ enabled: true, widget });
  page.byLabel('Open Ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  assert.equal(frame.src, widget.frameUrl);
  page.message({ source: frame.contentWindow, origin: widget.origin, data: { source: 'ozwell-chat-widget', type: 'ready' } });
  assert.equal(frame.sent[0].origin, widget.origin);
  assert.equal(frame.sent[0].message.payload.config.endpoint, widget.endpoint);
  assert.equal(page.find('a').href, widget.origin);
  page.sync({ enabled: false }, { id: 'other-extension' });
  assert.equal(page.root.children.length, 1);
  page.sync({ enabled: false });
  assert.equal(page.root.children.length, 0);
});

test('a newer disable message wins over an outstanding initial state response', async () => {
  let respond;
  const pending = new Promise(resolve => { respond = resolve; });
  const page = await setup({ response: () => pending });
  page.sync({ enabled: false });
  respond({ tab: { enabled: true }, widget: WIDGET });
  await page.settle();
  assert.equal(page.root.children.length, 0);
});

test('a hosted frame that never becomes ready exposes a direct Ozwell fallback', async () => {
  const page = await setup();
  page.byLabel('Open Ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  const link = page.find('a');
  assert.equal(link.hidden, true);
  for (const callback of page.timers) callback();
  assert.equal(link.hidden, false);
  assert.equal(link.href, WIDGET.origin);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(frame.hidden, true);
});
