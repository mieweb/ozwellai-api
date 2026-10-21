import { DEFAULT_SETTINGS, normalizeSettings, normalizeDomain, patternsForSettings } from './policy.js';
import { createWidgetHost, normalizeWidget } from './widget-host.js';
import { createPageConnection } from './page-connection.js';

const power = document.querySelector('#power-button');
const powerLabel = document.querySelector('#power-label');
const modeButtons = [...document.querySelectorAll('button[data-mode]')];
const domains = document.querySelector('#domains');
const save = document.querySelector('#save');
const toggle = document.querySelector('#toggle-tab');
const addSite = document.querySelector('#add-current-site');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const chatContainer = document.querySelector('#chat-container');
const chatEmpty = document.querySelector('#chat-empty');
const openOzwell = document.querySelector('#open-ozwell');
const pageControlStatus = document.querySelector('#page-control-status');
let pageConnection, connectedUrl;
const chat = createWidgetHost(chatContainer, {
  isAuthorized: () => Boolean(pageConnection && !pageConnection.disposed),
  getTools: options => pageConnection?.getTools(options) ?? [],
  callTool: (name, args, options) => {
    if (!pageConnection) throw new Error('Page access is unavailable.');
    return pageConnection.callTool(name, args, options);
  },
});
const descriptions = {
  manual: 'Show the page launcher when you choose it.',
  allowlist: 'Show the page launcher automatically on the domains below.',
  always: 'Show the page launcher automatically on all supported web pages.',
};

let tabId;
let state;
let draftMode = 'manual';
let busy = true;

function showFeedback(message = '', failure = '') {
  status.textContent = message;
  error.textContent = failure;
  error.hidden = !failure;
}

function updateMode() {
  for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === draftMode));
  document.querySelector('#domains-field').hidden = draftMode !== 'allowlist';
  document.querySelector('#mode-description').textContent = descriptions[draftMode];
}

function updateControls() {
  const enabled = Boolean(state && state.settings.mode !== 'off');
  power.disabled = busy || !state;
  power.setAttribute('aria-pressed', String(enabled));
  powerLabel.textContent = enabled ? 'Turn ozwell off' : 'Turn ozwell on';
  for (const button of modeButtons) button.disabled = busy;
  domains.disabled = save.disabled = busy;
  addSite.disabled = busy || !state?.tab?.supported || !state.tab.hostname;
  toggle.disabled = busy || !state?.tab?.supported || !enabled;
}

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  if (!result) throw new Error('ozwell could not respond. Please reopen the extension.');
  return result;
}

function disposePageConnection() {
  const previous = pageConnection;
  pageConnection = connectedUrl = null;
  previous?.dispose();
}

function connectPage(enabled) {
  if (pageControlStatus) pageControlStatus.hidden = !enabled;
  if (!enabled || !state.tab?.supported || !Number.isInteger(tabId)) {
    disposePageConnection();
    if (pageControlStatus) pageControlStatus.textContent = 'Chat only on this page';
    return;
  }
  if (pageConnection && !pageConnection.disposed && connectedUrl === state.tab.url) return;
  disposePageConnection();
  connectedUrl = state.tab.url;
  if (pageControlStatus) pageControlStatus.textContent = 'Connecting to this page…';
  let candidate;
  candidate = createPageConnection(tabId, connectedUrl, {
    onStateChange: ({ connected }) => {
      if (pageConnection === candidate && pageControlStatus) {
        pageControlStatus.textContent = connected ? 'Can read and control this page' : 'Chat only on this page';
      }
      if (pageConnection === candidate) void chat.refreshTools();
    },
  });
  pageConnection = candidate;
  if (candidate.disposed) {
    if (pageControlStatus) pageControlStatus.textContent = 'Chat only on this page';
    void chat.refreshTools();
  }
}

