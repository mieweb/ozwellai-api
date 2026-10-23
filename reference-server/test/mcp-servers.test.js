// Remote MCP servers on agents: per-tool allowlist, per-agent write-only secrets,
// discovery, and the server-side tool loop in chat completions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = 3361;
const BASE = `http://localhost:${PORT}`;
const SECRET = 'wc-super-secret-token';
const HEADERS = {
    'x-user': 'mcp-user',
    'x-email': 'mcp-user@example.test',
    'x-preferred-username': 'mcpuser',
};

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => resolve(raw ? JSON.parse(raw) : undefined));
    });
}

async function listen(handler) {
    const requests = [];
    const server = createServer(async (req, res) => {
        const body = await readBody(req);
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res, body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        baseURL: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
    };
}

function fakeMcp() {
    const calls = [];
    return listen(async (req, res, body) => {
        if (req.headers.authorization !== `Bearer ${SECRET}`) {
            res.writeHead(401).end();
            return;
        }
        const server = new McpServer({ name: 'fake-webchart', version: '1.0.0' });
        server.tool('json_post_inject', 'Inject a JSON payload', async () => {
            calls.push('json_post_inject');
            return { content: [{ type: 'text', text: 'injected-ok' }] };
        });
        server.tool('delete_everything', 'Must never be exposed', async () => {
            calls.push('delete_everything');
            return { content: [{ type: 'text', text: 'boom' }] };
        });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', () => { transport.close(); server.close(); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
    }).then(srv => ({ ...srv, calls }));
}

function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

function fakeGateway() {
    return listen((req, res, body) => {
        if (req.method === 'GET' && req.url === '/v1/models') {
            return json(res, 200, { object: 'list', data: [{ id: 'gpt-4o-mini' }] });
        }
        const toolMsg = body.messages.find(m => m.role === 'tool');
        const message = toolMsg
            ? { role: 'assistant', content: `done: ${toolMsg.content}` }
            : {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'mcp__webchart__json_post_inject', arguments: '{"a":1}' } }],
            };
        json(res, 200, {
            id: 'chatcmpl_gw', object: 'chat.completion', created: 1, model: body.model,
            choices: [{ index: 0, message, finish_reason: toolMsg ? 'stop' : 'tool_calls' }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        });
    });
}

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

function startServer(extraEnv) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-mcp-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    const server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: {
            ...process.env,
            PORT: String(PORT),
            DB_PATH: dbPath,
            TRUST_FORWARD_AUTH_HEADERS: 'true',
            ALLOW_MOCK: '',
            OPENAI_API_KEY: '',
            ANTHROPIC_API_KEY: '',
            OLLAMA_BASE_URL: '',
            MODEL_DISCOVERY_REFRESH_MS: '0',
            NODE_ENV: 'development',
            ...extraEnv,
        },
    });
    let logs = '';
    server.stdout.on('data', d => { logs += d; });
    server.stderr.on('data', d => { logs += d; });
    return { server, tmp, dbPath, logs: () => logs };
}

