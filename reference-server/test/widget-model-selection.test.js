import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWidgetModule } from './helpers/load-widget-module.js';

const { resolveActiveModel, isChatModel, normalizeSystemDefault } = await loadWidgetModule('model-selection.ts');

const option = (provider, model) => ({ provider, model, id: model, label: model });
const models = [
  option('openai', 'whisper-1'),
  option('openai', 'text-embedding-3-small'),
  option('openai', 'tts-1'),
  option('openai', 'gpt-4o-mini'),
  option('openai', 'gpt-4.1'),
];

test('explicit widget model wins over the system default', () => {
  const resolved = resolveActiveModel({ provider: 'openai', model: 'gpt-4.1' }, models, null, { provider: 'openai', model: 'gpt-4o-mini' });
  assert.deepEqual(resolved, { provider: 'openai', model: 'gpt-4.1' });
});

test('missing widget model uses the system default', () => {
  const resolved = resolveActiveModel({}, models, null, { provider: 'openai', model: 'gpt-4.1' });
  assert.deepEqual(resolved, { provider: 'openai', model: 'gpt-4.1' });
});

test('unavailable system default falls back to the first chat model, never whisper', () => {
  const resolved = resolveActiveModel({}, models, null, { provider: 'anthropic', model: 'claude-sonnet-4-5' });
  assert.deepEqual(resolved, { provider: 'openai', model: 'gpt-4o-mini' });
  assert.deepEqual(resolveActiveModel({}, models, null, null), { provider: 'openai', model: 'gpt-4o-mini' });
});

test('non-chat system default is skipped for the first chat model', () => {
  assert.deepEqual(resolveActiveModel({}, models, null, { provider: 'openai', model: 'whisper-1' }), { provider: 'openai', model: 'gpt-4o-mini' });
});

test('no chat-capable model resolves to null', () => {
  assert.equal(resolveActiveModel({}, models.slice(0, 3), null, null), null);
});

test('isChatModel filters non-chat models', () => {
  for (const model of ['whisper-1', 'tts-1-hd', 'text-embedding-ada-002', 'dall-e-3', 'omni-moderation-latest', 'gpt-4o-transcribe', 'nomic-embed-text', 'embeddinggemma', 'embeddinggemma:300m', 'all-minilm', 'all-minilm:l6-v2', 'text-search-ada-doc-001']) {
    assert.equal(isChatModel({ model }), false, model);
  }
  for (const model of ['gpt-4o-mini', 'gpt-5', 'claude-sonnet-4-5', 'llama3.1:8b', 'qwen2.5', 'gpt-4o-search-preview', 'gpt-4o-mini-search-preview']) {
    assert.equal(isChatModel({ model }), true, model);
  }
});

test('normalizeSystemDefault reads default_model from the effective list payload', () => {
  assert.deepEqual(normalizeSystemDefault({ data: [], default_model: { provider: 'openai', model: 'gpt-4o-mini' } }), { provider: 'openai', model: 'gpt-4o-mini' });
  assert.equal(normalizeSystemDefault({ data: [], default_model: null }), null);
  assert.equal(normalizeSystemDefault({ data: [] }), null);
});
