import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const AGENTS_ROUTE = new URL('../src/routes/agents.ts', import.meta.url);
const WIDGET_SOURCE = new URL('../embed/src/WidgetApp.tsx', import.meta.url);
const WIDGET_BUNDLE = new URL('../embed/ozwell.js', import.meta.url);
const DEMO_PAGE = new URL('../public/raw-embed-agent-draft.html', import.meta.url);

async function read(url) {
  return readFile(url, 'utf8');
}

test('agents suggest endpoint gives LLM current Ozwell YAML contract', async () => {
  const source = await read(AGENTS_ROUTE);

  assert.match(source, /POST \/v1\/agents\/suggest/);
  assert.match(source, /function supportedAgentYamlContract\(\)/);
  assert.match(source, /instructions: string, required/);
  assert.match(source, /Use instructions, not system/);
  assert.match(source, /Set model to exactly: \$\{LLM_MODEL\}/);
  assert.match(source, /Server default model: \$\{LLM_MODEL\}/);
  assert.match(source, /tools:\s*array, optional/);
  assert.match(source, /Do not include metadata, widgetTitle, pageTitle, url, or source fields/);
  assert.match(source, /removeNonPortableSuggestionFields/);
  assert.match(source, /inputSchema/);
  assert.match(source, /parseAndValidate\(suggestedYaml, reply\)/);
  assert.match(source, /llmClient\.createChatCompletion/);
});

test('widget exposes raw-parent-key agent menu and hides it for agent keys', async () => {
  const source = await read(WIDGET_SOURCE);

  assert.match(source, /rawToolEmbedConfigured/);
  assert.match(source, /!isAgentKeyConfigured\(config\)/);
  assert.match(source, /Boolean\(config\.tools && config\.tools\.length > 0\)/);
  assert.match(source, /Export Tools YAML/);
  assert.match(source, /Suggest an Agent/);
});

test('widget draft mode is immediately editable and sends edited YAML for revision', async () => {
  const source = await read(WIDGET_SOURCE);

  assert.match(source, /className="ozwell-agent-draft-editor"/);
  assert.match(source, /agentDraftStatus/);
  assert.match(source, /Drafting agent YAML/);
  assert.match(source, /Revising agent YAML/);
  assert.match(source, /ozwell-agent-draft-spinner/);
  assert.match(source, /value=\{agentDraftYaml\}/);
  assert.match(source, /onChange=\{\(event\) => setAgentDraftYaml\(event\.target\.value\)\}/);
  assert.doesNotMatch(source, />Edit<\/Button>/);
  assert.match(source, /Copy/);
  assert.match(source, /Save/);
  assert.match(source, /Close/);
  assert.match(source, /type: 'download_yaml'/);
  assert.doesNotMatch(source, /link\.download = 'ozwell-agent\.yaml'/);
  assert.match(source, /yaml: agentDraftYaml \|\| ''/);
  assert.match(source, /requestAgentSuggestion\('revise', instruction\)/);
});

test('export tools YAML is local and suggest endpoint is LLM-backed', async () => {
  const source = await read(WIDGET_SOURCE);

  assert.match(source, /const exportToolsYaml = useCallback/);
  assert.match(source, /const yamlText = buildToolsYaml\(\)/);
  assert.doesNotMatch(source.match(/const exportToolsYaml[\s\S]*?\n  \}, \[buildToolsYaml, copyText\]\);/)?.[0] || '', /requestAgentSuggestion/);
  assert.match(source, /const openAgentDraft = useCallback/);
  assert.match(source, /requestAgentSuggestion\('initial'\)/);
});

test('demo page exists for recording raw embed draft workflow', async () => {
  const page = await read(DEMO_PAGE);

  assert.doesNotMatch(page, /defaultUI: false/);
  assert.doesNotMatch(page, /containerId: 'chat-box'/);
  assert.match(page, /<link rel="icon" href="\/favicon\.ico">/);
  assert.match(page, /apiKey: 'ozw_demo_localhost_key_for_testing'/);
  assert.match(page, /agentSuggestionContext/);
  assert.match(page, /get_ticket/);
  assert.match(page, /add_ticket_note/);
  assert.match(page, /set_ticket_status/);
});

test('rebuilt widget bundle contains draft UI markers', async () => {
  const bundle = await read(WIDGET_BUNDLE);

  assert.match(bundle, /ozwell-agent-draft-editor/);
  assert.match(bundle, /Export Tools YAML/);
  assert.match(bundle, /Suggest an Agent/);
  assert.match(bundle, /Ask AI to revise this YAML/);
});
