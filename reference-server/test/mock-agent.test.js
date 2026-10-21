import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { waitForServer } from './helpers/wait-for-server.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Keep MOCK_KEY in sync with MOCK_AGENT_KEY in src/storage/agents.ts.
// Test file is plain JS (no TS imports) so the constant cannot be pulled directly.
const MOCK_KEY = 'agnt_key-mock-test';
const PORT = 3334;
const BASE = `http://localhost:${PORT}`;

let server;
let tmp;

before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-mock-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    // Spawn the prebuilt server with node directly (not `npm start`): npm is
    // npm.cmd on Windows and `spawn('npm')` fails with ENOENT without a shell.
    server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'development', ALLOW_MOCK: '' }
    });
    await waitForServer(server, BASE);
});

after(() => {
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_KEY}` };

test('mock agent — non-stream returns deterministic content for greeting', async () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });

    const r1 = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.object, 'chat.completion');
    assert.equal(j1.choices[0].finish_reason, 'stop');
    assert.equal(j1.choices[0].message.role, 'assistant');
    assert.match(j1.choices[0].message.content, /Hello/);
    assert.equal(j1.warning?.type, 'mock_response');
    assert.equal(j1.warning?.reason, 'mock_agent');

    const r2 = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    const j2 = await r2.json();
    assert.equal(j1.choices[0].message.content, j2.choices[0].message.content,
        'same input produces identical content');
});

test('mock agent — emits tool_calls for action phrases (proves full pipeline)', async () => {
    const body = JSON.stringify({
        messages: [{ role: 'user', content: 'update name to Bob' }]
    });

    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    assert.equal(r.status, 200);
    const j = await r.json();

    const msg = j.choices[0].message;
    assert.equal(j.choices[0].finish_reason, 'tool_calls');
    assert.ok(Array.isArray(msg.tool_calls), 'tool_calls present');
    assert.equal(msg.tool_calls[0].function.name, 'update_form_data');
    const args = JSON.parse(msg.tool_calls[0].function.arguments);
    assert.equal(args.name, 'Bob');
});

test('mock agent — streaming text response ends with stop', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], stream: true })
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);

    const text = await r.text();
    assert.ok(text.includes('data: [DONE]'), 'stream terminates with [DONE]');
    assert.ok(text.includes('"role":"assistant"'), 'role chunk emitted');
    assert.ok(text.includes('"finish_reason":"stop"'), 'final chunk has stop');
    assert.ok(text.includes('event: warning'), 'warning event emitted');
    assert.ok(text.includes('"reason":"mock_agent"'), 'warning reason is mock_agent');
});

test('mock agent — streaming tool-call response ends with tool_calls', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'update name to Bob' }], stream: true })
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);

    const text = await r.text();
    assert.ok(text.includes('data: [DONE]'), 'stream terminates with [DONE]');
    assert.ok(text.includes('"tool_calls"'), 'tool call chunk emitted');
    assert.ok(text.includes('"name":"update_form_data"'), 'legacy requests retain the bare tool name');
    assert.ok(text.includes('"finish_reason":"tool_calls"'), 'final chunk has tool_calls');
});

const advertisedTool = (name) => ({ type: 'function', function: { name, parameters: { type: 'object' } } });

async function requestToolResponse(content, tools, stream, headers = H) {
    const response = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content }], tools, stream }),
    });
    assert.equal(response.status, 200);
    if (!stream) {
        const body = await response.json();
        return { toolCalls: body.choices[0].message.tool_calls, finishReason: body.choices[0].finish_reason };
    }
    const text = await response.text();
    assert.ok(text.includes('data: [DONE]'));
    const choices = text.split('\n')
        .filter((line) => line.startsWith('data: {'))
        .flatMap((line) => JSON.parse(line.slice(6)).choices || []);
    return {
        toolCalls: choices.flatMap((choice) => choice.delta.tool_calls || []),
        finishReason: choices.at(-1).finish_reason,
    };
}

for (const stream of [false, true]) {
    test(`mock agent — ${stream ? 'streaming' : 'non-stream'} calls use the advertised tool namespace`, async (t) => {
        const scenarios = [
            ['update name to Bob', 'update_form_data'],
            ['what is my address', 'get_form_data'],
            ['play center', 'make_move'],
            ['reset game', 'reset_game'],
        ];
        for (const [content, bareName] of scenarios) {
            for (const prefix of ['', 'postMessage_', 'postMessage:']) {
                const name = prefix + bareName;
                await t.test(name, async () => {
                    const result = await requestToolResponse(content, [advertisedTool(name)], stream);
                    assert.equal(result.finishReason, 'tool_calls');
                    assert.equal(result.toolCalls.length, 1);
                    assert.equal(result.toolCalls[0].function.name, name);
                });
            }
        }
    });

    test(`mock agent — ${stream ? 'streaming' : 'non-stream'} does not fabricate unadvertised tools`, async () => {
        for (const tools of [[], [advertisedTool('postMessage_get_form_data')]]) {
            const result = await requestToolResponse('update name to Bob', tools, stream);
            assert.equal(result.finishReason, 'stop');
            assert.equal(result.toolCalls?.length || 0, 0);
        }
    });

    test(`mock agent — ${stream ? 'streaming' : 'non-stream'} prefers an advertised bare name`, async () => {
        const tools = ['postMessage_update_form_data', 'update_form_data'].map(advertisedTool);
        const result = await requestToolResponse('update name to Bob', tools, stream);
        assert.equal(result.toolCalls[0].function.name, 'update_form_data');
    });
}

test('mock agent — agent policy excludes advertised tools before mock generation', async () => {
    const response = await fetch(`${BASE}/v1/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/yaml', Authorization: 'Bearer ozw_demo_localhost_key_for_testing' },
        body: `name: Restricted Mock
type: mock
instructions: Deterministic mock with restricted tools.
tools:
  - get_form_data
pageTools:
  blocked:
    - update_form_data
`,
    });
    assert.equal(response.status, 201);
    const { agent_key } = await response.json();
    const tools = ['', 'postMessage_', 'postMessage:'].map((prefix) => advertisedTool(prefix + 'update_form_data'));
    for (const stream of [false, true]) {
        const result = await requestToolResponse('update name to Bob', tools, stream, {
            ...H, Authorization: `Bearer ${agent_key}`,
        });
        assert.equal(result.finishReason, 'stop');
        assert.equal(result.toolCalls?.length || 0, 0);
    }
});

test('mock agent — unauthenticated request rejected', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
    });
    assert.equal(r.status, 401);
});
