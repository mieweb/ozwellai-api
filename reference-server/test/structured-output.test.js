import { test, before, after } from 'node:test';
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

// Keep MOCK_KEY in sync with MOCK_AGENT_KEY in src/storage/agents.ts.
const MOCK_KEY = 'agnt_key-mock-test';

// Trusted forward-auth headers auto-provision a real parent key (non-mock),
// which routes to the configured LLM backend — required to observe forwarding.
// Header scheme matches readForwardedIdentity(): x-user is the external id and
// x-email is the required stable identity key.
const MANAGER_EXTERNAL_ID = '9112';
const MANAGER_HEADERS = {
    'x-user': MANAGER_EXTERNAL_ID,
    'x-preferred-username': 'structtest',
    'x-user-first-name': 'Struct',
    'x-user-last-name': 'Test',
    'x-email': 'structtest@example.test',
    'x-groups': 'ldapusers',
};

// The json_schema payload a workspace structured-output service would send
// (mirrors ShortSummarySchema: { title, shortSummary }).
const SHORT_SUMMARY_FORMAT = {
    type: 'json_schema',
    json_schema: {
        name: 'short_summary',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                shortSummary: { type: 'string' },
            },
            required: ['title', 'shortSummary'],
            additionalProperties: false,
        },
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
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-structured-test-'));
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
// deterministic non-streaming chat.completion whose content is JSON matching
// the requested schema.
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
            const payload = {
                id: 'chatcmpl_e2e',
                object: 'chat.completion',
                created: 1,
                model: 'test-struct-model',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: JSON.stringify({ title: 'Med refill', shortSummary: 'Patient requested a refill.' }),
                    },
                    finish_reason: 'stop',
                }],
                usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            };
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(payload));
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

// ---------------------------------------------------------------------------
// Acceptance: body validation must not reject json_schema / json_object.
// (mieweb/ozwellai-api#112 — AJV removeAdditional previously stripped it.)
// ---------------------------------------------------------------------------

const ACCEPT_PORT = 3338;
const ACCEPT_BASE = `http://localhost:${ACCEPT_PORT}`;
let acceptServer;
let acceptTmp;

before(async () => {
    ({ server: acceptServer, tmp: acceptTmp } = startServer(ACCEPT_PORT, { ALLOW_MOCK: '' }));
    await waitForReady(ACCEPT_BASE);
});

after(() => stopServer(acceptServer, acceptTmp));

const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MOCK_KEY}` };

test('response_format json_schema is accepted (not rejected by body validation)', async () => {
    const r = await fetch(`${ACCEPT_BASE}/v1/chat/completions`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'summarize this' }], response_format: SHORT_SUMMARY_FORMAT }),
    });
    assert.equal(r.status, 200, 'json_schema request must not be rejected');
    const j = await r.json();
    assert.equal(j.object, 'chat.completion');
});

test('response_format json_object is accepted', async () => {
    const r = await fetch(`${ACCEPT_BASE}/v1/chat/completions`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], response_format: { type: 'json_object' } }),
    });
    assert.equal(r.status, 200);
});

// ---------------------------------------------------------------------------
// End-to-end: the json_schema payload must survive AJV and be forwarded to the
// upstream provider intact, and structured JSON must round-trip back.
// ---------------------------------------------------------------------------

test('e2e — response_format json_schema is forwarded to upstream intact', async () => {
    const upstream = await startCapturingLLMServer();
    const { server, tmp, dbPath } = startServer(3339, {
        TRUST_FORWARD_AUTH_HEADERS: 'true',
        LLM_BASE_URL: upstream.baseURL,
        LLM_API_KEY: 'test-upstream-key',
        LLM_PROVIDER: '',
        LLM_MODEL: 'test-struct-model',
        ALLOW_MOCK: '',
    });
    const base = 'http://localhost:3339';
    try {
        await waitForReady(base);
        // Auto-provision a real (non-mock) parent key.
        await fetch(`${base}/v1/manager/me`, { headers: MANAGER_HEADERS });
        const key = getActiveParentKey(dbPath, MANAGER_EXTERNAL_ID);

        const chat = await fetch(`${base}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: 'test-struct-model',
                messages: [{ role: 'user', content: 'Summarize: patient requested a refill.' }],
                response_format: SHORT_SUMMARY_FORMAT,
            }),
        });
        assert.equal(chat.status, 200);

        // 1. The upstream received response_format with the json_schema intact.
        const forwarded = upstream.getCapturedBody();
        assert.ok(forwarded, 'upstream should have received a request');
        assert.deepEqual(
            forwarded.response_format,
            SHORT_SUMMARY_FORMAT,
            'json_schema payload must be forwarded to the provider without being stripped',
        );

        // 2. Structured JSON round-trips back to the caller.
        const j = await chat.json();
        const parsed = JSON.parse(j.choices[0].message.content);
        assert.deepEqual(parsed, { title: 'Med refill', shortSummary: 'Patient requested a refill.' });
    } finally {
        stopServer(server, tmp);
        await upstream.close();
    }
});
