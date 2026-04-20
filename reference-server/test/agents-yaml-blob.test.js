import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
