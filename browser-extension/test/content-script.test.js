import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { WIDGET } from '../config.js';

const source = await readFile(new URL('../content-script.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const extensionId = 'ozwell-test-extension';
const extensionURL = path => `chrome-extension://${extensionId}/${path}`;
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
      id: extensionId,
      getURL: extensionURL,
      sendMessage: response || (async () => state),
      onMessage: { addListener: listener => syncListeners.push(listener) },
      onConnect: { addListener: listener => connectListeners.push(listener) },
    } },
    setTimeout: callback => { timers.add(callback); return callback; },
    clearTimeout: callback => timers.delete(callback),
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
  });
  const run = () => vm.runInContext(source, context);
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
  const sync = (message, sender = { id: extensionId }) => {
    for (const listener of syncListeners) listener({ type: 'ozwell:sync', widget: WIDGET, ...message }, sender);
  };
  const event = (type, value) => { for (const listener of windowListeners.get(type) || []) listener(value); };
  const find = tag => root.children[0] && descendants(root.children[0].shadow).find(element => element.tagName === tag);
  const byLabel = label => root.children[0] && descendants(root.children[0].shadow).find(element => element.attributes['aria-label'] === label);
  run();
  await settle();
  return { root, context, timers, intervals, factories, location, state, syncListeners, connectListeners,
    windowListeners, sync, event, find, byLabel, run, settle };
}

function open(page) {
  page.byLabel('Open ozwell assistant').dispatch('click');
  return page.find('iframe');
}
const frameToken = frame => new URLSearchParams(new URL(frame.src).hash.slice(1)).get('token');
function connect(page, { hosted = false, name = hosted ? 'ozwell:hosted-page-tools' : 'ozwell:page-tools',
  sender = { id: extensionId, url: extensionURL(hosted ? 'background.js' : 'popup.html') } } = {}) {
  const messages = [], incoming = [], ended = [];
  let disconnectCount = 0;
  const port = {
    name, sender,
    postMessage: message => messages.push(plain(message)),
    disconnect: () => { disconnectCount++; },
    onMessage: { addListener: listener => incoming.push(listener) },
    onDisconnect: { addListener: listener => ended.push(listener) },
  };
  page.connectListeners.forEach(listener => listener(port));
  return { messages, receive: message => Promise.all(incoming.map(listener => listener(message))),
    disconnect: () => ended.forEach(listener => listener()), get disconnectCount() { return disconnectCount; } };
}
const hostedHello = (frame, extra = {}) => ({ type: 'hello', token: frameToken(frame), frameId: 4, ...extra });

// This shell has no website-window messaging channel. The remote widget lives
// inside page-host.html, whose own extension runtime port is tested separately.
test('content shell mounts once and lazily creates only a tokenized extension-owned frame', async () => {
  const page = await setup();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.root.children[0].shadowMode, 'closed');
  assert.equal(page.find('iframe'), undefined);
  assert.equal(page.factories.length, 0);
  const launcher = page.byLabel('Open ozwell assistant');
  const frame = open(page);
  const url = new URL(frame.src);
  assert.equal(url.protocol, 'chrome-extension:');
  assert.equal(url.hostname, extensionId);
  assert.equal(url.pathname, '/page-host.html');
  assert.match(frameToken(frame), /^[a-f0-9]{32}$/);
  assert.equal(url.search, '');
  assert.equal(frame.title, 'ozwell assistant');
  assert.equal(frame.hidden, true);
  assert.equal(launcher.attributes['aria-expanded'], 'true');
  const panel = page.byLabel('ozwell assistant');
  assert.equal(panel.hidden, false);
  assert.equal(page.byLabel('Close ozwell assistant').focused, true);
  page.byLabel('Close ozwell assistant').dispatch('click');
  assert.equal(panel.hidden, true);
  assert.equal(launcher.focused, true);
  assert.equal(open(page), frame);
  page.run(); await page.settle();
  assert.equal(page.root.children.length, 1);
  assert.equal(page.syncListeners.length, 1);
  assert.equal(page.connectListeners.length, 1);
  assert.equal(page.windowListeners.has('message'), false);
});