async function stopServer(server, tmp) {
    const exited = server.exitCode !== null ? Promise.resolve() : Promise.race([once(server, 'exit'), delay(5000)]);
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    await exited;
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

const api = (method, url, body) => fetch(`${BASE}${url}`, {
    method,
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
});

test('remote MCP servers — allowlist, write-only secrets, discovery, server-side tool loop', async () => {
    const mcp = await fakeMcp();
    const gateway = await fakeGateway();
    const { server, tmp, dbPath, logs } = startServer({
        LLM_TRANSPORT: 'gateway',
        LLM_BASE_URL: gateway.baseURL,
        LLM_API_KEY: 'gw-key',
        LLM_MODEL: 'gpt-4o-mini',
    });
    const yamlWith = (auth) => `name: MCP Agent
instructions: Use tools.
mcp_servers:
  - name: webchart
    url: ${mcp.baseURL}/mcp
    auth: ${auth}
    tools:
      - json_post_inject
`;
    const refAuth = '{ type: bearer, token: "${{ secrets.WEBCHART_TOKEN }}" }';
    try {
        await waitForReady();
        assert.equal((await api('GET', '/v1/manager/me')).status, 200);

        // Literal credentials in YAML are rejected.
        let res = await api('POST', '/v1/manager/agents', { yaml: yamlWith(`{ type: bearer, token: ${SECRET} }`) });
        assert.equal(res.status, 400);

        // A referenced secret must be supplied.
        res = await api('POST', '/v1/manager/agents', { yaml: yamlWith(refAuth) });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.code, 'missing_secrets');

        res = await api('POST', '/v1/manager/agents', { yaml: yamlWith(refAuth), secrets: { WEBCHART_TOKEN: SECRET } });
        assert.equal(res.status, 201);
        const created = await res.json();

        // Secrets never come back from the API.
        res = await api('GET', `/v1/manager/agents/${created.agent_id}`);
        const viewText = await res.text();
        assert.ok(!viewText.includes(SECRET));
        assert.deepEqual(JSON.parse(viewText).secret_names, ['WEBCHART_TOKEN']);

        // Updating without re-sending the secret keeps the stored one.
        res = await api('PUT', `/v1/manager/agents/${created.agent_id}`, { yaml: yamlWith(refAuth) });
        assert.equal(res.status, 200);

        // Discovery using the agent's stored secret lists every server tool.
        res = await api('POST', '/v1/manager/mcp/discover', {
            agent_id: created.agent_id,
            server: { name: 'webchart', url: `${mcp.baseURL}/mcp`, auth: { type: 'bearer', token: '${{ secrets.WEBCHART_TOKEN }}' } },
        });
        assert.equal(res.status, 200);
        assert.deepEqual((await res.json()).data.map(t => t.name).sort(), ['delete_everything', 'json_post_inject']);

        // Discovery errors are clear and credential-free.
        res = await api('POST', '/v1/manager/mcp/discover', {
            server: { name: 'webchart', url: `${mcp.baseURL}/mcp`, auth: { type: 'bearer', token: 'wrong' } },
        });
        assert.equal(res.status, 502);
        const discoverErr = await res.text();
        assert.match(discoverErr, /webchart/);
        assert.ok(!discoverErr.includes('wrong'));

        // Chat: only the allowlisted MCP tool is offered; page tools stay; the call runs server-side.
        const pageTool = { type: 'function', function: { name: 'postMessage_highlight', parameters: { type: 'object', properties: {} } } };
        const spoofed = { type: 'function', function: { name: 'mcp__webchart__delete_everything', parameters: { type: 'object', properties: {} } } };
        res = await fetch(`${BASE}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.agent_key}` },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'inject' }], tools: [pageTool, spoofed] }),
        });
        assert.equal(res.status, 200, logs());
        const completion = await res.json();
        assert.equal(completion.choices[0].message.content, 'done: injected-ok');
        assert.equal(completion.usage.total_tokens, 10);

        const llmCalls = gateway.requests.filter(r => r.url === '/v1/chat/completions');
        assert.equal(llmCalls.length, 2);
        const offered = llmCalls[0].body.tools.map(t => t.function.name).sort();
        assert.deepEqual(offered, ['mcp__webchart__json_post_inject', 'postMessage_highlight']);
        assert.deepEqual(mcp.calls, ['json_post_inject']);
        assert.ok(!logs().includes(SECRET), 'secret leaked to logs');

        // Deleting the agent removes its secrets.
        res = await api('DELETE', `/v1/manager/agents/${created.agent_id}`);
        assert.equal(res.status, 200);
        const db = new Database(dbPath);
        try {
            assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_secrets WHERE agent_id = ?').get(created.agent_id).n, 0);
        } finally {
            db.close();
        }
    } finally {
        await stopServer(server, tmp);
        await Promise.all([mcp.close(), gateway.close()]);
    }
});
