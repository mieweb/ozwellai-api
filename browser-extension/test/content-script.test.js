import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { WIDGET } from '../config.js';

const source = await readFile(new URL('../content-script.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../mcp-bridge.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const toolNames = ['browser_snapshot', 'browser_click', 'browser_fill', 'browser_select', 'browser_scroll'];
const toolDefinitions = toolNames.map(name => ({ name, inputSchema: { type: 'object' } }));

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
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  focus() { this.focused = true; }
  get firstElementChild() { return this.children[0]; }
  querySelector(selector) { return descendants(this).find(child => child.tagName === selector); }
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

async function setup({ enabled = true, response, callTool = async () => ({ content: [{ type: 'text', text: 'ok' }] }) } = {}) {
  const root = new Element('html');
  const windowListeners = new Map();
  const syncListeners = [];
  const connectListeners = [];
  const intervals = new Set();
  const factories = [];
  const timers = new Set();
  const location = { href: 'https://ui.mieweb.org/workspace' };
  const state = { settings: { mode: 'manual', domains: [] }, tab: { enabled, url: location.href }, widget: plain(WIDGET) };
  const context = vm.createContext({
    URL, AbortController, DOMException, location,
    crypto: webcrypto,
    document: { documentElement: root, body: new Element('body'), createElement: tag => new Element(tag) },
    __ozwellCreatePageTools: options => {
      const factory = { options, tools: toolDefinitions, disposed: false,
        callTool: (...args) => callTool(...args), dispose() { this.disposed = true; } };
      factories.push(factory);
      return factory;
    },
    window: { addEventListener(name, listener) {
      const list = windowListeners.get(name) || [];
      list.push(listener);
      windowListeners.set(name, list);
    } },
    chrome: { runtime: {
      id: 'ozwell-test-extension',
      getURL: path => `chrome-extension://ozwell-test-extension/${path}`,
      sendMessage: response || (async () => state),
      onMessage: { addListener: listener => syncListeners.push(listener) },
      onConnect: { addListener: listener => connectListeners.push(listener) },
    } },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
  });
  vm.runInContext(bridgeSource, context);
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
  return { root, context, timers, intervals, factories, location, state, syncListeners, connectListeners, windowListeners, sync, message, find, byLabel, run, settle };
}

test('content shell mounts once and creates the hosted widget only when opened', async () => {
  const page = await setup();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.root.children[0].shadowMode, 'closed');
  assert.equal(page.find('iframe'), undefined);
  const launcher = page.byLabel('Open ozwell assistant');
  launcher.dispatch('click');
  const frame = page.find('iframe');
  assert.equal(frame.src, WIDGET.frameUrl);
  assert.equal(frame.title, 'ozwell assistant');
  assert.equal(frame.hidden, true);
  assert.equal(launcher.attributes['aria-expanded'], 'true');
  const panel = page.byLabel('ozwell assistant');
  assert.equal(panel.hidden, false);
  assert.equal(page.byLabel('Close ozwell assistant').focused, true);
  page.byLabel('Close ozwell assistant').dispatch('click');
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
  page.byLabel('Open ozwell assistant').dispatch('click');
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
      endpoint: WIDGET.endpoint, title: 'ozwell', thinkingEnabled: false,
      tools: toolNames.map(name => ({ type: 'function', function: { name: `postMessage_${name}`, description: '', parameters: { type: 'object' } } })),
    } } },
  }]);
});

function connect(page, sender = { id: 'ozwell-test-extension', url: 'chrome-extension://ozwell-test-extension/popup.html' }) {
  const messages = [], incoming = [], ended = [];
  let disconnectCount = 0;
  const port = {
    name: 'ozwell:page-tools', sender,
    postMessage: message => messages.push(plain(message)),
    disconnect: () => { disconnectCount++; },
    onMessage: { addListener: listener => incoming.push(listener) },
    onDisconnect: { addListener: listener => ended.push(listener) },
  };
  page.connectListeners.forEach(listener => listener(port));
  return { messages, receive: message => Promise.all(incoming.map(listener => listener(message))),
    disconnect: () => ended.forEach(listener => listener()), get disconnectCount() { return disconnectCount; } };
}

test('content ports authenticate the exact extension popup sender and captured URL', async () => {
  const page = await setup({ enabled: false });
  for (const sender of [
    { id: 'other-extension', url: 'chrome-extension://ozwell-test-extension/popup.html' },
    { id: 'ozwell-test-extension', url: 'https://ui.mieweb.org/' },
    { id: 'ozwell-test-extension', url: 'chrome-extension://ozwell-test-extension/popup.html?spoof=1' },
  ]) assert.equal(connect(page, sender).disconnectCount, 1);
  assert.equal(page.factories.length, 0);
  const moved = connect(page);
  await moved.receive({ type: 'hello', url: `${page.location.href}/different` });
  assert.equal(moved.disconnectCount, 1);
  const port = connect(page);
  await port.receive({ type: 'hello', url: page.location.href });
  const ready = port.messages[0];
  assert.equal(ready.type, 'ready');
  assert.match(ready.session, /^[a-f0-9]{32}$/);
  assert.equal(ready.url, page.location.href);
  assert.deepEqual(ready.tools, toolDefinitions);
  port.disconnect();
});