test('outer frame load reveals the extension host without a ready/config/MCP exchange with the website', async () => {
  const page = await setup();
  const frame = open(page);
  for (const origin of ['https://ui.mieweb.org', WIDGET.origin, 'https://evil.test', extensionURL('').slice(0, -1)]) {
    for (const data of [
      { source: 'ozwell-chat-widget', type: 'ready' },
      { source: 'ozwell-chat-parent', type: 'config', payload: { config: { endpoint: 'https://evil.test/chat' } } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'postMessage_browser_snapshot' } },
    ]) page.event('message', { source: frame.contentWindow, origin, data });
  }
  assert.equal(page.windowListeners.has('message'), false);
  assert.equal(frame.hidden, true);
  assert.deepEqual(frame.sent, []);
  assert.equal(page.factories.length, 0);
  frame.dispatch('load');
  assert.equal(frame.hidden, false);
  assert.equal(page.timers.size, 0);
  assert.deepEqual(frame.sent, []);
  assert.equal(page.factories.length, 0, 'Loading the host alone cannot grant website tools.');
});

test('popup ports require the exact extension sender and captured URL, independently of the hidden launcher', async () => {
  const page = await setup({ enabled: false });
  for (const sender of [
    { id: 'other-extension', url: extensionURL('popup.html') },
    { id: extensionId, url: 'https://ui.mieweb.org/' },
    { id: extensionId, url: extensionURL('popup.html?spoof=1') },
  ]) assert.equal(connect(page, { sender }).disconnectCount, 1);
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
  assert.equal(page.root.children.length, 0);
  assert.equal(page.factories[0].options.isAuthorized(), true);
  port.disconnect();
});

test('hosted ports accept only the worker identity without a tab or an unexpected sender URL', async () => {
  const page = await setup();
  const frame = open(page);
  for (const options of [
    { name: 'ozwell:page-host' },
    { sender: { id: 'other-extension', url: extensionURL('background.js') } },
    { sender: { id: extensionId, tab: { id: 1 }, url: extensionURL('background.js') } },
    { sender: { id: extensionId, url: extensionURL('popup.html') } },
    { sender: { id: extensionId, url: extensionURL('background.js?spoof=1') } },
    { sender: { id: extensionId, url: 'https://ui.mieweb.org/' } },
  ]) assert.equal(connect(page, { hosted: true, ...options }).disconnectCount, 1);
  assert.equal(page.factories.length, 0);
  for (const sender of [{ id: extensionId }, { id: extensionId, url: extensionURL('background.js') }]) {
    const port = connect(page, { hosted: true, sender });
    assert.deepEqual(port.messages, []);
    await port.receive(hostedHello(frame));
    assert.deepEqual(port.messages[0].tools, toolDefinitions);
    port.disconnect();
  }
});

test('hosted hello requires the current private frame token and a positive integer native frame ID', async () => {
  const page = await setup();
  for (const hello of [{ type: 'hello', token: '0'.repeat(32), frameId: 4 }, { type: 'hello', url: page.location.href }]) {
    const port = connect(page, { hosted: true });
    await port.receive(hello);
    assert.equal(port.disconnectCount, 1, 'No token exists until the user opens the launcher.');
  }
  const frame = open(page);
  for (const extra of [
    { token: '0'.repeat(32) }, { token: undefined }, { frameId: 0 }, { frameId: -1 },
    { frameId: '4' }, { frameId: 1.5 }, { frameId: undefined },
  ]) {
    const port = connect(page, { hosted: true });
    await port.receive(hostedHello(frame, extra));
    assert.equal(port.disconnectCount, 1);
    assert.deepEqual(port.messages, []);
  }
  assert.equal(page.factories.length, 0);
  const port = connect(page, { hosted: true });
  await port.receive(hostedHello(frame));
  assert.deepEqual(port.messages[0].tools, toolDefinitions);
  assert.match(port.messages[0].session, /^[a-f0-9]{32}$/);
  assert.equal(page.factories.length, 1);
  port.disconnect();
});

test('panel close and reopen cannot initialize a hosted port before its authenticated hello', async () => {
  const page = await setup();
  const frame = open(page);
  const port = connect(page, { hosted: true });
  await port.receive({ type: 'call', session: 'guessed', id: 1, name: 'browser_snapshot', args: {} });
  page.byLabel('Close ozwell assistant').dispatch('click');
  open(page); await page.settle();
  assert.equal(page.factories.length, 0);
  assert.deepEqual(port.messages, []);
  await port.receive(hostedHello(frame));
  assert.deepEqual(port.messages[0].tools, toolDefinitions);
  port.disconnect();
});

test('a valid host hello received while the panel is closed stays chat-only until reopen', async () => {
  const page = await setup();
  const frame = open(page);
  page.byLabel('Close ozwell assistant').dispatch('click');
  const port = connect(page, { hosted: true });
  await port.receive(hostedHello(frame));
  assert.equal(page.factories.length, 0);
  assert.deepEqual(port.messages[0].tools, []);
  const closedSession = port.messages[0].session;
  assert.equal(open(page), frame);
  await page.settle();
  assert.equal(page.factories.length, 1);
  assert.deepEqual(port.messages.at(-1).tools, toolDefinitions);
  assert.notEqual(port.messages.at(-1).session, closedSession);
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
  finish({ cancelled: true }); await pending;
  assert.equal(port.messages.length, 1, 'Cancelled calls do not produce stale results.');
  port.disconnect();
});

