import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
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

async function waitForReady(maxMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const r = await fetch(`${BASE}/health`);
            if (r.status === 200) return;
        } catch { /* not ready */ }
        await delay(200);
    }
    throw new Error('server never became ready');
}

before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-mock-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    server = spawn('npm', ['run', 'dev'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'development' }
    });
    await waitForReady();
});

after(() => {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
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
    assert.ok(text.includes('"finish_reason":"tool_calls"'), 'final chunk has tool_calls');
});

test('mock agent — unauthenticated request rejected', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] })
    });
    assert.equal(r.status, 401);
});
