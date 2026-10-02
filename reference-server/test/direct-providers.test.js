// Direct provider transport: OpenAI (Responses API), Anthropic (Messages API), and Ollama
// (OpenAI-compatible /v1) reached without a gateway, normalized through @mieweb/harness-core.
// Each provider is a fake HTTP server; assertions cover the request the provider received
// and the OpenAI-compatible response the reference server produced.
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

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const PORT = 3351;
const BASE = `http://localhost:${PORT}`;
const HEADERS = {
    'x-user': 'admin-user',
    'x-preferred-username': 'testadmin',
    'x-user-first-name': 'Test',
    'x-user-last-name': 'Admin',
    'x-email': 'test-admin@example.test',
    'x-groups': 'ldapusers',
};

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

function startServer(extraEnv = {}) {
    const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-direct-provider-test-'));
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
            ADMIN_EXTERNAL_USER_IDS: '',
            ALLOW_MOCK: '',
            LLM_TRANSPORT: '',
            LLM_BASE_URL: '',
            LLM_API_KEY: '',
            LLM_PROVIDER: '',
            LLM_MODEL: '',
            OPENAI_API_KEY: '',
            ANTHROPIC_API_KEY: '',
            OLLAMA_BASE_URL: '',
            MODEL_DISCOVERY_REFRESH_MS: '0',
            NODE_ENV: 'development',
            ...extraEnv,
        },
    });
    return { server, tmp, dbPath };
}

async function stopServer(server, tmp) {
    const exited = server.exitCode !== null ? Promise.resolve() : Promise.race([once(server, 'exit'), delay(5000)]);
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    await exited;
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
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

async function readyKey(dbPath) {
    await waitForReady();
    const me = await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });
    assert.equal(me.status, 200, 'manager bootstrap failed');
    // Discovery runs on boot; make sure the registry is populated before chatting.
    for (let i = 0; i < 25; i++) {
        const models = await fetch(`${BASE}/v1/manager/models`, { headers: HEADERS });
        assert.equal(models.status, 200, 'manager models failed');
        if ((await models.json()).data.length > 0) break;
        await delay(200);
    }
    return activeKey(dbPath);
}

function readBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => resolve(raw ? JSON.parse(raw) : null));
    });
}

function sse(res, events) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const event of events) {
        if (event === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
        }
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.end();
}

function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

async function listen(handler) {
    const requests = [];
    const server = createServer(async (req, res) => {
        const body = await readBody(req);
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        handler(req, res, body);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        baseURL: `http://127.0.0.1:${server.address().port}`,
        requests,
        last: (urlPart) => [...requests].reverse().find(r => r.url.includes(urlPart)),
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

// --- Fake providers -------------------------------------------------------

function fakeOpenAI({ models = ['gpt-4o-mini', 'gpt-5-mini'], toolCall = null, text = 'Hello from OpenAI', fail = false } = {}) {
    return listen((req, res, body) => {
        if (req.method === 'GET' && req.url === '/v1/models') {
            return json(res, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'openai' })) });
        }
        if (req.method === 'POST' && req.url === '/v1/responses') {
            if (!models.includes(body.model)) {
                return json(res, 404, { error: { message: `The model '${body.model}' does not exist`, type: 'invalid_request_error', code: 'model_not_found' } });
            }
            if (fail === 'http') {
                return json(res, 429, { error: { message: 'rate limited', type: 'rate_limit_error' } });
            }
            const response = { id: 'resp_1', object: 'response', model: body.model, output: [] };
            const events = [{ type: 'response.created', response }];
            if (fail === 'silent') {
                events.push({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'partial' });
                return sse(res, events);
            }
            if (fail) {
                events.push({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'partial' });
                events.push({ type: 'response.failed', response: { ...response, error: { message: 'upstream exploded' }, usage: { input_tokens: 2, output_tokens: 1 } } });
                return sse(res, events);
            }
            if (toolCall) {
                events.push({ type: 'response.output_item.added', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: toolCall.name, arguments: '' } });
                events.push({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: toolCall.arguments });
                events.push({ type: 'response.output_item.done', output_index: 0, item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: toolCall.name, arguments: toolCall.arguments } });
            } else {
                for (const piece of text.match(/.{1,6}/g) || []) {
                    events.push({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: piece });
                }
            }
            events.push({ type: 'response.completed', response: { ...response, usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } });
            return sse(res, events);
        }
        json(res, 404, { error: { message: `no route ${req.method} ${req.url}` } });
    });
}

