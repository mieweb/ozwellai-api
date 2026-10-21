import { createBrowserTools } from './browser-tools-adapter.js';
import { initSamplePage } from '../public/browser-tools-sample.js';

const sample = initSamplePage();
const browser = createBrowserTools(document.getElementById('operations-app'));
const output = document.getElementById('tool-output');
const status = document.getElementById('controller-status');
const buttons = ['read-page', 'run-demo', 'reset-demo'].map((id) =>
  document.getElementById(id),
);

function log(name, args, result) {
  if (!output.children.length) output.replaceChildren();
  const entry = document.createElement('details');
  entry.open = true;
  const summary = document.createElement('summary');
  summary.textContent = `${result.isError ? 'Error' : 'OK'} · ${name}`;
  const pre = document.createElement('pre');
  const data = JSON.parse(result.content[0].text);
  pre.textContent = JSON.stringify({ arguments: args, ...data }, null, 2);
  entry.append(summary, pre);
  output.prepend(entry);
  while (output.children.length > 12) output.lastChild.remove();
}

async function callTool(name, args = {}) {
  const result = await browser.callTool(name, args);
  log(name, args, result);
  return result;
}

// Same tool implementation for the console, Ozwell's iframe, and opt-in WebMCP.
document.addEventListener('ozwell-tool-call', (event) => {
  const { name, arguments: args, respond, signal } = event.detail;
  if (!browser.tools.some((tool) => tool.name === name)) return;
  if (signal?.aborted) return;
  callTool(name, args).then((result) => {
    if (!signal?.aborted) respond(result);
  });
});

const referenceBase = document.body.dataset.referenceBase.replace(/\/$/, '');
window.OzwellChatConfig = {
  widgetUrl: `${referenceBase}/widget/frame/`,
  title: 'Service desk assistant',
  welcomeMessage:
    'I can inspect and update the synthetic service desk. Ask me to read the page first.',
  placeholder: 'Assign WO-1042 to Maya Chen…',
  tools: browser.tools,
  webMCP: {
    tools: browser.tools.map((tool) => tool.name),
    exposedTo: [new URL(referenceBase).origin],
  },
};
const loader = document.createElement('script');
loader.src = `${referenceBase}/widget`;
loader.async = true;
loader.onerror = () => {
  const hint = document.createElement('p');
  hint.className = 'assistant-offline';
  hint.textContent =
    'Start the reference server for live chat. The local tool demo works independently.';
  document.getElementById('tool-console').append(hint);
};
document.head.append(loader);

window.browserToolsDemo = {
  tools: browser.tools,
  callTool,
  findIndex: (selector, snapshotId) => browser.findIndex(selector, snapshotId),
  getState: () => sample.getState(),
};

async function readResult(name, args) {
  const result = await callTool(name, args);
  const data = JSON.parse(result.content[0].text);
  if (result.isError) throw new Error(data.error);
  return data;
}

async function runDemo() {
  sample.reset();
  let state = await readResult('browser_snapshot', {});
  const step = async (name, selector, value) => {
    const args = {
      snapshotId: state.snapshotId,
      index: browser.findIndex(selector, state.snapshotId),
    };
    if (value !== undefined) args.value = value;
    state = await readResult(name, args);
  };
  await step('browser_click', '[data-testid="open-WO-1042"]');
  await step('browser_select', '#work-order-owner', 'Maya Chen');
  await step('browser_select', '#work-order-status', 'In progress');
  await step(
    'browser_fill',
    '#work-order-notes',
    'Dispatch confirmed for the afternoon service window.',
  );
  await step('browser_click', '#work-order-urgent');
  await step('browser_click', '#save-work-order');
  await step('browser_click', '#confirm-save');
  return state;
}

async function run(work, success) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  status.textContent = 'Running…';
  try {
    await work();
    status.textContent = success;
  } catch (error) {
    status.textContent = error.message;
    console.error(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

document
  .getElementById('read-page')
  .addEventListener('click', () =>
    run(() => readResult('browser_snapshot', {}), 'Page snapshot ready'),
  );
document
  .getElementById('run-demo')
  .addEventListener('click', () =>
    run(runDemo, 'Demo complete · WO-1042 saved'),
  );
document.getElementById('reset-demo').addEventListener('click', () => {
  sample.reset();
  output.replaceChildren();
  status.textContent = 'Ready · forked PageController';
});
status.textContent = 'Ready · forked PageController';
