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
const OTHER_MANAGER_HEADERS = {
    'x-user-id': '2010',
    'x-username': 'otheruser',
    'x-user-first-name': 'Other',
    'x-user-last-name': 'User',
    'x-email': 'other@example.test',
    'x-groups': 'ldapusers',
};
const OTHER_H_YAML = { 'Content-Type': 'application/yaml', ...OTHER_MANAGER_HEADERS };

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

function startServer({ trustHeaders = true, adminExternalUserIds = '' } = {}) {
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
            ADMIN_EXTERNAL_USER_IDS: adminExternalUserIds,
            ALLOW_MOCK: 'true',
            LLM_ALLOWED_MODELS: 'gpt-4o-mini,gpt-4o',
            OLLAMA_BASE_URL: '',
            NODE_ENV: 'development',
        }
    });
    return { server, tmp, dbPath };
}

function stopServer(server, tmp) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

function getUserAndActiveKey(dbPath) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get(MANAGER_HEADERS['x-user-id']);
        assert.ok(user?.id, 'manager user should exist');
        const key = db.prepare("SELECT id, key, status FROM api_keys WHERE user_id = ? AND COALESCE(status, 'active') = 'active' AND revoked_at IS NULL").get(user.id);
        assert.ok(key?.id, 'manager user should have an active parent key');
        return { user, key };
    } finally {
        db.close();
    }
}

function seedClaimableKey(dbPath) {
    const db = new Database(dbPath);
    try {
        db.prepare(`
          INSERT INTO api_keys (id, name, key, key_hint, created_at, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            'existing-key',
            'Existing Key',
            'ozw_existing_parent_key_for_testing',
            'ting',
            new Date().toISOString(),
            'active',
        );
        db.prepare(`
          INSERT INTO agents (id, agent_key, parent_key, yaml, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
            'existing-agent',
            'agnt_key-existing-test',
            'existing-key',
            'name: Existing Agent\ninstructions: Already owned by old key\n',
            Math.floor(Date.now() / 1000),
        );
    } finally {
        db.close();
    }
}

function getUserByExternalId(dbPath, externalUserId) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT * FROM users WHERE external_user_id = ?').get(externalUserId);
        assert.ok(user?.id, `manager user ${externalUserId} should exist`);
        return user;
    } finally {
        db.close();
    }
}

function getActiveKeyForExternalUser(dbPath, externalUserId) {
    const db = new Database(dbPath);
    try {
        const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get(externalUserId);
        assert.ok(user?.id, `manager user ${externalUserId} should exist`);
        const key = db.prepare(`
          SELECT id
          FROM api_keys
          WHERE user_id = ?
            AND COALESCE(status, 'active') = 'active'
            AND revoked_at IS NULL
        `).get(user.id);
        assert.ok(key?.id, `manager user ${externalUserId} should have active key`);
        return key;
    } finally {
        db.close();
    }
}

test('manager auth — /v1/me alias is not exposed', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const res = await fetch(`${BASE}/v1/me`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 404);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — /v1/manager/me auto-provisions user and parent key from trusted headers', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();

        const res = await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.identity.external_user_id, '2009');
        assert.equal(body.identity.username, 'adamerla');
        assert.equal(body.identity.email, 'adamerla128@gmail.com');
        assert.equal(body.status, 'active');
        assert.equal(body.is_admin, false);
        assert.equal(body.has_parent_key, true);
        assert.equal(body.provisioned, true);
        assert.match(body.parent_key_hint, /^ozw_\.\.\.[a-z0-9]{4}$/);

        const db = new Database(dbPath);
        try {
            const user = db.prepare('SELECT external_user_id, username, email, status, is_admin FROM users WHERE external_user_id = ?').get('2009');
            assert.deepEqual(user, {
                external_user_id: '2009',
                username: 'adamerla',
                email: 'adamerla128@gmail.com',
                status: 'active',
                is_admin: 0,
            });
            const key = db.prepare('SELECT id, key, user_id, status FROM api_keys WHERE user_id = ?').get('mgr_2009');
            assert.ok(key.id);
            assert.match(key.key, /^ozw_/);
            assert.doesNotMatch(key.key, /^ozw_manager-/);
            assert.equal(key.status, 'active');
        } finally {
            db.close();
        }
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — can reveal the active parent key explicitly', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        const { key } = getUserAndActiveKey(dbPath);

        const res = await fetch(`${BASE}/v1/manager/parent-key/reveal`, {
            method: 'POST',
            headers: MANAGER_HEADERS,
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.parent_key, key.key);
        assert.equal(body.parent_key_id, key.id);
        assert.match(body.parent_key_hint, /^ozw_\.\.\.[a-z0-9]{4}$/);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — active users can create/list/update/reveal/rotate/delete agents', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });

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
        const listedAgent = listBody.data.find(agent => agent.id === created.agent_id);
        assert.ok(listedAgent);
        assert.deepEqual(listedAgent.metrics, {
            request_count: 0,
            error_count: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            last_used_at: null,
        });

        const get = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, { headers: MANAGER_HEADERS });
        assert.equal(get.status, 200);
        const getBody = await get.json();
        assert.equal(getBody.yaml, yaml1);
        assert.deepEqual(getBody.metrics, {
            request_count: 0,
            error_count: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            last_used_at: null,
        });

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

