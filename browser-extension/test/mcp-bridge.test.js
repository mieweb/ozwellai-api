import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../mcp-bridge.js', import.meta.url), 'utf8');
const names = ['browser_snapshot', 'browser_click', 'browser_fill', 'browser_select', 'browser_scroll'];
const tools = names.map(name => ({ name, description: name, inputSchema: { type: 'object' } }));
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(options = {}) {
  const sent = [], timers = new Map();
  const context = vm.createContext({ AbortController,
    setTimeout: (callback, duration) => { const id = Symbol(); timers.set(id, { callback, duration }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source, context);
  const bridge = context.__ozwellCreateMcpBridge({ getTools: async () => tools, post: message => sent.push(structuredClone(message)), ...options });
  const request = (method, id, params) => bridge.handle({ jsonrpc: '2.0', method, id, params });
  return { bridge, sent, timers, request };
}

test('MCP advertises exactly five prefixed page tools and dispatches raw names and arguments', async () => {
  const calls = [];
  const page = fixture({
    getTools: async () => [...tools, { name: 'executeJavascript' }, { name: 'postMessage_browser_click' }],
    callTool: async (name, args, options) => { calls.push({ name, args, signal: options.signal }); return { content: [{ type: 'text', text: 'ok' }] }; },
  });
  page.request('initialize', 1);
  page.request('tools/list', 2);
  await settle();
  assert.equal(page.sent[0].result.protocolVersion, '2025-11-25');
  assert.deepEqual(page.sent.find(message => message.id === 2).result.tools.map(tool => tool.name), names.map(name => `postMessage_${name}`));
  page.request('tools/call', 3, { name: 'postMessage_browser_fill', arguments: { snapshotId: 'snapshot', index: 4, value: 'Draft' } });
  await settle();
  assert.equal(calls[0].name, 'browser_fill');
  assert.deepEqual(calls[0].args, { snapshotId: 'snapshot', index: 4, value: 'Draft' });
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(page.sent.find(message => message.id === 3).result.content[0].text, 'ok');
  assert.equal(page.timers.size, 0);
});

test('MCP rejects unadvertised tools and arbitrary methods, while unauthorized discovery remains chat-safe', async () => {
  let callCount = 0;
  const page = fixture({ isAuthorized: () => false, callTool: () => { callCount++; } });
  page.request('tools/list', 'list');
  page.request('tools/call', 'call', { name: 'postMessage_browser_snapshot' });
  page.request('chrome.tabs.query', 'arbitrary');
  page.request('ping', 'ping');
  await settle();
  assert.deepEqual(page.sent.find(message => message.id === 'list').result.tools, []);
  assert.equal(page.sent.find(message => message.id === 'call').error.code, -32602);
  assert.equal(page.sent.find(message => message.id === 'arbitrary').error.code, -32601);
  assert.deepEqual(page.sent.find(message => message.id === 'ping').result, {});
  assert.equal(callCount, 0);
});

test('cancellation during discovery aborts the request before it can execute or reply', async () => {
  const discovery = deferred();
  let signal, calls = 0;
  const page = fixture({ getTools: ({ signal: value }) => { signal = value; return discovery.promise; }, callTool: () => { calls++; } });
  page.request('tools/call', 17, { name: 'postMessage_browser_click' });
  await settle();
  page.bridge.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 17 } });
  assert.equal(signal.aborted, true);
  discovery.resolve(tools);
  await settle();
  assert.equal(calls, 0);
  assert.deepEqual(page.sent, []);
  assert.equal(page.timers.size, 0);
});

test('cancellation targets exact numeric or string IDs and duplicate in-flight IDs cannot replace a request', async () => {
  const requests = [];
  const page = fixture({ callTool: (name, args, { signal }) => { const pending = deferred(); requests.push({ signal, ...pending }); return pending.promise; } });
  page.request('tools/call', 1, { name: 'postMessage_browser_snapshot' });
  page.request('tools/call', 1, { name: 'postMessage_browser_snapshot' });
  page.request('tools/call', '1', { name: 'postMessage_browser_snapshot' });
  await settle();
  assert.equal(requests.length, 2);
  page.bridge.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  requests[0].resolve({ cancelled: true });
  requests[1].resolve({ completed: true });
  await settle();
  assert.deepEqual(page.sent, [{ jsonrpc: '2.0', id: '1', result: { completed: true } }]);
});

test('timeout aborts page work and reports exactly one error, ignoring late results', async () => {
  const pending = deferred();
  let signal;
  const page = fixture({ callTool: (name, args, options) => { signal = options.signal; return pending.promise; } });
  page.request('tools/call', 9, { name: 'postMessage_browser_click' });
  await settle();
  const timeout = [...page.timers.values()].find(timer => timer.duration === 29000);
  assert.ok(timeout);
  timeout.callback();
  assert.equal(signal.aborted, true);
  assert.match(page.sent[0].error.message, /timed out/);
  pending.resolve({ late: true });
  await settle();
  assert.equal(page.sent.length, 1);
});

test('reset cancels the old session, allows ID reuse, and dispose prevents future requests', async () => {
  const requests = [];
  const page = fixture({ callTool: (name, args, { signal }) => { const pending = deferred(); requests.push({ signal, ...pending }); return pending.promise; } });
  page.request('tools/call', 4, { name: 'postMessage_browser_snapshot' });
  await settle();
  page.bridge.reset();
  assert.equal(requests[0].signal.aborted, true);
  page.request('tools/call', 4, { name: 'postMessage_browser_snapshot' });
  await settle();
  requests[0].resolve({ old: true });
  requests[1].resolve({ fresh: true });
  await settle();
  assert.deepEqual(page.sent, [{ jsonrpc: '2.0', id: 4, result: { fresh: true } }]);
  page.bridge.dispose();
  page.request('initialize', 5);
  page.request('tools/list', 6);
  await settle();
  assert.equal(page.sent.length, 1);
  assert.equal(page.timers.size, 0);
});
