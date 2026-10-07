import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

const directory = mkdtempSync(path.join(tmpdir(), 'ozwell-key-identity-'));
process.env.DB_PATH = path.join(directory, 'identity.db');
const { getDatabase, initializeAuthTables } = await import('../dist/reference-server/src/storage/agents.js');
const { default: route } = await import('../dist/reference-server/src/routes/api-key-identity.js');
const db = getDatabase();
initializeAuthTables(db);

const addUser = db.prepare('INSERT INTO users (id, external_user_id, email, status) VALUES (?, ?, ?, ?)');
addUser.run('owner', 'oidc-owner', 'Owner@Example.test', 'active');
addUser.run('other', 'oidc-other', 'other@example.test', 'active');
addUser.run('disabled', 'oidc-disabled', 'disabled@example.test', 'disabled');
addUser.run('pending', 'oidc-pending', 'pending@example.test', 'pending');
addUser.run('no-email', 'oidc-no-email', null, 'active');

const addKey = db.prepare('INSERT INTO api_keys (id, name, key, key_hint, user_id, status, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
for (const [id, owner, status, revokedAt] of [
    ['active', 'owner', 'active', null],
    ['other', 'other', 'active', null],
    ['disabled-key', 'owner', 'disabled', null],
    ['revoked-key', 'owner', 'revoked', null],
    ['revoked-at', 'owner', 'active', '2026-01-01'],
    ['unowned', null, 'active', null],
    ['disabled-owner', 'disabled', 'active', null],
    ['pending-owner', 'pending', 'active', null],
    ['no-email', 'no-email', 'active', null],
    ['missing-owner', 'missing', 'active', null],
]) {
    addKey.run(id, id, `ozw_${id}`, id, owner, status, revokedAt);
    db.prepare('INSERT INTO agents (id, agent_key, parent_key, yaml, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(`agent-${id}`, `agnt_key-${id}`, id, 'name: Test\ninstructions: Stay scoped\n', 1);
}

const app = Fastify();
await app.register(route.default ?? route);
after(async () => {
    await app.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
});

function verify(token, email = 'owner@example.test', extraHeaders = {}) {
    return app.inject({
        method: 'POST', url: '/auth/api-key/identity',
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        payload: { email },
    });
}

function snapshot() {
    return ['users', 'api_keys', 'agents'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
}

test('parent and agent keys return their existing owner without granting another credential', async () => {
    const before = snapshot();
    for (const token of ['ozw_active', 'agnt_key-active']) {
        const response = await verify(token, '  OWNER@example.TEST  ');
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.deepEqual(response.json(), { email: 'Owner@Example.test', user_id: 'owner' });
        assert.ok(!response.body.includes(token));
        assert.ok(!response.headers['set-cookie']);
    }
    assert.deepEqual(snapshot(), before, 'identity lookup must not provision users, claim keys, or change agent ownership');
});

test('invalid, unowned, inactive, revoked and mismatched identities share one rejection', async () => {
    const before = snapshot();
    const denied = await verify('ozw_missing');
    assert.equal(denied.statusCode, 401);
    const expected = denied.json();
    for (const [token, email] of [
        [undefined, 'owner@example.test'], ['sess_existing_session', 'owner@example.test'],
        ['ozw_active', 'other@example.test'], ['agnt_key-active', 'other@example.test'],
        ['ozw_active', ''],
        ...['disabled-key', 'revoked-key', 'revoked-at', 'unowned', 'disabled-owner', 'pending-owner', 'no-email', 'missing-owner']
            .flatMap(id => {
                const email = id === 'disabled-owner' ? 'disabled@example.test'
                    : id === 'pending-owner' ? 'pending@example.test' : 'owner@example.test';
                return [[`ozw_${id}`, email], [`agnt_key-${id}`, email]];
            }),
    ]) {
        const response = await verify(token, email);
        assert.equal(response.statusCode, 401, `${token}: ${response.body}`);
        assert.deepEqual(response.json(), expected);
    }
    const spoofed = await verify('ozw_active', 'other@example.test', { 'x-email': 'other@example.test', 'x-user': 'other' });
    assert.equal(spoofed.statusCode, 401);
    assert.deepEqual(spoofed.json(), expected);
    const wrongScheme = await verify(undefined, 'owner@example.test', { authorization: 'Basic ozw_active' });
    assert.equal(wrongScheme.statusCode, 401);
    assert.deepEqual(snapshot(), before);
});

test('parent revocation immediately denies both the parent key and its agent key', async () => {
    db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = 'active'").run();
    try {
        for (const token of ['ozw_active', 'agnt_key-active']) {
            assert.equal((await verify(token)).statusCode, 401);
        }
    } finally {
        db.prepare("UPDATE api_keys SET revoked_at = NULL WHERE id = 'active'").run();
    }
});

test('agent identity follows current ownership while retaining the original agent key', async () => {
    db.prepare("UPDATE agents SET parent_key = 'other' WHERE id = 'agent-active'").run();
    try {
        assert.equal((await verify('agnt_key-active')).statusCode, 401);
        const response = await verify('agnt_key-active', 'other@example.test');
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), { email: 'other@example.test', user_id: 'other' });
    } finally {
        db.prepare("UPDATE agents SET parent_key = 'active' WHERE id = 'agent-active'").run();
    }
});