function fakeAnthropic({ models = ['claude-sonnet-4-5'], text = 'Hello from Claude' } = {}) {
    return listen((req, res, body) => {
        if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
            return json(res, 200, { data: models.map(id => ({ id, type: 'model', display_name: id })), has_more: false, first_id: models[0], last_id: models.at(-1) });
        }
        if (req.method === 'POST' && req.url === '/v1/messages') {
            return sse(res, [
                { type: 'message_start', message: { id: 'msg_a1', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } },
                { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
                { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
                { type: 'content_block_stop', index: 0 },
                { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
                { type: 'message_stop' },
            ]);
        }
        json(res, 404, { error: { type: 'not_found_error', message: `no route ${req.method} ${req.url}` } });
    });
}

function fakeOllama({ models = ['llama3.2:latest'], pieces = ['<think>', 'ponder', 'ing', '</think>', 'Hello', ' from', ' Ollama'] } = {}) {
    return listen((req, res, body) => {
        if (req.method === 'GET' && req.url === '/api/tags') {
            return json(res, 200, { models: models.map(name => ({ name })) });
        }
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
            const chunk = (delta, finish = null) => ({ id: 'chatcmpl_o1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] });
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: '' }))}\n\n`);
            for (const piece of pieces) {
                res.write(`data: ${JSON.stringify(chunk({ content: piece }))}\n\n`);
            }
            res.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
            res.write(`data: ${JSON.stringify({ id: 'chatcmpl_o1', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\n`);
            res.write('data: [DONE]\n\n');
            return res.end();
        }
        json(res, 404, { error: `no route ${req.method} ${req.url}` });
    });
}

async function chat(key, body) {
    return fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.key}` },
        body: JSON.stringify(body),
    });
}

function parseSse(text) {
    const events = [];
    for (const block of text.split('\n\n')) {
        const lines = block.split('\n').filter(Boolean);
        if (lines.length === 0) continue;
        const event = lines.find(l => l.startsWith('event: '))?.slice(7);
        const data = lines.find(l => l.startsWith('data: '))?.slice(6);
        if (data === undefined) continue;
        events.push({ event, data: data === '[DONE]' ? '[DONE]' : JSON.parse(data) });
    }
    return events;
}

// --- Tests ----------------------------------------------------------------

test('direct providers — discovery reads native OpenAI, Anthropic, and Ollama catalogs', async () => {
    const openai = await fakeOpenAI();
    const anthropic = await fakeAnthropic();
    const ollama = await fakeOllama();
    const { server, tmp } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        ANTHROPIC_API_KEY: 'sk-ant-test',
        ANTHROPIC_BASE_URL: anthropic.baseURL,
        OLLAMA_BASE_URL: ollama.baseURL,
    });
    try {
        await waitForReady();
        await fetch(`${BASE}/v1/manager/me`, { headers: HEADERS });
        const models = await fetch(`${BASE}/v1/manager/models`, { headers: HEADERS });
        assert.equal(models.status, 200);
        assert.deepEqual(
            (await models.json()).data.map(m => `${m.provider}/${m.model}`).sort(),
            ['anthropic/claude-sonnet-4-5', 'ollama/llama3.2:latest', 'openai/gpt-4o-mini', 'openai/gpt-5-mini'],
        );
        assert.equal(openai.last('/v1/models').headers.authorization, 'Bearer sk-test');
        assert.equal(anthropic.last('/v1/models').headers['x-api-key'], 'sk-ant-test');
    } finally {
        await stopServer(server, tmp);
        await Promise.all([openai.close(), anthropic.close(), ollama.close()]);
    }
});