async function refresh() {
  state = await send({ type: 'ozwell:get-state', tabId });
  state.settings = normalizeSettings(state.settings ?? DEFAULT_SETTINGS);
  draftMode = state.settings.mode === 'off' ? state.settings.resumeMode : state.settings.mode;
  domains.value = state.settings.domains.join('\n');
  document.querySelector('#current-site').textContent = state.tab?.hostname || 'Chat is available on this page';
  toggle.textContent = state.tab?.enabled ? 'Hide page launcher' : 'Show page launcher';
  toggle.setAttribute('aria-pressed', String(Boolean(state.tab?.enabled)));
  updateMode();
  const enabled = state.settings.mode !== 'off';
  connectPage(enabled);
  chatContainer.hidden = !enabled;
  chatEmpty.hidden = enabled;
  openOzwell.hidden = true;
  openOzwell.removeAttribute('href');
  if (enabled) {
    const widget = normalizeWidget(state.widget);
    openOzwell.href = widget.frameUrl;
    openOzwell.hidden = false;
    chat.mount(widget);
  } else chat.destroy();
}

for (const button of modeButtons) button.addEventListener('click', () => {
  draftMode = button.dataset.mode;
  updateMode();
  showFeedback('Save to apply these page settings.');
});

addSite.addEventListener('click', () => {
  if (!state?.tab?.hostname) return;
  const hostname = normalizeDomain(state.tab.hostname);
  const entries = domains.value.split(/[\s,]+/).filter(Boolean);
  if (!entries.includes(hostname)) entries.push(hostname);
  domains.value = entries.join('\n');
  showFeedback('Current site added. Save to apply.');
});

async function applySettings(settings, message) {
  const origins = patternsForSettings(settings);
  busy = true;
  updateControls();
  showFeedback();
  try {
    // Both callers are direct clicks/submits. Request before any other async work.
    if (origins.length && !await chrome.permissions.request({ origins })) {
      showFeedback('', 'Site access was not granted. Settings were not saved.');
      return;
    }
    await send({ type: 'ozwell:set-settings', settings });
    await refresh();
    showFeedback(message);
  } catch (cause) {
    // A failed power change must reflect the stored state after its immediate teardown.
    try { await refresh(); } catch { /* Preserve the original settings error. */ }
    showFeedback('', cause.message || 'Could not save settings. Please try again.');
  } finally {
    busy = false;
    updateControls();
  }
}

power.addEventListener('click', () => {
  if (busy || !state) return;
  const enabled = state.settings.mode !== 'off';
  const settings = normalizeSettings({
    ...state.settings,
    mode: enabled ? 'off' : state.settings.resumeMode,
  });
  // Tear down credentials and conversation immediately when the user switches off.
  if (enabled) {
    disposePageConnection();
    if (pageControlStatus) pageControlStatus.hidden = true;
    chat.destroy();
    chatContainer.hidden = true;
    chatEmpty.hidden = false;
    openOzwell.hidden = true;
    openOzwell.removeAttribute('href');
  }
  void applySettings(settings, enabled ? 'ozwell is off.' : 'ozwell is on.');
});

document.querySelector('#settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || !state) return;
  try {
    const settings = normalizeSettings({
      mode: state.settings.mode === 'off' ? 'off' : draftMode,
      resumeMode: draftMode,
      domains: draftMode === 'allowlist'
        ? domains.value.split(/[\s,]+/).filter(Boolean).map(normalizeDomain)
        : state.settings.domains,
    });
    void applySettings(settings, 'Page settings saved.');
  } catch (cause) {
    showFeedback('', cause.message || 'Check your selected domains and try again.');
  }
});

toggle.addEventListener('click', async () => {
  if (busy || toggle.disabled) return;
  busy = true;
  updateControls();
  showFeedback();
  try {
    await send({ type: 'ozwell:toggle-tab', tabId });
    await refresh();
    showFeedback(state.tab?.enabled ? 'Page launcher is visible.' : 'Page launcher is hidden.');
  } catch (cause) {
    showFeedback('', cause.message || 'Could not update this page. Please try again.');
  } finally {
    busy = false;
    updateControls();
  }
});

async function initialize() {
  try {
    // Toolbar chat works even when this browser page cannot host a content script.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
    } catch { /* Keep the toolbar chat available without a current tab. */ }
    await refresh();
  } catch (cause) {
    showFeedback('', cause.message || 'Could not load ozwell. Please reopen the extension.');
  } finally {
    busy = false;
    updateControls();
  }
}

window.addEventListener('pagehide', () => { disposePageConnection(); chat.destroy(); });
void initialize();
