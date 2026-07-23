import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = 3342;
const BASE = `http://localhost:${PORT}`;
const HEADERS = {
    'x-user': 'admin-user',
    'x-preferred-username': 'testadmin',
    'x-user-first-name': 'Test',
    'x-user-last-name': 'Admin',
    'x-email': 'test-admin@example.test',
    'x-groups': 'ldapusers',
};
const H_JSON = { 'Content-Type': 'application/json', ...HEADERS };
const H_YAML = { 'Content-Type': 'application/yaml', ...HEADERS };

async function waitForReady(maxMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            if ((await fetch(`${BASE}/health`)).status === 200) return;
        } catch { /* not ready */ }
        await delay(200);
    }
    throw new Error('server never became ready');
}

function startServer({ admin = false, extraEnv = {} } = {}) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-provider-model-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    const server = spawn('npm', ['run', 'dev'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: {
            ...process.env,
            PORT: String(PORT),
            DB_PATH: dbPath,
            TRUST_FORWARD_AUTH_HEADERS: 'true',
            ADMIN_EXTERNAL_USER_IDS: admin ? 'admin-user' : '',
            ALLOW_MOCK: 'true',
            LLM_BASE_URL: '',
            LLM_API_KEY: '',
            LLM_PROVIDER: '',
            OLLAMA_BASE_URL: '',
            MODEL_DISCOVERY_REFRESH_MS: '0',
            NODE_ENV: 'development',
            ...extraEnv,
        },
    });
    return { server, tmp, dbPath };
}

function stopServer(server, tmp) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function startGateway(modelsByProvider = { openai: ['gpt-4o-mini', 'gpt-4o'] }) {
    let chatCount = 0;
    let modelCount = 0;
    let lastBody = null;
    let lastHeaders = null;
    const server = createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/v1/models') {
            modelCount += 1;
            const provider = req.headers['x-portkey-provider'];
            const models = modelsByProvider[provider] || [];
            if (!models.length) {
                res.writeHead(404, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'provider unavailable' } }));
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                object: 'list',
                data: models.map(id => ({ id, object: 'model', owned_by: provider })),
            }));
            return;
        }

        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.writeHead(404).end();
            return;
        }

        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            chatCount += 1;
            lastHeaders = req.headers;
            lastBody = JSON.parse(raw);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
                id: 'chatcmpl_provider_test',
                object: 'chat.completion',
                created: 1,
                model: lastBody.model,
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            }));
        });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        baseURL: `http://127.0.0.1:${server.address().port}`,
        getChatCount: () => chatCount,
        getModelCount: () => modelCount,
        getLastBody: () => lastBody,
        getLastHeaders: () => lastHeaders,
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

function activeKey(dbPath) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get('admin-user');
        return db.prepare(`
          SELECT id, key FROM api_keys
          WHERE user_id = ? AND COALESCE(status, 'active') = 'active' AND revoked_at IS NULL
        `).get(user.id);
    } finally {
        db.close();
    }
}

test('provider models — discovery populates provider-aware registry and effective uses cache', async () => {
    const gateway = await startGateway({
        openai: ['gpt-4o-mini', 'text-embedding-3-small'],
        anthropic: ['claude-sonnet-4-5'],
    });
    const { server, tmp, dbPath } = startServer({
        extraEnv: {
            LLM_BASE_URL: gateway.baseURL,
            LLM_API_KEY: 'test-key',
            LLM_PROVIDER: 'openai',
        },
    });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });

        const models = await fetch(`${BASE}/v1/manager/models`, { headers: HEADERS });
        assert.equal(models.status, 200);
        assert.deepEqual(
            (await models.json()).data.map(model => `${model.provider}/${model.model}`),
            ['openai/gpt-4o-mini', 'openai/text-embedding-3-small', 'anthropic/claude-sonnet-4-5'],
        );

        const key = activeKey(dbPath);
        const before = gateway.getModelCount();
        const effective = await fetch(`${BASE}/v1/models/effective`, {
            headers: { Authorization: `Bearer ${key.key}` },
        });
        assert.equal(effective.status, 200);
        assert.deepEqual(
            (await effective.json()).data.map(model => `${model.provider}/${model.model}`),
            ['openai/gpt-4o-mini', 'openai/text-embedding-3-small', 'anthropic/claude-sonnet-4-5'],
        );
        assert.equal(gateway.getModelCount(), before);
    } finally {
        stopServer(server, tmp);
        await gateway.close();
    }
});