test('content calls require the exact session and integer ID and pass cancellation to local tools', async () => {
  const calls = [];
  let finish;
  const page = await setup({ enabled: false, callTool: (name, args, { signal }) => {
    calls.push({ name, args, signal }); return new Promise(resolve => { finish = resolve; });
  } });
  const port = connect(page);
  await port.receive({ type: 'hello', url: page.location.href });
  const session = port.messages[0].session;
  await port.receive({ type: 'call', session: 'different', id: 1, name: 'browser_fill', args: {} });
  await port.receive({ type: 'call', session, id: '1', name: 'browser_fill', args: {} });
  assert.equal(calls.length, 0);
  const pending = port.receive({ type: 'call', session, id: 1, name: 'browser_fill', args: { value: 'Draft' } });
  await page.settle();
  assert.equal(calls[0].name, 'browser_fill');
  await port.receive({ type: 'cancel', session: 'different', id: 1 });
  assert.equal(calls[0].signal.aborted, false);
  await port.receive({ type: 'cancel', session, id: 1 });
  assert.equal(calls[0].signal.aborted, true);
  finish({ cancelled: true });
  await pending;
  assert.equal(port.messages.length, 1, 'Cancelled calls do not produce stale results.');
  port.disconnect();
});

test('off and navigation disconnect popup sessions and abort current page work', async () => {
  for (const stop of ['off', 'navigation']) {
    let signal, finish;
    const page = await setup({ enabled: false, callTool: (name, args, options) => {
      signal = options.signal; return new Promise(resolve => { finish = resolve; });
    } });
    const port = connect(page);
    await port.receive({ type: 'hello', url: page.location.href });
    const pending = port.receive({ type: 'call', session: port.messages[0].session, id: 1, name: 'browser_fill', args: {} });
    await page.settle();
    if (stop === 'off') page.sync({ enabled: false, powered: false });
    else {
      page.location.href = 'https://ui.mieweb.org/changed';
      page.state.tab.url = page.location.href;
      for (const callback of [...page.intervals]) callback();
    }
    assert.equal(signal.aborted, true, stop);
    assert.equal(port.disconnectCount, 1, stop);
    finish({ late: true }); await pending; await page.settle();
    assert.equal(port.messages.length, 1, stop);
    assert.ok(page.factories.every(factory => factory.disposed), stop);
  }
});

test('closing a page panel cancels its tools and reopening refreshes the existing frame tool configuration', async () => {
  let signal, finish;
  const page = await setup({ callTool: (name, args, options) => {
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  } });
  page.byLabel('Open ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  page.message({ source: frame.contentWindow, origin: WIDGET.origin, data: { source: 'ozwell-chat-widget', type: 'ready' } });
  page.message({ source: frame.contentWindow, origin: WIDGET.origin,
    data: { jsonrpc: '2.0', id: 55, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' } } });
  await page.settle();
  page.byLabel('Close ozwell assistant').dispatch('click');
  assert.equal(signal.aborted, true);
  assert.deepEqual(frame.sent.at(-1).message.payload.config.tools, [], 'The still-mounted chat loses its page tools immediately.');
  finish({ late: true }); await page.settle();
  assert.ok(!frame.sent.some(item => item.message.id === 55));
  page.byLabel('Open ozwell assistant').dispatch('click');
  assert.equal(page.find('iframe'), frame);
  assert.equal(frame.sent.at(-1).message.payload.config.tools.length, 5);
});

test('a power-off update defeats a stale authorization response during popup connection setup', async () => {
  let respond, count = 0;
  const stale = new Promise(resolve => { respond = resolve; });
  const state = { settings: { mode: 'manual', domains: [] }, tab: { enabled: false, url: 'https://ui.mieweb.org/workspace' }, widget: WIDGET };
  const page = await setup({ enabled: false, response: () => ++count === 1 ? Promise.resolve(state) : stale });
  const port = connect(page);
  const pending = port.receive({ type: 'hello', url: page.location.href });
  await page.settle();
  page.sync({ enabled: false, powered: false });
  respond(state); await pending;
  assert.equal(port.disconnectCount, 1);
  assert.equal(page.factories.length, 0);
  assert.deepEqual(port.messages, []);
});

test('page MCP asynchronously exposes the five allowed tools and rejects arbitrary tool execution', async () => {
  const page = await setup();
  page.byLabel('Open ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  const request = (method, id) => page.message({
    source: frame.contentWindow, origin: WIDGET.origin,
    data: { jsonrpc: '2.0', method, id, params: { name: 'read-page', arguments: {} } },
  });
  request('initialize', 1);
  request('tools/list', 2);
  request('ping', 3);
  request('tools/call', 4);
  await page.settle();
  const reply = id => frame.sent.find(item => item.message.id === id).message;
  assert.equal(reply(1).result.serverInfo.name, 'ozwell-browser-extension');
  assert.deepEqual(reply(2).result.tools.map(tool => tool.name), toolNames.map(name => `postMessage_${name}`));
  assert.deepEqual(reply(3), { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(reply(4).error.code, -32602);
  assert.ok(frame.sent.every(item => item.origin === WIDGET.origin));
});

test('off removes the mounted frame, clears timers, and stale frame messages cannot remount it', async () => {
  const page = await setup();
  page.byLabel('Open ozwell assistant').dispatch('click');
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
    { origin: 'http://ui.mieweb.org', frameUrl: 'http://ui.mieweb.org/widget', endpoint: 'http://ui.mieweb.org/api' },
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
  page.byLabel('Open ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  assert.equal(frame.src, widget.frameUrl);
  page.message({ source: frame.contentWindow, origin: widget.origin, data: { source: 'ozwell-chat-widget', type: 'ready' } });
  assert.equal(frame.sent[0].origin, widget.origin);
  assert.equal(frame.sent[0].message.payload.config.endpoint, widget.endpoint);
  assert.equal(page.find('a').href, widget.frameUrl);
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
  page.byLabel('Open ozwell assistant').dispatch('click');
  const frame = page.find('iframe');
  const link = page.find('a');
  assert.equal(link.hidden, true);
  for (const callback of page.timers) callback();
  assert.equal(link.hidden, false);
  assert.equal(link.href, WIDGET.frameUrl);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(frame.hidden, true);
});
