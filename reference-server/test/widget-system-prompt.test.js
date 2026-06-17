import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const WIDGET_PATH = new URL('../embed/ozwell.js', import.meta.url);

async function readWidgetSource() {
  return readFile(WIDGET_PATH, 'utf8');
}

test('agent-key widgets do not add a client-side system prompt', async () => {
  const source = await readWidgetSource();

  assert.match(source, /function isAgentKeyConfigured\(config\)/);
  assert.match(source, /getAuthKey\(config\)\.startsWith\("agnt_key-"\)/);
  assert.match(source, /if \(isAgentKeyConfigured\(config\)\) return "";/);
});

test('widget default prompt does not discourage tool use', async () => {
  const source = await readWidgetSource();

  assert.doesNotMatch(source, /=== TOOL USAGE GUIDELINES ===/);
  assert.doesNotMatch(source, /Do NOT use tools/);
  assert.doesNotMatch(source, /Only use tools when truly necessary/);
});

test('parent-key widgets keep a small neutral default prompt and tool hint', async () => {
  const source = await readWidgetSource();

  assert.match(source, /var DEFAULT_PARENT_SYSTEM_PROMPT = "You are a helpful assistant\. Answer clearly and concisely\.";/);
  assert.match(source, /var DEFAULT_PARENT_TOOL_HINT = "Use the available tools when they are helpful for answering the user or performing a requested action\.";/);
  assert.match(source, /let systemPrompt = DEFAULT_PARENT_SYSTEM_PROMPT;/);
  assert.match(source, /systemPrompt \+= ` \$\{DEFAULT_PARENT_TOOL_HINT\}`;/);
});

test('parent-key custom system prompt is preserved without widget tool rules', async () => {
  const source = await readWidgetSource();
  const promptFunctionMatch = source.match(/function buildSystemPrompt\(config\) \{[\s\S]*?\n  \}\n/);
  assert.ok(promptFunctionMatch, 'could not extract buildSystemPrompt function body');
  const promptFunction = promptFunctionMatch[0];

  assert.match(promptFunction, /if \(config\.system\) return config\.system;/);
  assert.ok(
    promptFunction.indexOf('return config.system;') < promptFunction.indexOf('let systemPrompt = DEFAULT_PARENT_SYSTEM_PROMPT;'),
    'custom system prompt should return before default prompt or tool hint is appended'
  );
});
