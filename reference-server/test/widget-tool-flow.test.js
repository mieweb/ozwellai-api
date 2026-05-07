import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const WIDGET_PATH = new URL('../embed/ozwell.js', import.meta.url);

async function readWidgetSource() {
  return readFile(WIDGET_PATH, 'utf8');
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
  assert.match(source, /role:\s*'tool'/);
  assert.match(source, /tool_call_id:\s*toolCallId/);
  assert.match(source, /content:\s*JSON\.stringify\(result\)/);
  assert.match(source, /sendMessageStreaming\('', tools\)/);
});
