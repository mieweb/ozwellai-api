import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DEMO_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3341;
const BASE = `http://localhost:${PORT}`;

const MANAGER_HEADERS = {
    'x-user-id': '2009',
    'x-username': 'adamerla',
    'x-user-first-name': 'A',
    'x-user-last-name': 'Damerla',
    'x-email': 'adamerla128@gmail.com',
    'x-groups': 'ldapusers',
};

const H_YAML = { 'Content-Type': 'application/yaml', ...MANAGER_HEADERS };

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

function startServer({ trustHeaders = true } = {}) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-manager-auth-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    const server = spawn('npm', ['run', 'dev'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: {
            ...process.env,
            PORT: String(PORT),
            DB_PATH: dbPath,
            TRUST_FORWARD_AUTH_HEADERS: trustHeaders ? 'true' : 'false',
            NODE_ENV: 'development',
        }
    });
    return { server, tmp, dbPath };
}

function stopServer(server, tmp) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

function provisionManagerUser(dbPath) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get(MANAGER_HEADERS['x-user-id']);
        assert.ok(user?.id, 'manager user should have been created before provisioning');
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run('active', user.id);
        db.prepare('UPDATE api_keys SET user_id = ?, status = ?, revoked_at = NULL WHERE id = ?')
            .run(user.id, 'active', 'demo-key');
    } finally {
        db.close();
    }
}

test('manager auth — /v1/me rejects when trusted headers are disabled', async () => {
    const { server, tmp } = startServer({ trustHeaders: false });
    try {
        await waitForReady();
        const res = await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 401);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — /v1/me creates pending user from trusted headers', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();

        const res = await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.identity.external_user_id, '2009');
        assert.equal(body.identity.username, 'adamerla');
        assert.equal(body.identity.email, 'adamerla128@gmail.com');
        assert.equal(body.status, 'pending');
        assert.equal(body.is_admin, false);
        assert.equal(body.has_parent_key, false);
        assert.equal(body.provisioned, false);

        const db = new Database(dbPath);
        try {
            const user = db.prepare('SELECT external_user_id, username, email, status, is_admin FROM users WHERE external_user_id = ?').get('2009');
            assert.deepEqual(user, {
                external_user_id: '2009',
                username: 'adamerla',
                email: 'adamerla128@gmail.com',
                status: 'pending',
                is_admin: 0,
            });
        } finally {
            db.close();
        }
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — /v1/me reports provisioned after user is linked to active parent key', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        provisionManagerUser(dbPath);

        const res = await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.status, 'active');
        assert.equal(body.has_parent_key, true);
        assert.equal(body.provisioned, true);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — pending users cannot use manager agent routes', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });

        const res = await fetch(`${BASE}/v1/manager/agents`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.error.code, 'user_not_provisioned');
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — active users can create/list/update/reveal/rotate/delete agents', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        provisionManagerUser(dbPath);

        const yaml1 = `name: Manager Bot\ninstructions: Original instructions\n`;
        const create = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: yaml1,
        });
        assert.equal(create.status, 201);
        const created = await create.json();
        assert.ok(created.agent_id);
        assert.match(created.agent_key, /^agnt_key-/);

        const list = await fetch(`${BASE}/v1/manager/agents`, { headers: MANAGER_HEADERS });
        assert.equal(list.status, 200);
        const listBody = await list.json();
        assert.ok(listBody.data.some(agent => agent.id === created.agent_id));

        const get = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, { headers: MANAGER_HEADERS });
        assert.equal(get.status, 200);
        const getBody = await get.json();
        assert.equal(getBody.yaml, yaml1);

        const yaml2 = `name: Manager Bot\ninstructions: Updated instructions\nmodel: gpt-4o-mini\n`;
        const update = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, {
            method: 'PUT',
            headers: H_YAML,
            body: yaml2,
        });
        assert.equal(update.status, 200);
        const updateBody = await update.json();
        assert.equal(updateBody.yaml, yaml2);
        assert.equal(updateBody.updated, true);

        const reveal = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}/reveal-key`, {
            method: 'POST',
            headers: MANAGER_HEADERS,
        });
        assert.equal(reveal.status, 200);
        const revealBody = await reveal.json();
        assert.equal(revealBody.agent_key, created.agent_key);

        const rotate = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}/rotate-key`, {
            method: 'POST',
            headers: MANAGER_HEADERS,
        });
        assert.equal(rotate.status, 200);
        const rotateBody = await rotate.json();
        assert.notEqual(rotateBody.agent_key, created.agent_key);

        const del = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, {
            method: 'DELETE',
            headers: MANAGER_HEADERS,
        });
        assert.equal(del.status, 200);
        assert.deepEqual(await del.json(), { id: created.agent_id, deleted: true });
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — existing parent-key agent route still works', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const res = await fetch(`${BASE}/v1/agents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/yaml',
                'Authorization': `Bearer ${DEMO_KEY}`,
            },
            body: `name: Parent Key Bot\ninstructions: Existing auth path\n`,
        });
        assert.equal(res.status, 201);
        const body = await res.json();
        assert.match(body.agent_key, /^agnt_key-/);
    } finally {
        stopServer(server, tmp);
    }
});
