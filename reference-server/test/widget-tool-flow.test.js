import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const WIDGET_PATH = new URL('../embed/ozwell.js', import.meta.url);
const WIDGET_APP_PATH = new URL('../embed/src/WidgetApp.tsx', import.meta.url);
const WIDGET_TYPES_PATH = new URL('../embed/src/types.ts', import.meta.url);
const LOADER_PATH = new URL('../embed/ozwell-loader.js', import.meta.url);
const SERVER_PATH = new URL('../src/server.ts', import.meta.url);

async function readWidgetSource() {
  return readFile(WIDGET_PATH, 'utf8');
}

async function readWidgetAppSource() {
  return readFile(WIDGET_APP_PATH, 'utf8');
}

async function readWidgetTypesSource() {
  return readFile(WIDGET_TYPES_PATH, 'utf8');
}

async function readLoaderSource() {
  return readFile(LOADER_PATH, 'utf8');
}

async function readServerSource() {
  return readFile(SERVER_PATH, 'utf8');
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

test('loader opens the hosted widget frame instead of an inline document', async () => {
  const source = await readLoaderSource();

  assert.match(source, /widgetUrl: autoDetectedBase \? `\$\{autoDetectedBase\}\/widget\/frame\/`/);
  assert.match(source, /iframe\.src = widgetSrc;/);
  assert.doesNotMatch(source, /iframe\.srcdoc\s*=/);
});

test('server publishes only the widget runtime assets below /widget', async () => {
  const source = await readServerSource();

  assert.match(source, /serve: false/);
  assert.match(source, /fastify\.get\('\/widget'/);
  assert.match(source, /sendFile\('ozwell-loader\.js'\)/);
  assert.match(source, /fastify\.get\('\/widget\/ozwell\.js'/);
  assert.match(source, /sendFile\('ozwell\.js'\)/);
  assert.match(source, /fastify\.get\('\/widget\/frame\/'/);
  assert.match(source, /sendFile\('frame\/index\.html'\)/);
  assert.doesNotMatch(source, /prefix: '\/widget\/'/);
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

test('widget fetches effective provider model options for the selector', async () => {
  const appSource = await readWidgetAppSource();
  const bundleSource = await readWidgetSource();

  assert.match(appSource, /\/v1\/models\/effective/);
  assert.match(appSource, /function effectiveModelsEndpoint/);
  assert.match(bundleSource, /\/v1\/models\/effective/);
});

test('loader forwards the agent default model to the widget before effective models load', async () => {
  const loaderSource = await readLoaderSource();

  assert.match(loaderSource, /default_model/);
  assert.match(loaderSource, /state\.runtimeConfig/);
});

test('loader discovers agent context for manual mounts before configuring the frame', async () => {
  const loaderSource = await readLoaderSource();

  assert.match(loaderSource, /function discoverAgentContext\(\)/);
  assert.match(loaderSource, /function mount\(options = \{\}\) \{\s*discoverAgentContext\(\);/);
  assert.match(loaderSource, /case 'ready':[\s\S]*discoverAgentContext\(\)\.finally\(/);
  assert.match(loaderSource, /case 'tools\/list':[\s\S]*discoverAgentContext\(\)\.finally\(/);
});

test('widget chat payload can include selected provider and model', async () => {
  const appSource = await readWidgetAppSource();
  const typesSource = await readWidgetTypesSource();

  assert.match(typesSource, /provider\?: string/);
  assert.match(appSource, /requestBody\.provider = selectedModel\.provider/);
  assert.match(appSource, /requestBody\.model = selectedModel\.model/);
});

test('widget adapter uses OzwellChat for the shared model selector', async () => {
  const appSource = await readWidgetAppSource();
  const bundleSource = await readWidgetSource();

  assert.match(appSource, /<OzwellChat/);
  assert.match(appSource, /models=\{activeModel \? \{/);
  assert.match(appSource, /providerFilter,/);
  assert.match(appSource, /useState<string \| null>\(null\)/);
  assert.match(bundleSource, /composer-model-selector-trigger/);
});

test('widget adapter delegates queued message controls to OzwellChat', async () => {
  const appSource = await readWidgetAppSource();

  assert.match(appSource, /queuedMessage=\{queuedMessage\}/);
  assert.match(appSource, /onQueuedMessageChange=\{setQueuedMessage\}/);
  assert.match(appSource, /onCancelQueuedMessage=\{\(\) => setQueuedMessage\(null\)\}/);
  assert.doesNotMatch(appSource, /id: 'queued-message'/);
});

test('widget preserves legacy model-only chat config when no provider is resolved', async () => {
  const appSource = await readWidgetAppSource();

  assert.match(appSource, /else if \(configRef\.current\.model\) requestBody\.model = configRef\.current\.model;/);
});

test('widget displays unavailable configured model errors as a friendly assistant message', async () => {
  const appSource = await readWidgetAppSource();

  assert.match(appSource, /configured_model_unavailable/);
  assert.match(appSource, /This assistant is temporarily unavailable\. Please try again later\./);
});

test('widget sends exactly one follow-up completion after all parallel tool results arrive', async () => {
  const appSource = await readWidgetAppSource();

  // The turn's tool_call ids are tracked as a set when the calls are dispatched.
  assert.match(appSource, /awaitingToolResultsRef\.current = new Set\(/);
  // Each result removes its id; the follow-up only fires once the set is empty.
  assert.match(appSource, /awaitingToolResultsRef\.current\.delete\(String\(toolCallId\)\);/);
  assert.match(
    appSource,
    /if \(wasAwaiting && awaitingToolResultsRef\.current\.size === 0\) \{\s*void sendMessageStreaming\('', toolsForRequest\(\)\);/
  );
  // The parent-message handler must not call sendMessageStreaming directly per result.
  const handlerStart = appSource.indexOf('function handleParentMessage(');
  const handlerEnd = appSource.indexOf("window.addEventListener('message', handleParentMessage);");
  assert.notEqual(handlerStart, -1, 'Parent-message handler declaration must exist');
  assert.notEqual(handlerEnd, -1, 'Parent-message handler registration must exist');
  assert.ok(handlerEnd > handlerStart, 'Handler registration must follow its declaration');
  const handlerSource = appSource.slice(handlerStart, handlerEnd);
  assert.doesNotMatch(handlerSource, /sendMessageStreaming\(/);
  assert.match(handlerSource, /recordToolResultRef\.current\(toolCallId, result\);/);
  // A timed-out tool call records a synthetic error result so the history remains valid.
  assert.match(appSource, /recordToolResultRef\.current\(id, \{ error: 'Tool call timed out' \}\);/);
});

test('widget refuses overlapping sendMessageStreaming calls and defers the follow-up', async () => {
  const appSource = await readWidgetAppSource();

  assert.match(
    appSource,
    /async function sendMessageStreaming\([^)]*\)[^{]*\{\s*if \(sendingRef\.current\) \{\s*followUpPendingRef\.current = true;/
  );
  assert.match(
    appSource,
    /if \(followUpPendingRef\.current\) \{\s*followUpPendingRef\.current = false;\s*return sendMessageStreaming\('', toolsForRequest\(\)\);/
  );
});

test('widget drops empty assistant turns instead of rendering "(no response)"', async () => {
  const appSource = await readWidgetAppSource();
  const bundleSource = await readWidgetSource();

  assert.doesNotMatch(appSource, /\(no response\)/);
  assert.doesNotMatch(bundleSource, /\(no response\)/);
  assert.match(
    appSource,
    /\} else if \(!trimmedContent\) \{\s*\/\/[^\n]*\n\s*setDisplayMessages\(\(current\) => current\.filter\(\(message\) => message\.id !== assistantMessageId\)\);/
  );
  assert.match(appSource, /Empty assistant turn[^']*Raw chunks:', rawChunks\)/);
});

test('widget SSE parsing accepts vendor reasoning fields and tool_calls without an index', async () => {
  const appSource = await readWidgetAppSource();

  assert.match(appSource, /function extractThinkingDelta\(/);
  assert.match(appSource, /\['thinking', 'reasoning_content', 'reasoning'\]/);
  assert.match(appSource, /function resolveToolCallIndex\(/);
  assert.match(appSource, /if \(typeof toolCallDelta\.index === 'number'\) return toolCallDelta\.index;/);
  assert.match(appSource, /accumulated\.findIndex\(\(tc\) => tc\?\.id === toolCallDelta\.id\)/);
});