test('direct providers — OpenAI non-stream goes through the Responses API', async () => {
    const openai = await fakeOpenAI();
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: 'Be brief.' },
                { role: 'user', content: 'hi' },
            ],
            temperature: 0.3,
            max_tokens: 222,
            response_format: { type: 'json_schema', json_schema: { name: 'answer', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } },
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.object, 'chat.completion');
        assert.equal(body.model, 'gpt-4o-mini');
        assert.equal(body.choices[0].message.role, 'assistant');
        assert.equal(body.choices[0].message.content, 'Hello from OpenAI');
        assert.equal(body.choices[0].finish_reason, 'stop');
        assert.deepEqual(body.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });

        const sent = openai.last('/v1/responses');
        assert.equal(sent.headers.authorization, 'Bearer sk-test');
        assert.equal(sent.headers['x-portkey-provider'], undefined);
        assert.equal(sent.body.model, 'gpt-4o-mini');
        assert.equal(sent.body.instructions, 'Be brief.');
        assert.deepEqual(sent.body.input, [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
        assert.equal(sent.body.temperature, 0.3);
        assert.equal(sent.body.max_output_tokens, 222);
        assert.equal(sent.body.text.format.type, 'json_schema');
        assert.equal(sent.body.text.format.name, 'answer');
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — OpenAI streaming emits OpenAI-compatible tool_calls chunks and [DONE]', async () => {
    const openai = await fakeOpenAI({ toolCall: { name: 'get_weather', arguments: '{"city":"Chicago"}' } });
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, {
            model: 'gpt-5-mini',
            stream: true,
            temperature: 0.9,
            messages: [{ role: 'user', content: 'weather?' }],
            tools: [{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
        });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/event-stream/);
        const events = parseSse(await res.text());
        assert.equal(events.at(-1).data, '[DONE]');

        const chunks = events.filter(e => e.data !== '[DONE]').map(e => e.data);
        const toolChunks = chunks.filter(c => c.choices?.[0]?.delta?.tool_calls);
        assert.ok(toolChunks.length >= 2, 'expected a tool_call start chunk and an arguments chunk');
        assert.deepEqual(toolChunks[0].choices[0].delta.tool_calls[0], { index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '' } });
        const args = toolChunks.slice(1).map(c => c.choices[0].delta.tool_calls[0].function.arguments).join('');
        assert.equal(args, '{"city":"Chicago"}');
        const finish = chunks.find(c => c.choices?.[0]?.finish_reason);
        assert.equal(finish.choices[0].finish_reason, 'tool_calls');
        const usage = chunks.find(c => c.usage);
        assert.deepEqual(usage.usage, { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });

        // gpt-5 family: reasoning model, so no temperature; tools arrive in flat Responses shape
        const sent = openai.last('/v1/responses');
        assert.equal(sent.body.stream, true);
        assert.equal(sent.body.temperature, undefined);
        assert.deepEqual(sent.body.tools, [{ type: 'function', name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }]);
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — tool continuation maps assistant tool_calls and tool results to Responses items', async () => {
    const openai = await fakeOpenAI({ text: 'It is sunny.' });
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'user', content: 'weather?' },
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Chicago"}' } }] },
                { role: 'tool', tool_call_id: 'call_1', content: '{"temp":72}' },
            ],
            tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }],
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).choices[0].message.content, 'It is sunny.');
        assert.deepEqual(openai.last('/v1/responses').body.input, [
            { role: 'user', content: [{ type: 'input_text', text: 'weather?' }] },
            { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Chicago"}' },
            { type: 'function_call_output', call_id: 'call_1', output: '{"temp":72}' },
        ]);
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — Anthropic gets a system prompt, default max_tokens, and no temperature', async () => {
    const anthropic = await fakeAnthropic();
    const { server, tmp, dbPath } = startServer({
        ANTHROPIC_API_KEY: 'sk-ant-test',
        ANTHROPIC_BASE_URL: anthropic.baseURL,
        LLM_MODEL: 'claude-sonnet-4-5',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, {
            messages: [
                { role: 'system', content: 'You are terse.' },
                { role: 'user', content: 'hello' },
            ],
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.model, 'claude-sonnet-4-5');
        assert.equal(body.choices[0].message.content, 'Hello from Claude');
        assert.deepEqual(body.usage, { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 });

        const sent = anthropic.last('/v1/messages');
        assert.equal(sent.headers['x-api-key'], 'sk-ant-test');
        assert.equal(sent.body.model, 'claude-sonnet-4-5');
        assert.equal(sent.body.system, 'You are terse.');
        assert.equal(sent.body.max_tokens, 1024);
        assert.equal(sent.body.temperature, undefined);
        assert.deepEqual(sent.body.messages, [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]);
    } finally {
        await stopServer(server, tmp);
        await anthropic.close();
    }
});

