import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const WIDGET_PATH = new URL('../embed/ozwell.js', import.meta.url);
const LOADER_PATH = new URL('../embed/ozwell-loader.js', import.meta.url);

async function readWidgetSource() {
  return readFile(WIDGET_PATH, 'utf8');
}

async function readLoaderSource() {
  return readFile(LOADER_PATH, 'utf8');
}

test('widget tool results do not use success+message as a direct response shortcut', async () => {
  const source = await readWidgetSource();

  assert.equal(
    source.includes('result.success && result.message'),
    false,
    'success+message must remain ordinary tool output and continue through the model'
  );
  assert.equal(
    source.includes("addMessage('assistant', result.message)"),
    false,
    'tool result messages must not be displayed directly by the widget'
  );
});

test('widget tool results are sent back with the matching OpenAI tool_call_id', async () => {
  const source = await readWidgetSource();

  assert.match(source, /const toolCallId = data\.id;/);
  assert.match(source, /role:\s*"tool"/);
  assert.match(source, /tool_call_id:\s*toolCallId/);
  assert.match(source, /content:\s*serializeToolResult\(result\)/);
  assert.match(source, /sendMessageStreaming\("", tools, thinkingRetryCount \+ 1\)/);
});

test('widget accepts falsy JSON-RPC ids and always serializes tool result content as a string', async () => {
  const source = await readWidgetSource();

  assert.match(source, /if \(toolCallId == null\)/);
  assert.doesNotMatch(source, /if \(!toolCallId\)/);
  assert.match(source, /function serializeToolResult\(result\)/);
  assert.match(source, /return serialized === void 0 \? "null" : serialized;/);
});

test('loader strips callable tool functions before sending config through postMessage', async () => {
  const source = await readLoaderSource();

  assert.match(source, /function sanitizeConfigForWidget\(config\)/);
  assert.match(source, /typeof tool\.function === 'function'/);
  assert.match(source, /Ignoring callable JavaScript function in tools\[\]\.function/);
  assert.match(source, /config: sanitizeConfigForWidget\(currentConfig\(\)\)/);
  assert.match(source, /\.map\(toolSchemaForWidget\)/);
});

test('loader preserves OpenAI-style function schema while keeping execution in ozwell-tool-call', async () => {
  const source = await readLoaderSource();

  assert.match(source, /tool\.function && typeof tool\.function === 'object'/);
  assert.match(source, /name: tool\.function\.name/);
  assert.match(source, /parameters: normalized\.inputSchema/);
  assert.match(source, /document\.dispatchEvent\(toolEvent\)/);
});

test('loader returns a tool error if the page handler never responds', async () => {
  const source = await readLoaderSource();

  assert.match(source, /const TOOL_RESPONSE_TIMEOUT_MS = 29000/);
  assert.match(source, /function finishToolCall\(message\)/);
  assert.match(source, /Tool "\$\{toolName\}" did not respond/);
  assert.match(source, /call respond\(\) or error\(\)/);
});
