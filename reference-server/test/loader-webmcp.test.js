import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const loaderSource = await readFile(new URL('../embed/ozwell-loader.js', import.meta.url), 'utf8');
const HOST_ORIGIN = 'https://host.example';
const FRAME_ORIGIN = 'https://assistant.example';
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));

// Execute the shipped loader rather than copying its normalization or dispatch code.
// This small browser double also models native duplicate-name rejection and the
// registration lifetime controlled by registerTool's AbortSignal.
function loadLoader({ config = {}, native = true, existingTools = [], agentTools = [] } = {}) {
  const listeners = new Map();
  const documentListeners = new Map();
  const posts = [];
  const warnings = [];
  const registrations = [];
  const nativeTools = new Map(existingTools.map((name) => [name, { external: true, name }]));
  const timers = new Map();
  let timerId = 0;
  let now = 0;
  let frame;

  const on = (target, type, listener) => {
    if (!target.has(type)) target.set(type, new Set());
    target.get(type).add(listener);
  };
  const off = (target, type, listener) => target.get(type)?.delete(listener);
  const emit = (target, event) => {
    for (const listener of [...(target.get(event.type) || [])]) listener(event);
    return true;
  };
  const element = (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    setAttribute(name, value) { this[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
  });
  const document = {
    baseURI: `${HOST_ORIGIN}/app`,
    readyState: 'complete',
    currentScript: null,
    head: element('head'),
    body: element('body'),
    querySelector: () => ({}),
    getElementById: () => null,
    createElement(tag) {
      const node = element(tag);
      if (tag === 'iframe') {
        node.contentWindow = {
          postMessage(message, targetOrigin) { posts.push({ message, targetOrigin }); },
        };
        frame = node;
      }
      return node;
    },
    addEventListener(type, listener) { on(documentListeners, type, listener); },
    removeEventListener(type, listener) { off(documentListeners, type, listener); },
    dispatchEvent(event) { return emit(documentListeners, event); },
  };
  if (native) {
    document.modelContext = {
      registerTool(tool, options = {}) {
        registrations.push({ tool, options });
        if (nativeTools.has(tool.name)) throw new Error(`Tool "${tool.name}" already exists`);
        const entry = { tool, options };
        nativeTools.set(tool.name, entry);
        options.signal?.addEventListener('abort', () => {
          if (nativeTools.get(tool.name) === entry) nativeTools.delete(tool.name);
        }, { once: true });
      },
      unregisterTool() { throw new Error('Must not unregister tools owned by the host'); },
    };
  }
  const window = {
    OzwellChatConfig: {
      autoMount: false,
      defaultUI: false,
      widgetUrl: `${FRAME_ORIGIN}/widget/frame/`,
      ...config,
    },
    addEventListener(type, listener) { on(listeners, type, listener); },
  };
  const navigator = {};
  Object.defineProperty(navigator, 'modelContext', {
    get() { throw new Error('The loader must use native document.modelContext only'); },
  });
  const context = vm.createContext({
    window,
    document,
    navigator,
    URL,
    AbortController,
    DOMException,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    console: { log() {}, warn(...args) { warnings.push(args); }, error() {} },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    fetch: async () => ({ ok: true, json: async () => ({ tools: agentTools }) }),
  });
  vm.runInContext(loaderSource, context, { filename: 'ozwell-loader.js' });

  return {
    api: window.OzwellChat,
    document,
    posts,
    warnings,
    registrations,
    nativeTools,
    timers,
    get frame() { return frame; },
    listen(handler) { document.addEventListener('ozwell-tool-call', (event) => handler(event.detail)); },
    receive(data, { source = frame?.contentWindow, origin = FRAME_ORIGIN } = {}) {
      emit(listeners, { type: 'message', data, source, origin });
    },
    callMcp(name, args = {}, id = 1, sender) {
      this.receive({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, sender);
    },
    responses(id) { return posts.filter(({ message }) => message.jsonrpc === '2.0' && message.id === id); },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
      await nextTurn();
    },
  };
}

function pageTool(name = 'read') {
  return { name, description: `Run ${name}`, inputSchema: { type: 'object', properties: { value: {} } } };
}

function registeredTool(env, name = 'read') {
  const entry = env.nativeTools.get(name);
  assert.ok(entry?.tool, `Expected native tool ${name}`);
  return entry.tool;
}

test('WebMCP is disabled by default and false disables explicit registration', () => {
  for (const webMCP of [undefined, false]) {
    const env = loadLoader({ config: { tools: [pageTool()], webMCP } });
    env.api.mount();
    env.api.configure({ title: 'Updated title' });
    assert.equal(env.registrations.length, 0);
  }
});

test('an unavailable native API leaves the existing MCP transport functional', async () => {
  const env = loadLoader({ native: false, config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  env.listen(({ respond }) => respond(false));
  env.api.mount();
  env.callMcp('postMessage_read', {}, 0);
  await nextTurn();
  assert.equal(env.registrations.length, 0);
  assert.equal(env.responses(0).length, 1);
  assert.equal(env.responses(0)[0].message.result, false);
});

test('only an explicit subset of page tools is registered, preserving schema and origin exposure', async () => {
  const inputSchema = { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] };
  const env = loadLoader({
    agentTools: [pageTool('serverOnly')],
    config: {
      apiKey: 'agnt_key-test',
      tools: [pageTool('unselected'), { type: 'function', function: { name: 'read', description: 'Read a record', parameters: inputSchema } }],
      webMCP: { tools: ['read', 'read', 'missing', 'serverOnly'], exposedTo: ['https://trusted.example'] },
    },
  });
  env.api.mount();
  await nextTurn();
  env.receive({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  await nextTurn();
  assert.equal(env.registrations.length, 1);
  const { tool, options } = env.registrations[0];
  assert.equal(tool.name, 'read');
  assert.equal(tool.description, 'Read a record');
  assert.deepEqual(plain(tool.inputSchema), inputSchema);
  assert.deepEqual(plain(options.exposedTo), ['https://trusted.example']);
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual(plain(env.responses(7)[0].message.result.tools.map(({ name }) => name)), [
    'serverOnly', 'postMessage_unselected', 'postMessage_read',
  ]);
});

test('configure can enable registration before mount and repeated configuration does not duplicate it', () => {
  const env = loadLoader({ config: { tools: [pageTool()] } });
  env.api.configure({ webMCP: { tools: ['read'] } });
  assert.equal(env.registrations.length, 1);
  const first = env.nativeTools.get('read');
  env.api.mount();
  env.api.mount();
  env.api.configure({ title: 'New title' });
  env.api.configure({ webMCP: { tools: ['read'] } });
  assert.equal(env.registrations.length, 1);
  assert.equal(env.nativeTools.get('read'), first);
  assert.equal(first.options.signal.aborted, false);
});

test('ready and configure pushes preserve the executable MCP catalog and page-tool policy namespace', async () => {
  const env = loadLoader({
    agentTools: [pageTool('serverOnly')],
    config: { apiKey: 'agnt_key-test', tools: [pageTool()] },
  });
  const calls = [];
  env.listen((detail) => { calls.push(detail); detail.respond({ ok: true }); });
  env.api.mount();
  env.receive({ source: 'ozwell-chat-widget', type: 'ready' });
  await nextTurn();
  const pushedConfig = () => env.posts.filter(({ message }) => message.type === 'config').at(-1).message.payload.config;
  assert.deepEqual(plain(pushedConfig().tools.map((tool) => tool.function.name)), ['serverOnly', 'postMessage_read']);

  const inputSchema = { type: 'object', properties: { recordId: { type: 'string' } }, required: ['recordId'] };
  env.api.configure({
    tools: [{
      name: 'updated', description: 'Read the updated record', parameters: inputSchema,
      function() { throw new Error('Callable tool config must never execute'); },
    }],
  });
  const pushedTools = pushedConfig().tools;
  assert.deepEqual(plain(pushedTools.map((tool) => tool.function.name)), ['serverOnly', 'postMessage_updated']);
  assert.equal(typeof pushedTools[1].function, 'object', 'Callable functions must be replaced with schema data');
  assert.deepEqual(plain(pushedTools[1].function.parameters), inputSchema);
  env.receive({ jsonrpc: '2.0', id: 80, method: 'tools/list' });
  env.callMcp(pushedTools[1].function.name, { recordId: 'current' }, 81);
  env.callMcp('postMessage_read', {}, 82);
  env.callMcp('updated', {}, 83);
  await nextTurn();
  assert.deepEqual(plain(env.responses(80)[0].message.result.tools.map((tool) => tool.name)), pushedTools.map((tool) => tool.function.name));
  assert.deepEqual(plain(env.responses(81)[0].message.result), { ok: true });
  assert.equal(env.responses(82)[0].message.error.code, -32602);
  assert.equal(env.responses(83)[0].message.error.code, -32602);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'updated');
  assert.deepEqual(plain(calls[0].arguments), { recordId: 'current' });

  env.api.configure({ tools: [] });
  assert.deepEqual(plain(pushedConfig().tools.map((tool) => tool.function.name)), ['serverOnly']);
});

test('MCP and WebMCP use the same handler and preserve falsy results with one settlement', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  const calls = [];
  env.listen((detail) => {
    calls.push(detail);
    detail.respond(detail.arguments.value);
    detail.respond('duplicate');
    detail.error('late error');
  });
  env.api.mount();
  const nativeTool = registeredTool(env);
  let id = 20;
  for (const result of [false, 0, '', null]) {
    assert.equal(await nativeTool.execute({ value: result }), result);
    env.callMcp('postMessage_read', { value: result }, id);
    await nextTurn();
    assert.equal(env.responses(id).length, 1);
    assert.equal(env.responses(id)[0].message.result, result);
    id += 1;
  }
  assert.equal(calls.length, 8);
  assert.ok(calls.every((call) => call.name === 'read'));
  await env.advance(29000);
  assert.equal(calls.length, 8, 'Settling or timing out must never repeat tool execution');
  for (let requestId = 20; requestId < 24; requestId += 1) assert.equal(env.responses(requestId).length, 1);
});

test('unknown or unprefixed page MCP tools are rejected without executing a handler', async () => {
  const env = loadLoader({ config: { tools: [pageTool()] } });
  let executions = 0;
  env.listen(() => { executions += 1; });
  env.api.mount();
  for (const [index, name] of ['postMessage_missing', 'missing', 'read'].entries()) {
    env.callMcp(name, {}, index);
    await nextTurn();
    assert.equal(env.responses(index).length, 1);
    assert.equal(env.responses(index)[0].message.error.code, -32602);
  }
  assert.equal(executions, 0);
});

test('handler errors are reported through both transports without duplicate replies', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  let executions = 0;
  env.listen(({ error, respond }) => {
    executions += 1;
    error('Record access denied');
    respond('too late');
  });
  env.api.mount();
  await assert.rejects(registeredTool(env).execute({}), /Record access denied/);
  env.callMcp('postMessage_read', {}, 40);
  await nextTurn();
  assert.equal(env.responses(40).length, 1);
  assert.equal(env.responses(40)[0].message.error.message, 'Record access denied');
  assert.equal(executions, 2);
  await env.advance(29000);
  assert.equal(env.responses(40).length, 1);
});

test('unanswered calls time out on both transports and late callbacks do not settle them again', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  const calls = [];
  env.listen((detail) => calls.push(detail));
  env.api.mount();
  const nativeRejected = assert.rejects(registeredTool(env).execute({}), /did not respond/);
  env.callMcp('postMessage_read', {}, 50);
  await env.advance(28999);
  assert.equal(env.responses(50).length, 0);
  await env.advance(1);
  await nativeRejected;
  assert.equal(env.responses(50).length, 1);
  assert.match(env.responses(50)[0].message.error.message, /did not respond/);
  for (const detail of calls) detail.respond('late result');
  await env.advance(29000);
  assert.equal(calls.length, 2);
  assert.equal(env.responses(50).length, 1);
});