test('direct providers — Ollama streams through /v1 with <think> tags split into thinking deltas', async () => {
    const ollama = await fakeOllama();
    const { server, tmp, dbPath } = startServer({ OLLAMA_BASE_URL: ollama.baseURL });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, { stream: true, messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(res.status, 200);
        const chunks = parseSse(await res.text()).map(e => e.data).filter(d => d !== '[DONE]');
        const thinking = chunks.map(c => c.choices?.[0]?.delta?.thinking || '').join('');
        const content = chunks.map(c => c.choices?.[0]?.delta?.content || '').join('');
        assert.equal(thinking, 'pondering');
        assert.equal(content, 'Hello from Ollama');
        assert.equal(chunks.find(c => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason, 'stop');
        assert.deepEqual(chunks.find(c => c.usage)?.usage, { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 });

        const sent = ollama.last('/v1/chat/completions');
        assert.equal(sent.body.model, 'llama3.2:latest');
        assert.deepEqual(sent.body.messages, [{ role: 'user', content: 'hi' }]);
        assert.equal(sent.body.temperature, 0.7);
    } finally {
        await stopServer(server, tmp);
        await ollama.close();
    }
});

test('direct providers — a 404 from the provider retries on the fallback model with a warning', async () => {
    // 'gpt-ghost' is in the catalog (so policy allows it) but the completion endpoint rejects it.
    const openai = await fakeOpenAI();
    openai.requests.length = 0;
    const catalogOnly = await listen((req, res, body) => {
        if (req.method === 'GET' && req.url === '/v1/models') {
            return json(res, 200, { object: 'list', data: ['gpt-4o-mini', 'gpt-ghost'].map(id => ({ id, object: 'model' })) });
        }
        // Proxy completions to the real fake so 'gpt-ghost' 404s there.
        fetch(`${openai.baseURL}${req.url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            .then(async upstream => {
                res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') });
                res.end(Buffer.from(await upstream.arrayBuffer()));
            });
    });
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${catalogOnly.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, { model: 'gpt-ghost', messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.model, 'gpt-4o-mini');
        assert.equal(body.choices[0].message.content, 'Hello from OpenAI');
        assert.deepEqual(body.warning, {
            type: 'model_fallback',
            message: 'Model gpt-ghost not available on this provider — using gpt-4o-mini',
            original_model: 'gpt-ghost',
            fallback_model: 'gpt-4o-mini',
        });
    } finally {
        await stopServer(server, tmp);
        await Promise.all([openai.close(), catalogOnly.close()]);
    }
});

test('direct providers — a provider-reported failure becomes an SSE error, not a truncated success', async () => {
    const openai = await fakeOpenAI({ fail: true });
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, { stream: true, messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(res.status, 200);
        const events = parseSse(await res.text());
        const errorEvent = events.find(e => e.event === 'error');
        assert.equal(errorEvent.data.error.message, 'upstream exploded');
        assert.equal(events.some(e => e.data?.choices?.[0]?.finish_reason), false, 'no finish_reason after a failure');
        assert.equal(events.at(-1).data, '[DONE]');

        const nonStream = await chat(key, { messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(nonStream.status, 503);
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — silent close and HTTP errors stream an error event, not a success', async () => {
    for (const fail of ['silent', 'http']) {
        const openai = await fakeOpenAI({ fail });
        const { server, tmp, dbPath } = startServer({
            OPENAI_API_KEY: 'sk-test',
            OPENAI_BASE_URL: `${openai.baseURL}/v1`,
            LLM_MODEL: 'gpt-4o-mini',
        });
        try {
            const key = await readyKey(dbPath);
            const res = await chat(key, { stream: true, messages: [{ role: 'user', content: 'hi' }] });
            const events = parseSse(await res.text());
            assert.ok(events.some(e => e.event === 'error'), `${fail}: expected an SSE error event`);
            assert.equal(events.some(e => e.data?.choices?.[0]?.finish_reason), false, `${fail}: no finish_reason`);
        } finally {
            await stopServer(server, tmp);
            await openai.close();
        }
    }
});

test('direct providers — tool messages without tool_call_id are rejected before dispatch', async () => {
    const openai = await fakeOpenAI();
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, {
            messages: [
                { role: 'user', content: 'weather?' },
                { role: 'tool', content: '{"temp":72}' },
            ],
        });
        assert.equal(res.status, 400);
        assert.equal((await res.json()).error.param, 'messages[1].tool_call_id');
        assert.equal(openai.requests.filter(r => r.url === '/v1/responses').length, 0);
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — a provider without credentials is rejected before dispatch', async () => {
    const openai = await fakeOpenAI();
    const { server, tmp, dbPath } = startServer({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
        LLM_MODEL: 'gpt-4o-mini',
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, { provider: 'anthropic', model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hi' }] });
        // Not in the registry at all, so policy rejects it first.
        assert.equal(res.status, 403);
        assert.equal(openai.requests.filter(r => r.url === '/v1/responses').length, 0);
    } finally {
        await stopServer(server, tmp);
        await openai.close();
    }
});

test('direct providers — LLM_TRANSPORT=gateway keeps the gateway path even with provider keys set', async () => {
    const gateway = await listen((req, res, body) => {
        if (req.method === 'GET' && req.url === '/v1/models') {
            return json(res, 200, { object: 'list', data: [{ id: 'gpt-4o-mini' }] });
        }
        json(res, 200, {
            id: 'chatcmpl_gw', object: 'chat.completion', created: 1, model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'via gateway' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
    });
    const openai = await fakeOpenAI();
    const { server, tmp, dbPath } = startServer({
        LLM_TRANSPORT: 'gateway',
        LLM_BASE_URL: gateway.baseURL,
        LLM_API_KEY: 'gw-key',
        LLM_MODEL: 'gpt-4o-mini',
        OPENAI_API_KEY: 'sk-test',
        OPENAI_BASE_URL: `${openai.baseURL}/v1`,
    });
    try {
        const key = await readyKey(dbPath);
        const res = await chat(key, { messages: [{ role: 'user', content: 'hi' }] });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).choices[0].message.content, 'via gateway');
        assert.equal(gateway.last('/v1/chat/completions').headers['x-portkey-provider'], 'openai');
        assert.equal(openai.requests.filter(r => r.url === '/v1/responses').length, 0);
    } finally {
        await stopServer(server, tmp);
        await Promise.all([gateway.close(), openai.close()]);
    }
});
