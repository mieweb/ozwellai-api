import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const API_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3337;
const BASE = `http://localhost:${PORT}`;

let server;
let tmp;

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

// Spawn a reference server with mock/LLM env fully controlled so dotenv/.env
// can't leak a real backend into the test.
function spawnServer({ port, dbPath, allowMock }) {
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    NODE_ENV: 'development',
    // Force mock mode — no real LLM/Ollama backend during tests.
    LLM_BASE_URL: '',
    LLM_API_KEY: '',
    LLM_PROVIDER: '',
    // Point Ollama at an unused port so isOllamaAvailable() resolves false fast.
    OLLAMA_BASE_URL: 'http://127.0.0.1:59999',
  };
  if (allowMock) env.ALLOW_MOCK = 'true';
  else delete env.ALLOW_MOCK;
  return spawn(process.execPath, ['dist/reference-server/src/server.js'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
    env,
  });
}

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-embeddings-test-'));
  const dbPath = path.join(tmp, 'ozwell.db');
  server = spawnServer({ port: PORT, dbPath, allowMock: true });
  await waitForReady(BASE);
});

after(() => {
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function postEmbeddings(body, { auth = API_KEY } = {}) {
  return fetch(`${BASE}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// --- Success (mock fallback) cases ---

test('embeddings — single string input returns one 1536-dim vector', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-small', input: 'hello world' });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.object, 'list');
  assert.equal(json.model, 'text-embedding-3-small');
  assert.equal(json.data.length, 1);
  assert.equal(json.data[0].object, 'embedding');
  assert.equal(json.data[0].index, 0);
  assert.equal(json.data[0].embedding.length, 1536);
  assert.ok(json.usage.total_tokens > 0);
  // Mock responses are flagged so callers can tell them from real vectors.
  assert.equal(json.warning?.type, 'mock_response');
  assert.equal(json.warning?.reason, 'no_backend');
});

test('embeddings — array input returns one vector per item with correct indices', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-small', input: ['hello', 'world', 'foo'] });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.data.length, 3);
  assert.deepEqual(json.data.map((d) => d.index), [0, 1, 2]);
  for (const item of json.data) {
    assert.equal(item.embedding.length, 1536);
  }
});

test('embeddings — deterministic mock is stable for identical input', async () => {
  const r1 = await postEmbeddings({ model: 'text-embedding-3-small', input: 'repeatable' });
  const r2 = await postEmbeddings({ model: 'text-embedding-3-small', input: 'repeatable' });
  const [j1, j2] = [await r1.json(), await r2.json()];
  assert.deepEqual(j1.data[0].embedding, j2.data[0].embedding);
});

test('embeddings — explicit dimensions parameter is honored', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-small', input: 'hello', dimensions: 256 });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.data[0].embedding.length, 256);
});

test('embeddings — text-embedding-3-large defaults to 3072 dims', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-large', input: 'hello' });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.data[0].embedding.length, 3072);
});

// --- Error cases ---

test('embeddings — missing API key returns 401', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-small', input: 'hello' }, { auth: null });
  assert.equal(r.status, 401);
});

test('embeddings — missing input returns 400', async () => {
  const r = await postEmbeddings({ model: 'text-embedding-3-small' });
  assert.equal(r.status, 400);
});

// --- Mock disabled: no backend + ALLOW_MOCK unset → 503 ---

test('embeddings — 503 when no backend and mock disabled', async () => {
  const localTmp = mkdtempSync(path.join(tmpdir(), 'ozwell-embeddings-nomock-'));
  const localPort = 3338;
  const localBase = `http://localhost:${localPort}`;
  const localServer = spawnServer({
    port: localPort,
    dbPath: path.join(localTmp, 'ozwell.db'),
    allowMock: false,
  });
  try {
    await waitForReady(localBase);
    const r = await fetch(`${localBase}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: 'hello' }),
    });
    assert.equal(r.status, 503);
    const json = await r.json();
    assert.equal(json.error.type, 'server_error');
  } finally {
    try { process.kill(-localServer.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(localTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