test('manager auth — users cannot access or mutate agents owned by another manager user', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        await fetch(`${BASE}/v1/manager/me`, { headers: OTHER_MANAGER_HEADERS });

        const create = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: `name: Owner Bot\ninstructions: Owned by first manager user\n`,
        });
        assert.equal(create.status, 201);
        const created = await create.json();

        const otherList = await fetch(`${BASE}/v1/manager/agents`, { headers: OTHER_MANAGER_HEADERS });
        assert.equal(otherList.status, 200);
        const otherListBody = await otherList.json();
        assert.ok(!otherListBody.data.some(agent => agent.id === created.agent_id));

        const get = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, { headers: OTHER_MANAGER_HEADERS });
        assert.equal(get.status, 404);

        const update = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, {
            method: 'PUT',
            headers: OTHER_H_YAML,
            body: `name: Stolen Bot\ninstructions: Should not update\n`,
        });
        assert.equal(update.status, 404);

        const reveal = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}/reveal-key`, {
            method: 'POST',
            headers: OTHER_MANAGER_HEADERS,
        });
        assert.equal(reveal.status, 404);

        const rotate = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}/rotate-key`, {
            method: 'POST',
            headers: OTHER_MANAGER_HEADERS,
        });
        assert.equal(rotate.status, 404);

        const del = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, {
            method: 'DELETE',
            headers: OTHER_MANAGER_HEADERS,
        });
        assert.equal(del.status, 404);

        const ownerGet = await fetch(`${BASE}/v1/manager/agents/${created.agent_id}`, { headers: MANAGER_HEADERS });
        assert.equal(ownerGet.status, 200);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — claim-key moves auto-key agents to claimed parent key and revokes auto key', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        const { key: autoKey } = getUserAndActiveKey(dbPath);
        seedClaimableKey(dbPath);

        const created = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: `name: Temporary Agent\ninstructions: Created before old key claim\n`,
        });
        assert.equal(created.status, 201);
        const createdBody = await created.json();

        const claim = await fetch(`${BASE}/v1/manager/claim-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...MANAGER_HEADERS },
            body: JSON.stringify({ parent_key: 'ozw_existing_parent_key_for_testing' }),
        });
        assert.equal(claim.status, 200);
        const claimBody = await claim.json();
        assert.equal(claimBody.parent_key_id, 'existing-key');
        assert.equal(claimBody.migrated_agents, 1);
        assert.equal(claimBody.revoked_parent_key_id, autoKey.id);

        const list = await fetch(`${BASE}/v1/manager/agents`, { headers: MANAGER_HEADERS });
        assert.equal(list.status, 200);
        const listBody = await list.json();
        assert.ok(listBody.data.some(agent => agent.id === 'existing-agent'), 'claimed key existing agent is listed');
        assert.ok(listBody.data.some(agent => agent.id === createdBody.agent_id), 'temporary agent moved to claimed key is listed');

        const db = new Database(dbPath);
        try {
            const user = db.prepare('SELECT id FROM users WHERE external_user_id = ?').get('2009');
            const claimedKey = db.prepare('SELECT user_id, status, revoked_at FROM api_keys WHERE id = ?').get('existing-key');
            assert.equal(claimedKey.user_id, user.id);
            assert.equal(claimedKey.status, 'active');
            assert.equal(claimedKey.revoked_at, null);

            const oldAutoKey = db.prepare('SELECT user_id, status, revoked_at, revoked_reason, replaced_by_key_id FROM api_keys WHERE id = ?').get(autoKey.id);
            assert.equal(oldAutoKey.user_id, null);
            assert.equal(oldAutoKey.status, 'revoked');
            assert.ok(oldAutoKey.revoked_at);
            assert.equal(oldAutoKey.revoked_reason, 'replaced_by_claimed_key');
            assert.equal(oldAutoKey.replaced_by_key_id, 'existing-key');

            const movedAgent = db.prepare('SELECT parent_key FROM agents WHERE id = ?').get(createdBody.agent_id);
            assert.equal(movedAgent.parent_key, 'existing-key');
        } finally {
            db.close();
        }
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — claim-key rejects keys already linked to another manager user', async () => {
    const { server, tmp, dbPath } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        seedClaimableKey(dbPath);

        const db = new Database(dbPath);
        try {
            db.prepare(`
              INSERT INTO users (id, external_user_id, username, status)
              VALUES (?, ?, ?, ?)
            `).run('mgr_other', '9999', 'other', 'active');
            db.prepare('UPDATE api_keys SET user_id = ? WHERE id = ?').run('mgr_other', 'existing-key');
        } finally {
            db.close();
        }

        const claim = await fetch(`${BASE}/v1/manager/claim-key`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...MANAGER_HEADERS },
            body: JSON.stringify({ parent_key: 'ozw_existing_parent_key_for_testing' }),
        });
        assert.equal(claim.status, 409);
        const body = await claim.json();
        assert.equal(body.error.code, 'parent_key_already_claimed');
    } finally {
        stopServer(server, tmp);
    }
});

test('manager auth — /v1/manager/models returns allowed models without bearer auth', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });

        const res = await fetch(`${BASE}/v1/manager/models`, { headers: MANAGER_HEADERS });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.deepEqual(body.data.map(model => model.id), ['gpt-4o-mini', 'gpt-4o']);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager admin — bootstrap admin can view users and non-admin cannot', async () => {
    const { server, tmp } = startServer({ adminExternalUserIds: '2009' });
    try {
        await waitForReady();

        const adminMe = await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        assert.equal(adminMe.status, 200);
        assert.equal((await adminMe.json()).is_admin, true);

        await fetch(`${BASE}/v1/manager/me`, { headers: OTHER_MANAGER_HEADERS });

        const users = await fetch(`${BASE}/v1/manager/admin/users`, { headers: MANAGER_HEADERS });
        assert.equal(users.status, 200);
        const usersBody = await users.json();
        const adminUser = usersBody.data.find(user => user.external_user_id === '2009');
        const otherUser = usersBody.data.find(user => user.external_user_id === '2010');
        assert.equal(adminUser.is_admin, true);
        assert.match(adminUser.current_parent_key.key_hint, /^ozw_\.\.\.[a-z0-9]{4}$/);
        assert.equal(adminUser.current_parent_key.status, 'active');
        assert.equal(adminUser.current_parent_key.revoked_at, null);
        assert.equal(adminUser.agent_count, 0);
        assert.equal(adminUser.metrics.request_count, 0);
        assert.equal(otherUser.is_admin, false);
        assert.match(otherUser.current_parent_key.key_hint, /^ozw_\.\.\.[a-z0-9]{4}$/);

        const denied = await fetch(`${BASE}/v1/manager/admin/users`, { headers: OTHER_MANAGER_HEADERS });
        assert.equal(denied.status, 403);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager admin — can promote and demote users with self-demote guard', async () => {
    const { server, tmp, dbPath } = startServer({ adminExternalUserIds: '2009' });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        await fetch(`${BASE}/v1/manager/me`, { headers: OTHER_MANAGER_HEADERS });
        const other = getUserByExternalId(dbPath, '2010');

        const promote = await fetch(`${BASE}/v1/manager/admin/users/${other.id}/promote`, {
            method: 'POST',
            headers: MANAGER_HEADERS,
        });
        assert.equal(promote.status, 200);
        assert.equal((await promote.json()).is_admin, true);

        const selfDemote = await fetch(`${BASE}/v1/manager/admin/users/${other.id}/demote`, {
            method: 'POST',
            headers: OTHER_MANAGER_HEADERS,
        });
        assert.equal(selfDemote.status, 400);
        assert.equal((await selfDemote.json()).error.code, 'cannot_demote_self');

        const demote = await fetch(`${BASE}/v1/manager/admin/users/${other.id}/demote`, {
            method: 'POST',
            headers: MANAGER_HEADERS,
        });
        assert.equal(demote.status, 200);
        assert.equal((await demote.json()).is_admin, false);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager admin — revoking a parent key disables agent keys under it', async () => {
    const { server, tmp, dbPath } = startServer({ adminExternalUserIds: '2009' });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });
        await fetch(`${BASE}/v1/manager/me`, { headers: OTHER_MANAGER_HEADERS });

        const create = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: OTHER_H_YAML,
            body: `name: Other Mock\ninstructions: Mock for revoke test\ntype: mock\n`,
        });
        assert.equal(create.status, 201);
        const created = await create.json();
        const otherParentKey = getActiveKeyForExternalUser(dbPath, '2010');

        const revoke = await fetch(`${BASE}/v1/manager/admin/parent-keys/${otherParentKey.id}/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...MANAGER_HEADERS },
            body: JSON.stringify({ reason: 'test_revoke' }),
        });
        assert.equal(revoke.status, 200);
        const revokeBody = await revoke.json();
        assert.equal(revokeBody.status, 'revoked');
        assert.equal(revokeBody.revoked_reason, 'test_revoke');

        const chat = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${created.agent_key}`,
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'hello' }],
            }),
        });
        assert.equal(chat.status, 401);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager admin — user-first APIs include key history, agents, and usage metrics', async () => {
    const { server, tmp } = startServer({ adminExternalUserIds: '2009' });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });

        const create = await fetch(`${BASE}/v1/manager/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: `name: Usage Mock\ninstructions: Mock for usage metrics\ntype: mock\n`,
        });
        assert.equal(create.status, 201);
        const created = await create.json();

        const chat = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${created.agent_key}`,
            },
            body: JSON.stringify({
                messages: [{ role: 'user', content: 'hello usage' }],
            }),
        });
        assert.equal(chat.status, 200);

        const summary = await fetch(`${BASE}/v1/manager/admin/summary`, { headers: MANAGER_HEADERS });
        assert.equal(summary.status, 200);
        const summaryBody = await summary.json();
        assert.equal(summaryBody.usage.requests_total, 1);
        assert.ok(summaryBody.usage.total_tokens > 0);

        const users = await fetch(`${BASE}/v1/manager/admin/users`, { headers: MANAGER_HEADERS });
        assert.equal(users.status, 200);
        const userRow = (await users.json()).data.find(user => user.external_user_id === '2009');
        assert.equal(userRow.agent_count, 1);
        assert.equal(userRow.metrics.request_count, 1);
        assert.ok(userRow.metrics.total_tokens > 0);
        assert.equal(userRow.current_parent_key.metrics.request_count, 1);
        assert.ok(userRow.current_parent_key.metrics.total_tokens > 0);

        const detail = await fetch(`${BASE}/v1/manager/admin/users/${userRow.id}`, { headers: MANAGER_HEADERS });
        assert.equal(detail.status, 200);
        const detailBody = await detail.json();
        assert.equal(detailBody.user.external_user_id, '2009');
        assert.equal(detailBody.parent_keys.length, 1);
        assert.equal(detailBody.parent_keys[0].metrics.request_count, 1);
        assert.ok(detailBody.parent_keys[0].metrics.total_tokens > 0);
        const agentRow = detailBody.agents.find(agent => agent.id === created.agent_id);
        assert.equal(agentRow.metrics.request_count, 1);
        assert.ok(agentRow.metrics.total_tokens > 0);

        const ownAgents = await fetch(`${BASE}/v1/manager/agents`, { headers: MANAGER_HEADERS });
        assert.equal(ownAgents.status, 200);
        const ownAgentRow = (await ownAgents.json()).data.find(agent => agent.id === created.agent_id);
        assert.equal(ownAgentRow.metrics.request_count, 1);
        assert.ok(ownAgentRow.metrics.total_tokens > 0);
    } finally {
        stopServer(server, tmp);
    }
});

test('manager admin — global key and agent table routes are not exposed', async () => {
    const { server, tmp } = startServer({ adminExternalUserIds: '2009' });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: MANAGER_HEADERS });

        const parentKeys = await fetch(`${BASE}/v1/manager/admin/parent-keys`, { headers: MANAGER_HEADERS });
        assert.equal(parentKeys.status, 404);

        const agents = await fetch(`${BASE}/v1/manager/admin/agents`, { headers: MANAGER_HEADERS });
        assert.equal(agents.status, 404);
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