test('disconnecting either extension port aborts page work and disposes its factory', async () => {
  for (const hosted of [false, true]) {
    let signal, finish;
    const page = await setup({ callTool: (name, args, options) => {
      signal = options.signal; return new Promise(resolve => { finish = resolve; });
    } });
    const frame = hosted ? open(page) : undefined;
    const port = connect(page, { hosted });
    await port.receive(hosted ? hostedHello(frame) : { type: 'hello', url: page.location.href });
    const pending = port.receive({ type: 'call', session: port.messages[0].session, id: 1, name: 'browser_snapshot', args: {} });
    await page.settle();
    port.disconnect();
    assert.equal(signal.aborted, true);
    assert.equal(page.factories[0].disposed, true);
    assert.equal(page.intervals.size, 0);
    finish({ late: true }); await pending;
    assert.equal(port.messages.length, 1);
  }
});

test('off, permission reset, and navigation abort and disconnect both popup and hosted sessions', async () => {
  for (const hosted of [false, true]) for (const stop of ['off', 'reset', 'navigation']) {
    let signal, finish;
    const page = await setup({ callTool: (name, args, options) => {
      signal = options.signal; return new Promise(resolve => { finish = resolve; });
    } });
    const frame = hosted ? open(page) : undefined;
    const port = connect(page, { hosted });
    await port.receive(hosted ? hostedHello(frame) : { type: 'hello', url: page.location.href });
    const pending = port.receive({ type: 'call', session: port.messages[0].session, id: 1, name: 'browser_fill', args: {} });
    await page.settle();
    if (stop === 'off') page.sync({ enabled: false, powered: false });
    else if (stop === 'reset') page.sync({ enabled: true, powered: true, resetTools: true });
    else {
      page.location.href = 'https://ui.mieweb.org/changed';
      page.state.tab.url = page.location.href;
      for (const callback of [...page.intervals]) callback();
    }
    assert.equal(signal.aborted, true, `${hosted}:${stop}`);
    assert.equal(port.disconnectCount, 1, `${hosted}:${stop}`);
    finish({ late: true }); await pending; await page.settle();
    assert.equal(port.messages.length, 1, `${hosted}:${stop}`);
    assert.ok(page.factories.every(factory => factory.disposed), `${hosted}:${stop}`);
    assert.equal(page.intervals.size, 0, `${hosted}:${stop}`);
  }
});

test('closing a page panel revokes pending work and rotates the live host session across reopen', async () => {
  const calls = [];
  const page = await setup({ callTool: (name, args, options) => new Promise(resolve => {
    calls.push({ name, signal: options.signal, finish: resolve });
  }) });
  const frame = open(page);
  const port = connect(page, { hosted: true });
  await port.receive(hostedHello(frame));
  const initial = port.messages[0];
  const firstFactory = page.factories[0];
  const pending = port.receive({ type: 'call', session: initial.session, id: 55, name: 'browser_snapshot', args: {} });
  await page.settle();
  page.byLabel('Close ozwell assistant').dispatch('click');
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(firstFactory.disposed, true);
  assert.equal(firstFactory.options.isAuthorized(), false);
  assert.equal(port.disconnectCount, 0, 'The chat host stays connected while hidden.');
  const suspended = port.messages.at(-1);
  assert.equal(suspended.type, 'ready');
  assert.deepEqual(suspended.tools, []);
  assert.notEqual(suspended.session, initial.session);
  calls[0].finish({ late: true }); await pending;
  assert.ok(!port.messages.some(message => message.id === 55));
  assert.equal(open(page), frame);
  await page.settle();
  const reopened = port.messages.at(-1);
  assert.equal(reopened.type, 'ready');
  assert.deepEqual(reopened.tools, toolDefinitions);
  assert.notEqual(reopened.session, suspended.session);
  assert.notEqual(reopened.session, initial.session);
  assert.equal(page.factories.length, 2);
  assert.equal(page.factories[1].options.isAuthorized(), true);
  await port.receive({ type: 'call', session: initial.session, id: 56, name: 'browser_snapshot', args: {} });
  assert.equal(calls.length, 1, 'Old sessions cannot call into the new factory.');
  const next = port.receive({ type: 'call', session: reopened.session, id: 56, name: 'browser_snapshot', args: {} });
  await page.settle();
  await port.receive({ type: 'cancel', session: initial.session, id: 56 });
  assert.equal(calls[1].signal.aborted, false, 'An old session cannot cancel new work.');
  calls[1].finish({ fresh: true }); await next;
  assert.deepEqual(port.messages.at(-1), { type: 'result', session: reopened.session, id: 56, result: { fresh: true } });
  port.disconnect();
});

