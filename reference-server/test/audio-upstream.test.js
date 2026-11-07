import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';

const API_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3337;
const BASE = `http://localhost:${PORT}`;
const AUDIO_MARKER = 'fake-audio-bytes-1234';

let upstream;
let upstreamUrl;
let requests = [];
let tmp;

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-audio-upstream-'));
  upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
      if (req.url.endsWith('/audio/transcriptions')) return res.end(JSON.stringify({ text: 'from upstream' }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
});

after(() => {
  upstream?.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Every backend env var is set explicitly so .env cannot leak into a case.
async function withServer(backendEnv, fn) {
  const env = {
    ...process.env,
    PORT: String(PORT),
    DB_PATH: path.join(tmp, `ozwell-${Date.now()}.db`),
    NODE_ENV: 'development',
    LLM_BASE_URL: '', LLM_API_KEY: '', LLM_PROVIDER: '', LLM_TRANSPORT: '',
    OPENAI_API_KEY: '', OPENAI_BASE_URL: '', ANTHROPIC_API_KEY: '', OLLAMA_BASE_URL: '',
    ...backendEnv,
  };
  const server = spawn(process.execPath, ['dist/reference-server/src/server.js'], { cwd: process.cwd(), stdio: 'pipe', detached: true, env });
  try {
    await waitForServer(server, BASE);
    requests = [];
    await fn();
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']);
    else { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ } }
    if (server.exitCode === null && server.signalCode === null) await new Promise((resolve) => server.once('exit', resolve));
  }
}

function transcribe() {
  const form = new FormData();
  form.append('file', new Blob([AUDIO_MARKER], { type: 'audio/webm' }), 'dictation.webm');
  form.append('model', 'whisper-1');
  return fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
}

function transcriptionRequest() {
  return requests.find((r) => r.url.endsWith('/audio/transcriptions'));
}

test('direct OpenAI key sends audio to OPENAI_BASE_URL with the OpenAI key', async () => {
  await withServer({ OPENAI_API_KEY: 'sk-direct', OPENAI_BASE_URL: `${upstreamUrl}/v1/` }, async () => {
    const r = await transcribe();
    assert.equal(r.status, 200);
    assert.equal((await r.json()).text, 'from upstream');
    const sent = transcriptionRequest();
    assert.equal(sent.url, '/v1/audio/transcriptions');
    assert.equal(sent.headers.authorization, 'Bearer sk-direct');
    assert.equal(sent.headers['x-portkey-provider'], undefined);
    assert.match(sent.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.ok(sent.body.includes(AUDIO_MARKER));
    assert.match(sent.body, /name="model"\r\n\r\nwhisper-1/);
  });
});

test('forced gateway wins over a direct key and always names the OpenAI provider', async () => {
  await withServer({
    LLM_TRANSPORT: 'gateway',
    LLM_BASE_URL: upstreamUrl,
    LLM_API_KEY: 'gw-key',
    LLM_PROVIDER: 'anthropic',
    OPENAI_API_KEY: 'sk-direct',
  }, async () => {
    const r = await transcribe();
    assert.equal(r.status, 200);
    assert.equal((await r.json()).text, 'from upstream');
    const sent = transcriptionRequest();
    assert.equal(sent.url, '/v1/audio/transcriptions');
    assert.equal(sent.headers.authorization, 'Bearer gw-key');
    assert.equal(sent.headers['x-portkey-provider'], 'openai');
    assert.ok(sent.body.includes(AUDIO_MARKER));
  });
});

test('Anthropic-only backend reports transcription unavailable instead of mock text', async () => {
  await withServer({ ANTHROPIC_API_KEY: 'sk-ant' }, async () => {
    const r = await transcribe();
    assert.equal(r.status, 503);
    assert.equal(transcriptionRequest(), undefined);
  });
});

test('Ollama-only backend reports transcription unavailable instead of mock text', async () => {
  await withServer({ OLLAMA_BASE_URL: upstreamUrl }, async () => {
    const r = await transcribe();
    assert.equal(r.status, 503);
    assert.equal(transcriptionRequest(), undefined);
  });
});
