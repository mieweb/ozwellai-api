import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadWidgetModule } from './helpers/load-widget-module.js';

const { buildSystemPrompt, getAuthKey } = await loadWidgetModule('system-prompt.ts');

const DEFAULT_PROMPT = 'You are a helpful assistant. Answer clearly and concisely.';
const TOOL_HINT = 'Use the available tools when they are helpful for answering the user or performing a requested action.';
const tools = [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }];

test('agent keys omit client-side system prompts through either credential option', () => {
  for (const keyOption of ['apiKey', 'openaiApiKey']) {
    const config = { [keyOption]: 'agnt_key-example' };
    assert.equal(buildSystemPrompt(config), '', keyOption);
    assert.equal(buildSystemPrompt({ ...config, system: 'A custom prompt', tools }), '', keyOption);
  }
});

test('parent keys and unconfigured credentials receive the neutral default prompt', () => {
  for (const config of [{ apiKey: 'parent-key' }, { openaiApiKey: 'parent-key' }, {}]) {
    assert.equal(buildSystemPrompt(config), DEFAULT_PROMPT);
    assert.equal(buildSystemPrompt({ ...config, tools: [] }), DEFAULT_PROMPT);
    assert.equal(buildSystemPrompt({ ...config, system: '' }), DEFAULT_PROMPT);
  }
});

test('available tools add the helpful tool hint to the default prompt', () => {
  const prompt = buildSystemPrompt({ apiKey: 'parent-key', tools });

  assert.equal(prompt, `${DEFAULT_PROMPT} ${TOOL_HINT}`);
  assert.equal(buildSystemPrompt({ apiKey: 'parent-key', system: '', tools }), prompt);
  assert.doesNotMatch(prompt, /=== TOOL USAGE GUIDELINES ===|Do NOT use tools|Only use tools when truly necessary/);
});

test('parent-key custom system prompts are preserved without adding tool instructions', () => {
  const system = '  Follow the application instructions exactly.\nKeep this formatting.  ';

  assert.equal(buildSystemPrompt({ apiKey: 'parent-key', system }), system);
  assert.equal(buildSystemPrompt({ apiKey: 'parent-key', system, tools }), system);
});

test('credential precedence also determines whether the widget supplies a system prompt', () => {
  const parentFirst = { apiKey: 'parent-key', openaiApiKey: 'agnt_key-fallback' };
  assert.equal(getAuthKey(parentFirst), 'parent-key');
  assert.equal(buildSystemPrompt(parentFirst), DEFAULT_PROMPT);

  const agentFirst = { apiKey: 'agnt_key-primary', openaiApiKey: 'parent-key' };
  assert.equal(getAuthKey(agentFirst), 'agnt_key-primary');
  assert.equal(buildSystemPrompt(agentFirst), '');

  const emptyPrimary = { apiKey: '', openaiApiKey: 'agnt_key-fallback' };
  assert.equal(getAuthKey(emptyPrimary), 'agnt_key-fallback');
  assert.equal(buildSystemPrompt(emptyPrimary), '');
  assert.equal(getAuthKey({}), '');
});
