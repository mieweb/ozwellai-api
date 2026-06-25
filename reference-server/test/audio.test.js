import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const API_KEY = 'ozw_demo_localhost_key_for_testing';
const PORT = 3335;
const BASE = `http://localhost:${PORT}`;

let server;
let tmp;

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

before(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-audio-test-'));
  const dbPath = path.join(tmp, 'ozwell.db');
  const env = { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'development' };
  // Force mock mode — override LLM env vars so dotenv/.env can't set them
  env.LLM_BASE_URL = '';
  env.LLM_API_KEY = '';
  env.LLM_PROVIDER = '';
  server = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
    env,
  });
  await waitForReady();
});

after(() => {
  try { process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

function createAudioFormData({ file, model, responseFormat, language, temperature, granularities } = {}) {
  const formData = new FormData();
  // Append file first (matches SDK behavior — @fastify/multipart handles field order)
  if (file !== undefined) {
    formData.append('file', file);
  } else {
    formData.append('file', new Blob([new Uint8Array(100)], { type: 'audio/mpeg' }), 'test.mp3');
  }
  if (model !== undefined) formData.append('model', model);
  if (responseFormat) formData.append('response_format', responseFormat);
  if (language) formData.append('language', language);
  if (temperature !== undefined) formData.append('temperature', String(temperature));
  if (granularities) {
    for (const g of granularities) {
      formData.append('timestamp_granularities', g);
    }
  }
  return formData;
}

// --- Success cases ---

test('audio transcription — json format (default)', async () => {
  const form = createAudioFormData({ model: 'whisper-1' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(typeof json.text, 'string');
  assert.ok(json.text.length > 0);
});

test('audio transcription — text format', async () => {
  const form = createAudioFormData({ model: 'whisper-1', responseFormat: 'text' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(text.length > 0);
});

test('audio transcription — srt format', async () => {
  const form = createAudioFormData({ model: 'whisper-1', responseFormat: 'srt' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const srt = await r.text();
  assert.match(srt, /-->/);
  assert.match(srt, /^\d+\n/);
});

test('audio transcription — vtt format', async () => {
  const form = createAudioFormData({ model: 'whisper-1', responseFormat: 'vtt' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const vtt = await r.text();
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /-->/);
});

test('audio transcription — verbose_json with word timestamps', async () => {
  const form = createAudioFormData({
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    granularities: ['word'],
  });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.task, 'transcribe');
  assert.equal(typeof json.language, 'string');
  assert.equal(typeof json.duration, 'number');
  assert.equal(typeof json.text, 'string');
  assert.ok(Array.isArray(json.words));
  assert.ok(json.words.length > 0);
  assert.equal(typeof json.words[0].word, 'string');
  assert.equal(typeof json.words[0].start, 'number');
  assert.equal(typeof json.words[0].end, 'number');
});

test('audio transcription — verbose_json with segment timestamps', async () => {
  const form = createAudioFormData({
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    granularities: ['segment'],
  });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.task, 'transcribe');
  assert.ok(Array.isArray(json.segments));
  assert.ok(json.segments.length > 0);
  const seg = json.segments[0];
  assert.equal(typeof seg.id, 'number');
  assert.equal(typeof seg.start, 'number');
  assert.equal(typeof seg.end, 'number');
  assert.equal(typeof seg.text, 'string');
});

test('audio transcription — verbose_json with language parameter', async () => {
  const form = createAudioFormData({
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    language: 'es',
  });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.equal(json.language, 'es');
});

// --- Error cases ---

test('audio transcription — 401 without auth', async () => {
  const form = createAudioFormData({ model: 'whisper-1' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
  });
  assert.equal(r.status, 401);
});

test('audio transcription — 401 with invalid key', async () => {
  const form = createAudioFormData({ model: 'whisper-1' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer invalid-key' },
    body: form,
  });
  assert.equal(r.status, 401);
});

test('audio transcription — 401 with well-formed but unregistered key', async () => {
  const form = createAudioFormData({ model: 'whisper-1' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ozw_does_not_exist' },
    body: form,
  });
  assert.equal(r.status, 401);
  const json = await r.json();
  assert.match(json.error.message, /not found/i);
});

test('audio transcription — 400 without model', async () => {
  const form = createAudioFormData({});
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.equal(json.error.type, 'invalid_request_error');
});

test('audio transcription — 400 with unsupported model', async () => {
  const form = createAudioFormData({ model: 'gpt-4' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.match(json.error.message, /not found/);
});

test('audio transcription — 400 with invalid response_format', async () => {
  const form = createAudioFormData({ model: 'whisper-1', responseFormat: 'foo' });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.match(json.error.message, /Invalid response_format/);
});

test('audio transcription — verbose_json with both word and segment granularities', async () => {
  const form = createAudioFormData({
    model: 'whisper-1',
    responseFormat: 'verbose_json',
    granularities: ['word', 'segment'],
  });
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 200);
  const json = await r.json();
  assert.ok(Array.isArray(json.words), 'expected words array when both granularities requested');
  assert.ok(json.words.length > 0);
  assert.ok(Array.isArray(json.segments), 'expected segments array when both granularities requested');
  assert.ok(json.segments.length > 0);
});

test('audio transcription — 400 with invalid file type', async () => {
  const form = new FormData();
  form.append('file', new Blob(['not audio'], { type: 'text/plain' }), 'test.txt');
  form.append('model', 'whisper-1');
  const r = await fetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  assert.equal(r.status, 400);
  const json = await r.json();
  assert.match(json.error.message, /Invalid file format/);
});
