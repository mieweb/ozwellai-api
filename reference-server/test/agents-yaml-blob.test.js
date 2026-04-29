import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEMO_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3333;
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
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-test-'));
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

const H_JSON = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEMO_KEY}` };
const H_YAML = { 'Content-Type': 'application/yaml', 'Authorization': `Bearer ${DEMO_KEY}` };

test('agents route — YAML blob round-trip preserves comments and ordering', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const yamlInput = `# This comment must survive the round-trip
name: Pirate Bot
instructions: |
  Yo ho ho! Speak like a pirate.
model: gpt-4o-mini
temperature: 0.7
tools:
  - show_map
  - steer_ship
behavior:
  tone: swashbuckling
  rules:
    - Never break character
custom_unknown_field: 42
`;

        // Create
        const createRes = await fetch(`${BASE}/v1/agents`, {
            method: 'POST',
            headers: H_YAML,
            body: yamlInput
        });
        assert.equal(createRes.status, 201, 'create should return 201');
        const created = await createRes.json();
        assert.ok(created.agent_id);
        assert.ok(created.agent_key);

        // Fetch
        const getRes = await fetch(`${BASE}/v1/agents/${created.agent_id}`, {
            headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        assert.equal(getRes.status, 200);
        const fetched = await getRes.json();

        // YAML must come back byte-identical
        assert.equal(fetched.yaml, yamlInput, 'yaml round-trip byte-identical');
        assert.equal(fetched.name, 'Pirate Bot');
        assert.equal(fetched.model, 'gpt-4o-mini');
        assert.deepEqual(fetched.tools, ['show_map', 'steer_ship']);
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — PUT preserves custom YAML verbatim', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const yaml1 = `name: Bot
instructions: First version
model: gpt-4o-mini
`;
        const create = await fetch(`${BASE}/v1/agents`, { method: 'POST', headers: H_YAML, body: yaml1 });
        const { agent_id } = await create.json();

        const yaml2 = `# Second revision with a comment
name: Bot
instructions: |
  Updated instructions
  with multiple lines.