test('launcher disable disconnects the page host while an independently authorized popup remains usable', async () => {
  const page = await setup();
  const frame = open(page);
  const hosted = connect(page, { hosted: true });
  const popup = connect(page);
  await hosted.receive(hostedHello(frame));
  await popup.receive({ type: 'hello', url: page.location.href });
  page.state.tab.enabled = false;
  page.sync({ enabled: false, powered: true });
  assert.equal(hosted.disconnectCount, 1);
  assert.equal(popup.disconnectCount, 0);
  assert.equal(page.root.children.length, 0);
  await popup.receive({ type: 'call', session: popup.messages[0].session, id: 1, name: 'browser_snapshot', args: {} });
  assert.equal(popup.messages.at(-1).type, 'result');
  popup.disconnect();
});

test('power-off defeats a stale authorization response during popup connection setup', async () => {
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

test('closing a panel defeats stale hosted authorization and a later reopen creates fresh tools', async () => {
  let respond, count = 0;
  const stale = new Promise(resolve => { respond = resolve; });
  const state = { settings: { mode: 'manual', domains: [] }, tab: { enabled: true, url: 'https://ui.mieweb.org/workspace' }, widget: WIDGET };
  const page = await setup({ response: () => ++count === 2 ? stale : Promise.resolve(state) });
  const frame = open(page);
  const port = connect(page, { hosted: true });
  const pending = port.receive(hostedHello(frame));
  await page.settle();
  page.byLabel('Close ozwell assistant').dispatch('click');
  const suspended = port.messages.at(-1);
  assert.deepEqual(suspended.tools, []);
  respond(state); await pending;
  assert.equal(page.factories.length, 0);
  assert.equal(port.messages.length, 1);
  open(page); await page.settle();
  assert.equal(page.factories.length, 1);
  assert.deepEqual(port.messages.at(-1).tools, toolDefinitions);
  assert.notEqual(port.messages.at(-1).session, suspended.session);
  port.disconnect();
});

test('disable removes the frame and stale load or website messages cannot reveal its replacement', async () => {
  const page = await setup();
  const frame = open(page);
  const token = frameToken(frame);
  assert.equal(page.timers.size, 1);
  page.sync({ enabled: false });
  assert.equal(page.root.children.length, 0);
  assert.equal(page.timers.size, 0);
  page.event('message', { source: frame.contentWindow, origin: WIDGET.origin, data: { source: 'ozwell-chat-widget', type: 'ready' } });
  frame.dispatch('load');
  assert.equal(page.root.children.length, 0);
  assert.deepEqual(frame.sent, []);
  page.sync({ enabled: true });
  const replacement = open(page);
  assert.notEqual(frameToken(replacement), token);
  frame.dispatch('load');
  assert.equal(replacement.hidden, true);
  const stale = connect(page, { hosted: true });
  await stale.receive({ type: 'hello', token, frameId: 4 });
  assert.equal(stale.disconnectCount, 1);
  assert.equal(page.factories.length, 0);
  replacement.dispatch('load');
  assert.equal(replacement.hidden, false);
});

test('malformed or cross-origin widget configuration cannot mount an assistant shell', async () => {
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

test('runtime sync rejects foreign extension senders and loopback configuration still uses a local host frame', async () => {
  const page = await setup({ enabled: false });
  page.sync({ enabled: true }, { id: 'other-extension' });
  assert.equal(page.root.children.length, 0);
  const widget = {
    origin: 'http://localhost:3000',
    frameUrl: 'http://localhost:3000/widget/frame/?ozwellLoader=1',
    endpoint: 'http://localhost:3000/v1/chat/completions',
  };
  page.sync({ enabled: true, widget });
  const frame = open(page);
  assert.ok(frame.src.startsWith(`${extensionURL('page-host.html')}#token=`));
  assert.equal(page.find('a').href, widget.frameUrl);
  assert.deepEqual(frame.sent, []);
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

test('an outer host that never loads exposes the direct Ozwell fallback', async () => {
  const page = await setup();
  const frame = open(page);
  const link = page.find('a');
  assert.equal(link.hidden, true);
  for (const callback of [...page.timers]) callback();
  assert.equal(link.hidden, false);
  assert.equal(link.href, WIDGET.frameUrl);
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(frame.hidden, true);
});
