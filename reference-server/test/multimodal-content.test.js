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
const PORT = 3335;
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
    tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-multimodal-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
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

// A tiny 1x1 transparent PNG as a data URL — a real image_url payload shape.
const SAMPLE_IMAGE_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

test('multimodal content — array of text + image_url is accepted (no 400/validation error)', async () => {
    const body = JSON.stringify({
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'hello' },
                    { type: 'image_url', image_url: { url: SAMPLE_IMAGE_URL } },
                ],
            },
        ],
    });

    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    // Must NOT reject with 400 FST_ERR_VALIDATION.
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.object, 'chat.completion');
    assert.equal(j.choices[0].message.role, 'assistant');
    // The text part ("hello") should drive the deterministic greeting reply,
    // proving the content array was flattened to text rather than crashing on
    // `userMessage.toLowerCase is not a function`.
    assert.match(j.choices[0].message.content, /Hello/);
});

test('multimodal content — streaming array request completes without crashing', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
            stream: true,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hello' },
                        { type: 'image_url', image_url: { url: SAMPLE_IMAGE_URL } },
                    ],
                },
            ],
        }),
    });

    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);

    const text = await r.text();
    assert.ok(text.includes('data: [DONE]'), 'stream terminates with [DONE]');
    assert.ok(text.includes('"finish_reason":"stop"'), 'final chunk has stop');
});

test('multimodal content — image_url-only array does not crash and returns a response', async () => {
    const body = JSON.stringify({
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: SAMPLE_IMAGE_URL } },
                ],
            },
        ],
    });

    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.object, 'chat.completion');
    assert.equal(j.choices[0].message.role, 'assistant');
    assert.equal(typeof j.choices[0].message.content, 'string');
});

test('multimodal content — file content part (PDF as base64 data URL) is accepted', async () => {
    const body = JSON.stringify({
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Analyze this document' },
                    { type: 'file', file: { file_data: 'data:application/pdf;base64,JVBERi0xLjQK', filename: 'test.pdf' } },
                ],
            },
        ],
    });

    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: H, body });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.object, 'chat.completion');
    assert.equal(j.choices[0].message.role, 'assistant');
});

test('multimodal content — file content part streams without crashing', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
            stream: true,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Summarize this file' },
                        { type: 'file', file: { file_data: 'data:text/csv;base64,bmFtZSxhZ2UKSm9obiwyNQ==', filename: 'data.csv' } },
                    ],
                },
            ],
        }),
    });

    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    const text = await r.text();
    assert.ok(text.includes('data: [DONE]'), 'stream terminates with [DONE]');
});

test('multimodal content — invalid object content is rejected', async () => {
    const r = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
            messages: [{ role: 'user', content: { unexpected: 'object' } }],
        }),
    });

    assert.equal(r.status, 400);
    const j = await r.json();
    assert.equal(j.error.type, 'invalid_request_error');
    assert.equal(j.error.param, 'messages[0].content');
});
