import { DEFAULT_SETTINGS, normalizeSettings, patternsForSettings, pageInfo, isEnabled } from './policy.js';
import { WIDGET } from './config.js';

const SCRIPT_ID = 'ozwell';
const LEGACY_SCRIPT_IDS = ['ozwell-minimal'];
const SETTINGS_KEY = 'settings';
const OVERRIDES_KEY = 'tabOverrides';
const CONTENT_FILES = ['vendor/page-controller.js', 'page-tools.js', 'mcp-bridge.js', 'content-script.js'];

// Exported for dependency-free lifecycle tests; the browser instance is below.
export function createController(api) {
  let queue = Promise.resolve();
  const serialize = task => {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  };

  async function settings() {
    const stored = (await api.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
    try { return normalizeSettings(stored || DEFAULT_SETTINGS); }
    catch { return { ...DEFAULT_SETTINGS, domains: [] }; }
  }

  async function overrides() {
    return (await api.storage.session.get(OVERRIDES_KEY))[OVERRIDES_KEY] || {};
  }

  async function getState(tabId) {
    const config = await settings();
    let tab = {};
    try { if (Number.isInteger(tabId)) tab = await api.tabs.get(tabId); } catch { /* Closed tab. */ }
    const page = pageInfo(tab.url);
    const override = (await overrides())[tabId];
    const tabOverride = override?.url === page.url ? override.enabled : undefined;
    let enabled = isEnabled(config, page.url, tabOverride);
    if (enabled && tabOverride !== true) {
      const url = new URL(page.url);
      enabled = await api.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] });
    }
    return { settings: config, tab: { id: tab.id, ...page, enabled }, widget: WIDGET };
  }

  async function refresh({ resetTools = false } = {}) {
    const config = await settings();
    const desired = patternsForSettings(config);
    const matches = [];
    for (const pattern of desired) {
      if (await api.permissions.contains({ origins: [pattern] })) matches.push(pattern);
      else if (pattern.startsWith('*://')) {
        for (const scheme of ['http', 'https']) {
          const exact = pattern.replace('*:', `${scheme}:`);
          if (await api.permissions.contains({ origins: [exact] })) matches.push(exact);
        }
      }
    }
    // Also remove the previous extension version's registration on upgrade.
    // Remove old matches before adding new ones, including when switching Off.
    const registered = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, ...LEGACY_SCRIPT_IDS] });
    if (registered.length) {
      await api.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
    }
    if (matches.length) {
      await api.scripting.registerContentScripts([{
        id: SCRIPT_ID, matches, js: CONTENT_FILES,
        runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
      }]);
    }
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.map(async tab => {
      const state = await getState(tab.id);
      try {
        // Existing scripts must also receive Off, even after a host grant is revoked.
        await api.tabs.sendMessage(tab.id, {
          type: 'ozwell:sync', enabled: state.tab.enabled,
          powered: state.settings.mode !== 'off', resetTools, widget: WIDGET,
        });
      } catch { /* No content script on this tab yet. */ }
      if (state.tab.enabled) {
        try {
          await api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
        } catch { /* Browser-protected pages and revoked host grants cannot be injected. */ }
      }
    }));
  }

  return {
    getState: async tabId => { await queue; return getState(tabId); },
    refresh: options => serialize(() => refresh(options)),
    setSettings: value => serialize(async () => {
      const config = normalizeSettings(value);
      // Older popup clients do not send resumeMode when switching Off.
      if (config.mode === 'off' && value.resumeMode === undefined) {
        config.resumeMode = (await settings()).resumeMode;
      }
      for (const pattern of patternsForSettings(config)) {
        if (!await api.permissions.contains({ origins: [pattern] })) {
          throw new Error('Grant site access before saving this mode.');
        }
      }
      await api.storage.local.set({ [SETTINGS_KEY]: config });
      await api.storage.session.set({ [OVERRIDES_KEY]: {} });
      await refresh();
    }),
    toggleTab: tabId => serialize(async () => {
      const state = await getState(tabId);
      if (!state.tab.supported || state.settings.mode === 'off') {
        throw new Error('Choose an enabled mode and open a regular website first.');
      }
      // activeTab grants access for this explicit toolbar action only.
      await api.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      const current = await overrides();
      current[tabId] = { url: state.tab.url, enabled: !state.tab.enabled };
      await api.storage.session.set({ [OVERRIDES_KEY]: current });
      await api.tabs.sendMessage(tabId, {
        type: 'ozwell:sync', enabled: !state.tab.enabled,
        powered: true, widget: WIDGET,
      });
    }),
    clearTab: tabId => serialize(async () => {
      const current = await overrides();
      delete current[tabId];
      await api.storage.session.set({ [OVERRIDES_KEY]: current });
      const state = await getState(tabId);
      try {
        await api.tabs.sendMessage(tabId, {
          type: 'ozwell:sync', enabled: state.tab.enabled,
          powered: state.settings.mode !== 'off', resetTools: true, widget: WIDGET,
        });
      } catch { /* Tab may have closed or started a new document. */ }
    }),
  };
}

if (globalThis.chrome?.runtime?.id) {
  const controller = createController(chrome);
  const report = error => console.error('[Ozwell]', error);
  chrome.runtime.onInstalled.addListener(() => controller.refresh().catch(report));
  chrome.runtime.onStartup.addListener(() => controller.refresh().catch(report));
  chrome.permissions.onAdded.addListener(() => controller.refresh().catch(report));
  chrome.permissions.onRemoved.addListener(() => controller.refresh({ resetTools: true }).catch(report));
  chrome.tabs.onRemoved.addListener(tabId => controller.clearTab(tabId).catch(report));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) controller.clearTab(tabId).catch(report);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    const popup = sender.url === chrome.runtime.getURL('popup.html');
    let task;
    if (message?.type === 'ozwell:get-state') {
      task = controller.getState(popup ? message.tabId : sender.tab?.id);
    } else if (popup && message?.type === 'ozwell:set-settings') {
      task = controller.setSettings(message.settings).then(() => ({ ok: true }));
    } else if (popup && message?.type === 'ozwell:toggle-tab') {
      task = controller.toggleTab(message.tabId).then(() => ({ ok: true }));
    }
    if (!task) return;
    task.then(respond, error => respond({ error: error.message }));
    return true;
  });
}
