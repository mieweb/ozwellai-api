import { createBrowserTools } from './browser-tools-adapter.js';
import { initSamplePage } from '../public/browser-tools-sample.js';

const sample = initSamplePage();
const browser = createBrowserTools(document.getElementById('operations-app'));
const output = document.getElementById('tool-output');
const status = document.getElementById('controller-status');
const stepStatus = document.getElementById('demo-step-status');
const stepButton = document.getElementById('step-demo');
const visualMode = document.getElementById('visual-mode');
const runSpeed = document.getElementById('run-speed');
const buttons = ['read-page', 'run-demo', 'step-demo', 'reset-demo'].map((id) =>
  document.getElementById(id),
);
const dialogNext = document.createElement('button');
dialogNext.id = 'dialog-next-action';
dialogNext.type = 'button';
dialogNext.className = 'primary-button';
dialogNext.dataset.pageAgentIgnore = 'true';
dialogNext.textContent = 'Next action';
dialogNext.hidden = true;
document.getElementById('save-confirmation').append(dialogNext);

function updateVisualOptions() {
  browser.setVisualOptions({ mode: visualMode.value, speed: runSpeed.value });
}
visualMode.addEventListener('change', updateVisualOptions);
runSpeed.addEventListener('change', updateVisualOptions);
updateVisualOptions();

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

async function callTool(name, args = {}, options) {
  const result = await browser.callTool(name, args, options);
  log(name, args, result);
  return result;
}

// Same tool implementation for the console, Ozwell's iframe, and opt-in WebMCP.
document.addEventListener('ozwell-tool-call', (event) => {
  const { name, arguments: args, respond, signal } = event.detail;
  if (!browser.tools.some((tool) => tool.name === name)) return;
  if (signal?.aborted) return;
  callTool(name, args, { signal }).then((result) => {
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

const steps = [
  ['Open WO-1042', 'browser_click', '[data-testid="open-WO-1042"]'],
  ['Assign Maya Chen', 'browser_select', '#work-order-owner', 'Maya Chen'],
  ['Set In progress', 'browser_select', '#work-order-status', 'In progress'],
  [
    'Add dispatch notes',
    'browser_fill',
    '#work-order-notes',
    'Dispatch confirmed for the afternoon service window.',
  ],
  ['Mark urgent', 'browser_click', '#work-order-urgent'],
  ['Review changes', 'browser_click', '#save-work-order'],
  ['Confirm update', 'browser_click', '#confirm-save'],
];
let nextStep = null;

function clearSteps() {
  nextStep = null;
  stepButton.textContent = 'Step through';
  dialogNext.hidden = true;
}

async function performStep(index) {
  const [label, name, selector, value] = steps[index];
  stepStatus.textContent = `${index + 1}/7 · ${label}`;
  // Each click in step mode starts with a fresh observation, including any
  // manual edits made while the overlay was released between actions.
  const state = await readResult('browser_snapshot', {});
  const observed = sample.getState();
  if (index > 0 && observed.selectedId !== 'WO-1042') {
    throw new Error(
      'Guided demo stopped: WO-1042 is no longer selected. Start the demo again to continue.',
    );
  }
  // A user may already have marked it urgent while the step runner paused.
  if (selector === '#work-order-urgent' && observed.draft.urgent) return;
  const args = {
    snapshotId: state.snapshotId,
    index: browser.findIndex(selector, state.snapshotId),
  };
  if (value !== undefined) args.value = value;
  await readResult(name, args);
}

async function runDemo() {
  clearSteps();
  sample.reset();
  await browser.runWithVisuals(async () => {
    for (let index = 0; index < steps.length; index += 1)
      await performStep(index);
  });
  stepStatus.textContent = '7/7 · Work order update complete';
}

async function runNextStep() {
  if (nextStep === null) {
    sample.reset();
    nextStep = 0;
  }
  dialogNext.hidden = true;
  await performStep(nextStep);
  nextStep += 1;
  if (nextStep === steps.length) {
    clearSteps();
    stepStatus.textContent = '7/7 · Work order update complete';
    return 'Demo complete · WO-1042 saved';
  }
  stepButton.textContent = 'Next action';
  stepStatus.textContent = `${nextStep}/7 complete · Next: ${steps[nextStep][0]}`;
  // showModal makes the banner inert. Keep the final step reachable inside
  // the dialog, while excluding this demo control from agent snapshots.
  dialogNext.hidden = !document.getElementById('save-confirmation').open;
  return 'Step ready · continue when ready';
}

async function run(work, success) {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  visualMode.disabled = true;
  runSpeed.disabled = true;
  dialogNext.disabled = true;
  status.textContent = 'Running…';
  try {
    const message = await work();
    status.textContent = typeof message === 'string' ? message : success;
  } catch (error) {
    clearSteps();
    status.textContent = error.message;
    stepStatus.textContent = 'Run stopped · reset or start again';
    console.error(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    visualMode.disabled = false;
    runSpeed.disabled = false;
    dialogNext.disabled = false;
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
stepButton.addEventListener('click', () => run(runNextStep));
dialogNext.addEventListener('click', () => run(runNextStep));
document.getElementById('reset-demo').addEventListener('click', () => {
  clearSteps();
  sample.reset();
  output.replaceChildren();
  status.textContent = 'Ready · forked PageController';
  stepStatus.textContent =
    'Run the full workflow or step through one action at a time.';
});
status.textContent = 'Ready · forked PageController';