model: gpt-4o
extra_future_field: still_here
`;
        const put = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            method: 'PUT', headers: H_YAML, body: yaml2
        });
        assert.equal(put.status, 200);

        const get = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        const body = await get.json();
        assert.equal(body.yaml, yaml2, 'updated yaml byte-identical');
        assert.equal(body.model, 'gpt-4o');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — list + delete flow', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const yamlInput = `name: Disposable\ninstructions: Go away\n`;
        const create = await fetch(`${BASE}/v1/agents`, { method: 'POST', headers: H_YAML, body: yamlInput });
        const { agent_id } = await create.json();

        const list = await fetch(`${BASE}/v1/agents`, { headers: { 'Authorization': `Bearer ${DEMO_KEY}` } });
        const listBody = await list.json();
        assert.ok(listBody.data.some(a => a.id === agent_id), 'agent appears in list');

        const del = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        assert.equal(del.status, 200);

        const listAfter = await fetch(`${BASE}/v1/agents`, { headers: { 'Authorization': `Bearer ${DEMO_KEY}` } });
        const listAfterBody = await listAfter.json();
        assert.ok(!listAfterBody.data.some(a => a.id === agent_id), 'agent gone after delete');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — invalid YAML rejected', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const res = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'not: : valid: yaml: ::'
        });
        assert.equal(res.status, 400);

        const noName = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'instructions: hi\n'
        });
        assert.equal(noName.status, 400);

        const noInstr = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: x\n'
        });
        assert.equal(noInstr.status, 400);
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — JSON wrapper {yaml: "..."} works too', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();

        const yamlInput = `name: Wrap\ninstructions: test\n`;
        const res = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_JSON, body: JSON.stringify({ yaml: yamlInput })
        });
        assert.equal(res.status, 201);
        const { agent_id } = await res.json();

        const get = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        const body = await get.json();
        assert.equal(body.yaml, yamlInput);
    } finally {
        stopServer(server, tmp);
    }
});

const HINT_PATTERN = /^agnt_key-\.\.\.[a-z0-9]{4}$/;

test('agents route — create returns full key + hint, list masks key', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: K1\ninstructions: hi\n'
        });
        assert.equal(create.status, 201);
        const created = await create.json();
        assert.match(created.agent_key, /^agnt_key-/, 'create returns full key');
        assert.match(created.key_hint, HINT_PATTERN, 'create returns hint');
        assert.equal(created.key_hint, `agnt_key-...${created.agent_key.slice(-4)}`);

        const list = await fetch(`${BASE}/v1/agents`, { headers: { 'Authorization': `Bearer ${DEMO_KEY}` } });
        const body = await list.json();
        const row = body.data.find(a => a.id === created.agent_id);
        assert.ok(row, 'agent in list');
        assert.equal(row.agent_key, undefined, 'list response has no agent_key');
        assert.match(row.key_hint, HINT_PATTERN, 'list row has key_hint');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — GET :id and PUT :id mask key', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: K2\ninstructions: hi\n'
        });
        const { agent_id } = await create.json();

        const get = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        const getBody = await get.json();
        assert.equal(getBody.agent_key, undefined, 'GET :id has no agent_key');
        assert.match(getBody.key_hint, HINT_PATTERN, 'GET :id has key_hint');

        const put = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            method: 'PUT', headers: H_YAML, body: 'name: K2 updated\ninstructions: hi2\n'
        });
        const putBody = await put.json();
        assert.equal(putBody.agent_key, undefined, 'PUT :id has no agent_key');
        assert.match(putBody.key_hint, HINT_PATTERN, 'PUT :id has key_hint');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — reveal-key returns full key with parent auth', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: R1\ninstructions: hi\n'
        });
        const { agent_id, agent_key: originalKey } = await create.json();

        const reveal = await fetch(`${BASE}/v1/agents/${agent_id}/reveal-key`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        assert.equal(reveal.status, 200);
        assert.match(reveal.headers.get('cache-control') || '', /no-store/, 'no-store header set');
        const revealBody = await reveal.json();
        assert.equal(revealBody.agent_key, originalKey, 'reveal returns same key as create');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — reveal-key rejects agent key auth', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: R2\ninstructions: hi\n'
        });
        const { agent_id, agent_key } = await create.json();

        const reveal = await fetch(`${BASE}/v1/agents/${agent_id}/reveal-key`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${agent_key}` }
        });
        assert.equal(reveal.status, 401, 'agent key cannot reveal');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — rotate-key invalidates old, new key validates', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: Rot\ninstructions: hi\n'
        });
        const { agent_id, agent_key: oldKey } = await create.json();

        const rotate = await fetch(`${BASE}/v1/agents/${agent_id}/rotate-key`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        assert.equal(rotate.status, 200);
        assert.match(rotate.headers.get('cache-control') || '', /no-store/);
        const rotateBody = await rotate.json();
        assert.match(rotateBody.agent_key, /^agnt_key-/);
        assert.notEqual(rotateBody.agent_key, oldKey, 'new key differs from old');
        assert.match(rotateBody.key_hint, HINT_PATTERN);
        assert.ok(typeof rotateBody.rotated_at === 'number');

        // Old key no longer validates
        const oldValidate = await fetch(`${BASE}/v1/keys/validate`, {
            headers: { 'Authorization': `Bearer ${oldKey}` }
        });
        assert.equal(oldValidate.status, 401, 'old key invalid after rotate');

        // New key validates
        const newValidate = await fetch(`${BASE}/v1/keys/validate`, {
            headers: { 'Authorization': `Bearer ${rotateBody.agent_key}` }
        });
        assert.equal(newValidate.status, 200, 'new key validates');
    } finally {
        stopServer(server, tmp);
    }
});

test('agents route — corrupt stored YAML returns 500 (Aaron fix)', async () => {
    const { server, tmp } = startServer();
    try {
        await waitForReady();
        const create = await fetch(`${BASE}/v1/agents`, {
            method: 'POST', headers: H_YAML, body: 'name: Doomed\ninstructions: hi\n'
        });
        const { agent_id } = await create.json();

        // Corrupt the row directly via sqlite (bypasses server validation)
        const Database = require('better-sqlite3');
        const dbPath = path.join(tmp, 'ozwell.db');
        const db = new Database(dbPath);
        db.prepare('UPDATE agents SET yaml = ? WHERE id = ?').run('[unclosed: bracket', agent_id);
        db.close();

        const get = await fetch(`${BASE}/v1/agents/${agent_id}`, {
            headers: { 'Authorization': `Bearer ${DEMO_KEY}` }
        });
        assert.equal(get.status, 500, 'corrupt YAML surfaces as 500');
    } finally {
        stopServer(server, tmp);
    }
});
