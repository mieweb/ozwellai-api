import { DEFAULT_SETTINGS, normalizeSettings, normalizeDomain, patternsForSettings } from './policy.js';

const mode = document.querySelector('#mode');
const domains = document.querySelector('#domains');
const save = document.querySelector('#save');
const toggle = document.querySelector('#toggle-tab');
const addSite = document.querySelector('#add-current-site');
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const descriptions = {
  off: 'Keep Ozwell hidden on every page.',
  manual: 'Show Ozwell when you choose it for a page.',
  allowlist: 'Show Ozwell automatically on the domains below.',
  always: 'Show Ozwell automatically on all supported web pages.',
};

let tabId;
let state;
let busy = true;

function showFeedback(message = '', failure = '') {
  status.textContent = message;
  error.textContent = failure;
  error.hidden = !failure;
}

function updateMode() {
  document.querySelector('#domains-field').hidden = mode.value !== 'allowlist';
  document.querySelector('#mode-description').textContent = descriptions[mode.value];
}

function updateControls() {
  mode.disabled = busy;
  domains.disabled = busy;
  save.disabled = busy;
  addSite.disabled = busy || !state?.tab?.supported || !state.tab.hostname;
  toggle.disabled = busy || !state?.tab?.supported || state.settings.mode === 'off';
}

async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  if (!result) throw new Error('Ozwell could not respond. Please reopen the extension.');
  return result;
}

async function refresh() {
  state = await send({ type: 'ozwell:get-state', tabId });
  const settings = normalizeSettings(state.settings ?? DEFAULT_SETTINGS);
  mode.value = settings.mode;
  domains.value = settings.domains.join('\n');
  document.querySelector('#current-site').textContent = state.tab?.hostname || 'This page is unavailable';
  toggle.textContent = state.tab?.enabled ? 'Hide Ozwell on this page' : 'Show Ozwell on this page';
  toggle.setAttribute('aria-pressed', String(Boolean(state.tab?.enabled)));
  updateMode();
}

mode.addEventListener('change', () => {
  updateMode();
  showFeedback('Save to apply this mode.');
});

addSite.addEventListener('click', () => {
  if (!state?.tab?.hostname) return;
  const hostname = normalizeDomain(state.tab.hostname);
  const entries = domains.value.split(/[\s,]+/).filter(Boolean);
  if (!entries.includes(hostname)) entries.push(hostname);
  domains.value = entries.join('\n');
  showFeedback('Current site added. Save to apply.');
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  try {
    const settings = normalizeSettings({
      mode: mode.value,
      domains: mode.value === 'allowlist'
        ? domains.value.split(/[\s,]+/).filter(Boolean).map(normalizeDomain)
        : state?.settings?.domains ?? DEFAULT_SETTINGS.domains,
    });
    const origins = patternsForSettings(settings);
    busy = true;
    updateControls();
    showFeedback();
    // Request from this user gesture before any other asynchronous work.
    if (origins.length && !await chrome.permissions.request({ origins })) {
      showFeedback('', 'Site access was not granted. Settings were not saved.');
      return;
    }
    await send({ type: 'ozwell:set-settings', settings });
    await refresh();
    showFeedback('Settings saved.');
  } catch (cause) {
    showFeedback('', cause.message || 'Could not save settings. Please try again.');
  } finally {
    busy = false;
    updateControls();
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
    showFeedback(state.tab?.enabled ? 'Ozwell is available on this page.' : 'Ozwell is hidden on this page.');
  } catch (cause) {
    showFeedback('', cause.message || 'Could not update this page. Please try again.');
  } finally {
    busy = false;
    updateControls();
  }
});

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    await refresh();
    if (!state.tab?.supported) showFeedback('Open a regular HTTP or HTTPS page to use Ozwell.');
    if (state.settings.mode === 'off') showFeedback('Choose another mode and save to enable Ozwell.');
  } catch (cause) {
    showFeedback('', cause.message || 'Could not load Ozwell. Please reopen the extension.');
  } finally {
    busy = false;
    updateControls();
  }
}

initialize();
