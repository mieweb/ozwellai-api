import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// Trusted forward-auth headers auto-provision a real parent key (non-mock),
// which routes to the configured LLM backend, required to observe forwarding.
const MANAGER_EXTERNAL_ID = '9113';
const MANAGER_HEADERS = {
    'x-user': MANAGER_EXTERNAL_ID,
    'x-preferred-username': 'reasoningtest',
    'x-user-first-name': 'Reasoning',
    'x-user-last-name': 'Test',
    'x-email': 'reasoningtest@example.test',
    'x-groups': 'ldapusers',
};

// One page tool, shaped like the ones the widget forwards from the host page.
const PAGE_TOOL = {
    type: 'function',
    function: {
        name: 'postMessage_get_page_data',
        description: 'Get data from the current page',
        parameters: { type: 'object', properties: {}, required: [] },
    },
};

async function waitForReady(base, maxMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            const r = await fetch(`${base}/health`);
            if (r.status === 200) return;
        } catch { /* not ready */ }
        await delay(200);
    }
    throw new Error('server never became ready');
}

function startServer(port, extraEnv = {}) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-reasoning-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    const server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'development', ...extraEnv },
    });
    return { server, tmp, dbPath };
}

function stopServer(server, tmp) {
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Fake upstream LLM that records the forwarded request body and returns a
// deterministic non-streaming chat.completion.
async function startCapturingLLMServer() {
    let capturedBody = null;
    const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.writeHead(404).end();
            return;
        }
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
            capturedBody = JSON.parse(raw);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl_reasoning',
                object: 'chat.completion',
                created: 1,
                model: capturedBody.model,
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address();
    return {
        baseURL: `http://127.0.0.1:${port}`,
        getCapturedBody: () => capturedBody,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

function getActiveParentKey(dbPath, externalUserId) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get(externalUserId);
        assert.ok(user?.id, 'manager user should exist');
        const key = db.prepare("SELECT key FROM api_keys WHERE user_id = ? AND COALESCE(status, 'active') = 'active' AND revoked_at IS NULL").get(user.id);
        assert.ok(key?.key, 'manager user should have an active parent key');
        return key.key;
    } finally {
        db.close();
    }
}

async function forwardedBodyFor(port, model, { tools } = {}) {
    const upstream = await startCapturingLLMServer();
    const { server, tmp, dbPath } = startServer(port, {
        TRUST_FORWARD_AUTH_HEADERS: 'true',
        LLM_BASE_URL: upstream.baseURL,
        LLM_API_KEY: 'test-upstream-key',
        LLM_PROVIDER: '',
        LLM_MODEL: model,
        ALLOW_MOCK: '',
    });
    const base = `http://localhost:${port}`;
    try {
        await waitForReady(base);
        // Auto-provision a real (non-mock) parent key.
        await fetch(`${base}/v1/manager/me`, { headers: MANAGER_HEADERS });
        const key = getActiveParentKey(dbPath, MANAGER_EXTERNAL_ID);

        const chat = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: "What's my name?" }],
                ...(tools && { tools }),
            }),
        });
        assert.equal(chat.status, 200);

        const forwarded = upstream.getCapturedBody();
        assert.ok(forwarded, 'upstream should have received a request');
        return forwarded;
    } finally {
        stopServer(server, tmp);
        await upstream.close();
    }
}

// ---------------------------------------------------------------------------
// gpt-5.6 models reject function tools on /v1/chat/completions unless
// reasoning_effort is 'none' (mieweb/ozwellai-api#283).
// ---------------------------------------------------------------------------

test('gpt-5.6 request carrying tools is forwarded with reasoning_effort none', async () => {
    const forwarded = await forwardedBodyFor(3343, 'gpt-5.6-sol', { tools: [PAGE_TOOL] });

    assert.equal(forwarded.reasoning_effort, 'none');
    assert.equal(forwarded.tools.length, 1);
});

test('gpt-5.6 request without tools is forwarded unchanged', async () => {
    const forwarded = await forwardedBodyFor(3344, 'gpt-5.6-sol');

    assert.equal(forwarded.reasoning_effort, undefined);
});

test('non-5.6 model carrying tools is forwarded unchanged', async () => {
    const forwarded = await forwardedBodyFor(3345, 'gpt-4o-mini', { tools: [PAGE_TOOL] });

    assert.equal(forwarded.reasoning_effort, undefined);
});