test('native caller cancellation aborts its handler signal and never retries execution', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  const calls = [];
  env.listen((detail) => calls.push(detail));
  env.api.mount();
  const tool = registeredTool(env);
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await assert.rejects(tool.execute({}, { signal: alreadyCancelled.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 0);
  const caller = new AbortController();
  const rejected = assert.rejects(tool.execute({}, { signal: caller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, false);
  caller.abort();
  await rejected;
  assert.equal(calls[0].signal.aborted, true);
  calls[0].respond('too late');
  await env.advance(29000);
  assert.equal(calls.length, 1);
  assert.equal(env.timers.size, 0);
});

test('reconfiguration retires only owned registrations and rejects stale or in-flight callbacks', async () => {
  const env = loadLoader({
    existingTools: ['external'],
    config: { tools: [pageTool()], webMCP: { tools: ['read'] } },
  });
  const calls = [];
  env.listen((detail) => calls.push(detail));
  env.api.mount();
  const old = registeredTool(env);
  const oldRegistration = env.registrations[0];
  const rejected = assert.rejects(old.execute({}), { name: 'AbortError' });
  env.api.configure({ tools: [{ ...pageTool(), description: 'Updated description' }] });
  await rejected;
  assert.equal(oldRegistration.options.signal.aborted, true);
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(registeredTool(env).description, 'Updated description');
  await assert.rejects(old.execute({}), { name: 'AbortError' });
  assert.equal(calls.length, 1, 'A stale native callback must not dispatch a tool event');
  calls[0].respond('late');
  env.api.configure({ webMCP: false });
  assert.equal(env.nativeTools.has('read'), false);
  assert.equal(env.nativeTools.get('external').external, true);
});

test('native duplicate-name rejection does not replace a host tool or break MCP', async () => {
  const env = loadLoader({
    existingTools: ['read'],
    config: { tools: [pageTool()], webMCP: { tools: ['read'] } },
  });
  const external = env.nativeTools.get('read');
  env.listen(({ respond }) => respond({ ok: true }));
  assert.doesNotThrow(() => env.api.mount());
  assert.equal(env.nativeTools.get('read'), external);
  env.callMcp('postMessage_read', {}, 60);
  await nextTurn();
  assert.deepEqual(plain(env.responses(60)[0].message.result), { ok: true });
  assert.doesNotThrow(() => env.api.configure({ webMCP: false }));
  assert.equal(env.nativeTools.get('read'), external);
});

test('invalid native exposure configuration publishes no tools and retires previous registrations', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  env.api.mount();
  const staleTool = registeredTool(env);
  env.api.configure({ webMCP: { tools: ['read'], exposedTo: ['*'] } });
  assert.equal(env.nativeTools.has('read'), false);
  await assert.rejects(staleTool.execute({}), { name: 'AbortError' });
  for (const webMCP of [{}, true, { tools: 'read' }, { tools: [] }]) {
    env.api.configure({ webMCP });
    assert.equal(env.nativeTools.size, 0);
  }
});

test('asynchronous native registration denial leaves MCP usable', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  env.document.modelContext.registerTool = () => Promise.reject(new DOMException('Registration denied', 'NotAllowedError'));
  env.listen(({ respond }) => respond('available through MCP'));
  assert.doesNotThrow(() => env.api.mount());
  await nextTurn();
  env.callMcp('postMessage_read', {}, 61);
  await nextTurn();
  assert.equal(env.nativeTools.size, 0);
  assert.equal(env.responses(61)[0].message.result, 'available through MCP');
  assert.ok(env.warnings.length > 0);
});

test('postMessage validates the iframe sender and origin and pins every outbound destination', async () => {
  const env = loadLoader({ config: { tools: [pageTool()], webMCP: { tools: ['read'] } } });
  let executions = 0;
  env.listen(({ respond }) => { executions += 1; respond('ok'); });
  env.api.mount();
  env.callMcp('postMessage_read', {}, 70, { source: {} });
  env.callMcp('postMessage_read', {}, 71, { origin: 'https://attacker.example' });
  env.receive({ source: 'ozwell-chat-widget', type: 'ready' }, { origin: 'https://attacker.example' });
  await nextTurn();
  assert.equal(executions, 0);
  assert.equal(env.posts.length, 0);
  env.receive({ source: 'ozwell-chat-widget', type: 'ready' });
  await nextTurn();
  env.api.configure({ title: 'Updated' });
  env.receive({ jsonrpc: '2.0', id: 72, method: 'initialize' });
  env.callMcp('postMessage_read', {}, 73);
  await nextTurn();
  assert.equal(executions, 1);
  assert.ok(env.posts.length >= 4);
  assert.ok(env.posts.every(({ targetOrigin }) => targetOrigin === FRAME_ORIGIN));
  const configs = env.posts.filter(({ message }) => message.type === 'config');
  assert.ok(configs.length > 0);
  assert.ok(configs.every(({ message }) => !('webMCP' in message.payload.config)), 'Host-only WebMCP settings must not be sent to the iframe');
});
