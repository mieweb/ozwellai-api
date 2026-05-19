import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DEMO_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3336;
const BASE = `http://localhost:${PORT}`;

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

function startServer() {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-admin-keys-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    const server = spawn('npm', ['run', 'dev'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'development' }
    });
    return { server, tmp };
}

function stopServer(server, tmp) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

function headers(key = DEMO_KEY, extra = {}) {
    return { Authorization: `Bearer ${key}`, ...extra };
}

async function jsonFetch(pathname, options = {}) {
    const response = await fetch(`${BASE}${pathname}`, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
}

test('admin API keys route — admin can create, list, rename, and revoke parent keys', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const create = await jsonFetch('/v1/admin/api-keys', {
            method: 'POST',
            headers: headers(DEMO_KEY, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: 'Aaron Demo Key', owner: 'Aaron', role: 'user' })
        });
        assert.equal(create.response.status, 201);
        assert.match(create.body.key, /^ozw_/);
        assert.equal(create.body.name, 'Aaron Demo Key');
        assert.equal(create.body.owner, 'Aaron');
        assert.equal(create.body.role, 'user');

        const createdKey = create.body.key;

        const list = await jsonFetch('/v1/admin/api-keys', { headers: headers() });
        assert.equal(list.response.status, 200);
        const row = list.body.data.find(k => k.id === create.body.id);
        assert.ok(row, 'created key appears in list');
        assert.equal(row.key, undefined, 'list does not expose full key');
        assert.equal(row.key_hint, create.body.key_hint);
        assert.equal(row.revoked_at, null);

        const rename = await jsonFetch(`/v1/admin/api-keys/${encodeURIComponent(create.body.id)}`, {
            method: 'PATCH',
            headers: headers(DEMO_KEY, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: 'Aaron Prod Key', owner: 'Anshul', role: 'admin' })
        });
        assert.equal(rename.response.status, 200);
        assert.equal(rename.body.name, 'Aaron Prod Key');
        assert.equal(rename.body.owner, 'Anshul');
        assert.equal(rename.body.role, 'admin');

        const revoke = await jsonFetch(`/v1/admin/api-keys/${encodeURIComponent(create.body.id)}/revoke`, {
            method: 'POST',
            headers: headers()
        });
        assert.equal(revoke.response.status, 200);
        assert.ok(revoke.body.revoked_at);

        const validate = await jsonFetch('/v1/keys/validate', {
            headers: headers(createdKey)
        });
        assert.equal(validate.response.status, 401, 'revoked key no longer validates');

        const createAgent = await jsonFetch('/v1/agents', {
            method: 'POST',
            headers: headers(createdKey, { 'Content-Type': 'application/yaml' }),
            body: 'name: Blocked\ninstructions: should not work\n'
        });
        assert.equal(createAgent.response.status, 401, 'revoked key cannot manage agents');
    } finally {
        stopServer(server, tmp);
    }
});

test('admin API keys route — non-admin parent key cannot manage keys', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const create = await jsonFetch('/v1/admin/api-keys', {
            method: 'POST',
            headers: headers(DEMO_KEY, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: 'Regular User Key', owner: 'User', role: 'user' })
        });
        assert.equal(create.response.status, 201);

        const denied = await jsonFetch('/v1/admin/api-keys', {
            headers: headers(create.body.key)
        });
        assert.equal(denied.response.status, 403);
    } finally {
        stopServer(server, tmp);
    }
});

test('admin API keys route — list includes agents created by each parent key', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const createKey = await jsonFetch('/v1/admin/api-keys', {
            method: 'POST',
            headers: headers(DEMO_KEY, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ name: 'Agent Owner Key', owner: 'Agent Owner', role: 'user' })
        });
        assert.equal(createKey.response.status, 201);

        const createAgent = await jsonFetch('/v1/agents', {
            method: 'POST',
            headers: headers(createKey.body.key, { 'Content-Type': 'application/yaml' }),
            body: [
                'name: Intake Assistant',
                'instructions: Help with intake questions.',
                'model: gpt-4.1-mini',
                ''
            ].join('\n')
        });
        assert.equal(createAgent.response.status, 201);

        const list = await jsonFetch('/v1/admin/api-keys', { headers: headers() });
        assert.equal(list.response.status, 200);

        const row = list.body.data.find(k => k.id === createKey.body.id);
        assert.ok(row, 'created key appears in admin key list');
        assert.ok(Array.isArray(row.agents), 'admin key row includes agents array');
        assert.equal(row.agents.length, 1);
        assert.equal(row.agents[0].id, createAgent.body.agent_id);
        assert.equal(row.agents[0].name, 'Intake Assistant');
        assert.equal(row.agents[0].model, 'gpt-4.1-mini');
        assert.equal(row.agents[0].key_hint, createAgent.body.key_hint);
        assert.equal(row.agents[0].agent_key, undefined, 'admin key list does not expose full agent keys');
    } finally {
        stopServer(server, tmp);
    }
});

test('admin API keys route — CORS preflight allows editing parent keys', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const response = await fetch(`${BASE}/v1/admin/api-keys/demo-key`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://localhost:8080',
                'Access-Control-Request-Method': 'PATCH',
                'Access-Control-Request-Headers': 'authorization,content-type',
            },
        });

        assert.equal(response.status, 204);
        assert.match(response.headers.get('access-control-allow-methods') || '', /\bPATCH\b/);
    } finally {
        stopServer(server, tmp);
    }
});