test('provider models — parent and agent restrictions narrow consumer choices', async () => {
    const { server, tmp, dbPath } = startServer({ admin: true });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });
        const key = activeKey(dbPath);

        const parentPolicy = await fetch(`${BASE}/v1/manager/admin/parent-keys/${key.id}/model-restrictions`, {
            method: 'PUT',
            headers: H_JSON,
            body: JSON.stringify({
                allowed_models: [
                    { provider: 'openai', model: 'gpt-4o-mini' },
                    { provider: 'openai', model: 'gpt-4o' },
                ],
            }),
        });
        assert.equal(parentPolicy.status, 200);

        const create = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: `name: Narrow Agent
instructions: Test model restrictions
`,
        });
        assert.equal(create.status, 201);
        const { agent_id, agent_key } = await create.json();

        const agentPolicy = await fetch(`${BASE}/v1/manager/agents/${agent_id}/model-policy`, {
            method: 'PUT',
            headers: H_JSON,
            body: JSON.stringify({
                default_model: { provider: 'openai', model: 'gpt-4o-mini' },
                allowed_models: [{ provider: 'openai', model: 'gpt-4o-mini' }],
            }),
        });
        assert.equal(agentPolicy.status, 200);

        const effective = await fetch(`${BASE}/v1/models/effective`, {
            headers: { Authorization: `Bearer ${agent_key}` },
        });
        assert.equal(effective.status, 200);
        assert.deepEqual(
            (await effective.json()).data.map(model => `${model.provider}/${model.model}`),
            ['openai/gpt-4o-mini'],
        );
    } finally {
        stopServer(server, tmp);
    }
});

test('provider models — chat enforces allowed provider/model before gateway call', async () => {
    const gateway = await startGateway();
    const { server, tmp, dbPath } = startServer({
        admin: true,
        extraEnv: {
            LLM_BASE_URL: gateway.baseURL,
            LLM_API_KEY: 'test-key',
            LLM_MODEL: 'gpt-4o',
            ALLOW_MOCK: '',
        },
    });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });
        const key = activeKey(dbPath);

        const policy = await fetch(`${BASE}/v1/manager/admin/parent-keys/${key.id}/model-restrictions`, {
            method: 'PUT',
            headers: H_JSON,
            body: JSON.stringify({ allowed_models: [{ provider: 'openai', model: 'gpt-4o' }] }),
        });
        assert.equal(policy.status, 200);

        const allowed = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}` },
            body: JSON.stringify({
                provider: 'openai',
                model: 'gpt-4o',
                messages: [{ role: 'user', content: 'allowed' }],
            }),
        });
        assert.equal(allowed.status, 200);
        assert.equal(gateway.getLastHeaders()['x-portkey-provider'], 'openai');
        assert.equal(gateway.getLastBody().model, 'gpt-4o');

        const blocked = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}` },
            body: JSON.stringify({
                provider: 'openai',
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: 'blocked' }],
            }),
        });
        assert.equal(blocked.status, 403);
        assert.equal((await blocked.json()).error.code, 'model_not_allowed');
        assert.equal(gateway.getChatCount(), 1);
    } finally {
        stopServer(server, tmp);
        await gateway.close();
    }
});

test('provider models — ambiguous legacy model-only request requires provider', async () => {
    const gateway = await startGateway({
        openai: ['shared-model'],
        anthropic: ['shared-model'],
    });
    const { server, tmp, dbPath } = startServer({
        extraEnv: {
            LLM_BASE_URL: gateway.baseURL,
            LLM_API_KEY: 'test-key',
            LLM_MODEL: 'shared-model',
            ALLOW_MOCK: '',
        },
    });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });
        const models = await fetch(`${BASE}/v1/manager/models`, { headers: HEADERS });
        assert.equal(models.status, 200);
        const key = activeKey(dbPath);

        const response = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}` },
            body: JSON.stringify({
                model: 'shared-model',
                messages: [{ role: 'user', content: 'ambiguous' }],
            }),
        });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'provider_required');
        assert.equal(gateway.getChatCount(), 0);
    } finally {
        stopServer(server, tmp);
        await gateway.close();
    }
});
