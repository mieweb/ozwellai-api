import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../background.js';
import { WIDGET } from '../config.js';

const clone = value => structuredClone(value);

function mockChrome({ settings, tabs = [{ id: 1, url: 'https://ui.mieweb.org/path' }], grants = [], session = {}, scripts = [] } = {}) {
  const local = settings ? { settings: clone(settings) } : {};
  const sessionData = clone(session);
  const tabData = new Map(tabs.map(tab => [tab.id, clone(tab)]));
  const permissions = new Set(grants);
  const calls = { registered: [], unregistered: [], injected: [], messages: [] };
  let registered = clone(scripts);
  let failInjection = false;
  function hasOrigin(origin) {
    if (permissions.has(origin)) return true;
    if (origin.startsWith('*://')) return permissions.has('http://*/*') && permissions.has('https://*/*');
    return permissions.has(origin.startsWith('https:') ? 'https://*/*' : 'http://*/*') ||
      permissions.has(origin.replace(/^https?:/, '*:'));
  }
  const area = values => ({
    async get(key) { return { [key]: clone(values[key]) }; },
    async set(update) { Object.assign(values, clone(update)); },
  });
  return {
    local, session: sessionData, tabs: tabData, permissions, calls,
    set failInjection(value) { failInjection = value; },
    get registered() { return clone(registered); },
    api: {
      storage: { local: area(local), session: area(sessionData) },
      permissions: { async contains({ origins }) { return origins.every(hasOrigin); } },
      tabs: {
        async get(id) { if (!tabData.has(id)) throw new Error('Tab closed'); return clone(tabData.get(id)); },
        async query() { return clone([...tabData.values()]); },
        async sendMessage(tabId, message) { calls.messages.push({ tabId, ...clone(message) }); },
      },
      scripting: {
        async getRegisteredContentScripts({ ids } = {}) { return clone(ids ? registered.filter(script => ids.includes(script.id)) : registered); },
        async unregisterContentScripts({ ids }) {
          calls.unregistered.push(...ids);
          registered = registered.filter(script => !ids.includes(script.id));
        },
        async registerContentScripts(scripts) { calls.registered.push(...clone(scripts)); registered.push(...clone(scripts)); },
        async executeScript(options) {
          if (failInjection) throw new Error('Cannot access this page');
          calls.injected.push(clone(options));
        },
      },
    },
  };
}

test('default manual mode registers nothing and enables only the explicitly toggled page', async () => {
  const mock = mockChrome();
  const controller = createController(mock.api);
  assert.equal((await controller.getState(1)).tab.enabled, false);
  await controller.refresh();
  assert.deepEqual(mock.registered, []);
  assert.deepEqual(mock.calls.injected, []);
  await controller.toggleTab(1);
  assert.equal((await controller.getState(1)).tab.enabled, true);
  assert.deepEqual(mock.calls.injected, [{ target: { tabId: 1 }, files: ['content-script.js'] }]);
  assert.deepEqual(mock.calls.messages.at(-1), { tabId: 1, type: 'ozwell:sync', enabled: true, widget: WIDGET });
  await controller.toggleTab(1);
  assert.equal((await controller.getState(1)).tab.enabled, false);
  assert.equal(mock.calls.messages.at(-1).enabled, false);
});

test('automatic modes require grants before committing settings', async () => {
  const mock = mockChrome();
  const controller = createController(mock.api);
  await assert.rejects(controller.setSettings({ mode: 'allowlist', domains: ['ui.mieweb.org'] }), /Grant site access/);
  await assert.rejects(controller.setSettings({ mode: 'always', domains: [] }), /Grant site access/);
  assert.equal((await controller.getState(1)).settings.mode, 'manual');
  assert.deepEqual(mock.local, {});
  assert.deepEqual(mock.registered, []);
});

test('allowlist persistently registers only exact hosts and injects eligible open tabs', async () => {
  const mock = mockChrome({
    grants: ['*://ui.mieweb.org/*'],
    tabs: [{ id: 1, url: 'https://ui.mieweb.org/path' }, { id: 2, url: 'https://app.ui.mieweb.org/' }, { id: 3, url: 'https://ui.mieweb.org.evil.test/' }],
  });
  const controller = createController(mock.api);
  await controller.setSettings({ mode: 'allowlist', domains: ['HTTPS://UI.MIEWEB.ORG/path'] });
  assert.deepEqual(mock.local.settings, { mode: 'allowlist', domains: ['ui.mieweb.org'], resumeMode: 'allowlist' });
  assert.deepEqual(mock.registered, [{
    id: 'ozwell', matches: ['*://ui.mieweb.org/*'], js: ['content-script.js'],
    runAt: 'document_idle', allFrames: false, persistAcrossSessions: true,
  }]);
  assert.deepEqual(mock.calls.injected.map(call => call.target.tabId), [1]);
  assert.deepEqual(mock.calls.messages.map(({ tabId, enabled }) => ({ tabId, enabled })).sort((a, b) => a.tabId - b.tabId), [
    { tabId: 1, enabled: true }, { tabId: 2, enabled: false }, { tabId: 3, enabled: false },
  ]);
});

test('always mode covers HTTP and HTTPS, while off unregisters and tells mounted scripts to hide', async () => {
  const mock = mockChrome({
    grants: ['http://*/*', 'https://*/*'],
    tabs: [{ id: 1, url: 'https://ui.mieweb.org/' }, { id: 2, url: 'http://other.test/' }, { id: 3, url: 'chrome://extensions' }],
  });
  const controller = createController(mock.api);
  await controller.setSettings({ mode: 'always', domains: [] });
  assert.deepEqual(mock.registered[0].matches, ['http://*/*', 'https://*/*']);
  assert.deepEqual(mock.calls.injected.map(call => call.target.tabId), [1, 2]);
  await controller.toggleTab(1);
  assert.equal((await controller.getState(1)).tab.enabled, false);
  await controller.setSettings({ mode: 'off', domains: [] });
  assert.deepEqual(mock.registered, []);
  assert.deepEqual(mock.calls.unregistered, ['ozwell']);
  assert.deepEqual(mock.local.settings, { mode: 'off', domains: [], resumeMode: 'always' });
  assert.deepEqual(mock.session.tabOverrides, {});
  assert.ok(mock.calls.messages.slice(-3).every(message => message.enabled === false));
  await assert.rejects(controller.toggleTab(1), /enabled mode/);
  assert.equal((await controller.getState(1)).tab.enabled, false);
});

test('power off retains each last enabled mode across worker recreation and older popup saves', async () => {
  for (const mode of ['manual', 'allowlist', 'always']) {
    const mock = mockChrome({
      settings: { mode, domains: ['ui.mieweb.org'] },
      grants: ['http://*/*', 'https://*/*'],
    });
    const controller = createController(mock.api);
    await controller.setSettings({ mode: 'off', domains: ['ui.mieweb.org'], resumeMode: mode });
    assert.deepEqual(mock.local.settings, { mode: 'off', domains: ['ui.mieweb.org'], resumeMode: mode });
    const recreated = createController(mock.api);
    assert.equal((await recreated.getState(1)).settings.resumeMode, mode);
    // An older popup writing Off again must not erase the remembered mode.
    await recreated.setSettings({ mode: 'off', domains: ['ui.mieweb.org'] });
    assert.equal(mock.local.settings.resumeMode, mode);
    await recreated.setSettings({ mode: mock.local.settings.resumeMode, domains: ['ui.mieweb.org'] });
    assert.deepEqual(mock.local.settings, { mode, domains: ['ui.mieweb.org'], resumeMode: mode });
  }
});

test('saved modes update the resume target, while invalid resume settings leave persisted state intact', async () => {
  const mock = mockChrome({ grants: ['http://*/*', 'https://*/*'] });
  const controller = createController(mock.api);
  await controller.setSettings({ mode: 'allowlist', domains: ['ui.mieweb.org'] });
  await controller.setSettings({ mode: 'always', domains: ['ui.mieweb.org'], resumeMode: 'allowlist' });
  assert.equal(mock.local.settings.resumeMode, 'always');
  await assert.rejects(controller.setSettings({ mode: 'off', domains: ['ui.mieweb.org'], resumeMode: 'off' }), /resume/);
  assert.deepEqual(mock.local.settings, { mode: 'always', domains: ['ui.mieweb.org'], resumeMode: 'always' });
  await controller.setSettings({ mode: 'off', domains: ['ui.mieweb.org'] });
  assert.equal(mock.local.settings.resumeMode, 'always');
});

test('refresh migrates legacy content script registrations without touching unrelated registrations', async () => {
  const mock = mockChrome({
    settings: { mode: 'allowlist', domains: ['ui.mieweb.org'] },
    grants: ['*://ui.mieweb.org/*'],
    scripts: [{ id: 'ozwell-minimal' }, { id: 'ozwell' }, { id: 'unrelated' }],
  });
  await createController(mock.api).refresh();
  assert.deepEqual(mock.calls.unregistered.sort(), ['ozwell', 'ozwell-minimal']);
  assert.deepEqual(mock.registered.map(script => script.id).sort(), ['ozwell', 'unrelated']);
  assert.deepEqual(mock.calls.registered[0].matches, ['*://ui.mieweb.org/*']);
});

test('off removes legacy registrations and hides old injected widgets without injecting new scripts', async () => {
  const mock = mockChrome({
    settings: { mode: 'off', domains: ['ui.mieweb.org'], resumeMode: 'allowlist' },
    scripts: [{ id: 'ozwell-minimal' }],
    session: { tabOverrides: { 1: { url: 'https://ui.mieweb.org/path', enabled: true } } },
  });
  await createController(mock.api).refresh();
  assert.deepEqual(mock.calls.unregistered, ['ozwell-minimal']);
  assert.deepEqual(mock.registered, []);
  assert.deepEqual(mock.calls.injected, []);
  assert.equal(mock.calls.messages.at(-1).enabled, false);
  assert.equal((await createController(mock.api).getState(1)).settings.resumeMode, 'allowlist');
});

test('page toggles are scoped to the full URL and clearing on navigation removes the override', async () => {
  const mock = mockChrome();
  const controller = createController(mock.api);
  await controller.toggleTab(1);
  mock.tabs.get(1).url = 'https://ui.mieweb.org/another';
  assert.equal((await controller.getState(1)).tab.enabled, false);
  await controller.clearTab(1);
  assert.deepEqual(mock.session.tabOverrides, {});
  mock.tabs.get(1).url = 'https://ui.mieweb.org/path';
  assert.equal((await controller.getState(1)).tab.enabled, false);
});

test('temporary page state survives service worker recreation in the same browser session', async () => {
  const mock = mockChrome();
  await createController(mock.api).toggleTab(1);
  const recreated = createController(mock.api);
  assert.equal((await recreated.getState(1)).tab.enabled, true);
  await recreated.refresh();
  assert.equal(mock.calls.messages.at(-1).enabled, true);
  assert.deepEqual(mock.registered, []);
  const newSession = mockChrome({ settings: mock.local.settings });
  assert.equal((await createController(newSession.api).getState(1)).tab.enabled, false);
});

test('saved automatic settings survive recreation and re-register only hosts still granted', async () => {
  const mock = mockChrome({
    settings: { mode: 'allowlist', domains: ['ui.mieweb.org', 'other.test'] },
    grants: ['*://ui.mieweb.org/*'],
    tabs: [{ id: 1, url: 'https://ui.mieweb.org/' }, { id: 2, url: 'https://other.test/' }],
  });
  await createController(mock.api).refresh();
  assert.deepEqual(mock.registered[0].matches, ['*://ui.mieweb.org/*']);
  assert.equal(mock.calls.messages.find(message => message.tabId === 2).enabled, false);
  assert.deepEqual(mock.calls.injected.map(call => call.target.tabId), [1]);
});

test('revoking site permission unregisters automatic injection and hides the existing widget', async () => {
  const mock = mockChrome({ grants: ['*://ui.mieweb.org/*'] });
  const controller = createController(mock.api);
  await controller.setSettings({ mode: 'allowlist', domains: ['ui.mieweb.org'] });
  mock.permissions.clear();
  mock.calls.injected.length = 0;
  await controller.refresh();
  assert.deepEqual(mock.registered, []);
  assert.equal((await controller.getState(1)).tab.enabled, false);
  assert.equal(mock.calls.messages.at(-1).enabled, false);
  assert.deepEqual(mock.calls.injected, []);
});

test('partial broad permission revocation preserves only the still granted scheme', async () => {
  const mock = mockChrome({
    settings: { mode: 'always', domains: [] }, grants: ['https://*/*'],
    tabs: [{ id: 1, url: 'https://ui.mieweb.org/' }, { id: 2, url: 'http://ui.mieweb.org/' }],
  });
  const controller = createController(mock.api);
  await controller.refresh();
  assert.deepEqual(mock.registered[0].matches, ['https://*/*']);
  assert.equal((await controller.getState(1)).tab.enabled, true);
  assert.equal((await controller.getState(2)).tab.enabled, false);
  assert.deepEqual(mock.calls.injected.map(call => call.target.tabId), [1]);
});

test('partial allowlist permission revocation retains HTTPS while hiding ungranted HTTP pages', async () => {
  const mock = mockChrome({
    settings: { mode: 'allowlist', domains: ['ui.mieweb.org'] }, grants: ['https://ui.mieweb.org/*'],
    tabs: [{ id: 1, url: 'https://ui.mieweb.org/' }, { id: 2, url: 'http://ui.mieweb.org/' }],
  });
  const controller = createController(mock.api);
  await controller.refresh();
  assert.deepEqual(mock.registered[0].matches, ['https://ui.mieweb.org/*']);
  assert.equal((await controller.getState(1)).tab.enabled, true);
  assert.equal((await controller.getState(2)).tab.enabled, false);
  assert.deepEqual(mock.calls.injected.map(call => call.target.tabId), [1]);
});

test('failed explicit injection does not save an enabled override', async () => {
  const mock = mockChrome();
  mock.failInjection = true;
  const controller = createController(mock.api);
  await assert.rejects(controller.toggleTab(1), /Cannot access/);
  assert.equal((await controller.getState(1)).tab.enabled, false);
  assert.equal(mock.session.tabOverrides, undefined);
});

test('closed tabs and browser pages do not inject, and invalid stored settings recover to manual', async () => {
  const mock = mockChrome({ settings: { mode: 'invalid' }, tabs: [{ id: 1, url: 'chrome://extensions' }] });
  const controller = createController(mock.api);
  assert.equal((await controller.getState(1)).settings.mode, 'manual');
  assert.equal((await controller.getState(42)).tab.supported, false);
  await assert.rejects(controller.toggleTab(1), /regular website/);
  await assert.rejects(controller.toggleTab(42), /regular website/);
  assert.deepEqual(mock.calls.injected, []);
});

test('settings changes and page toggles run in order and failed changes do not poison the queue', async () => {
  const mock = mockChrome({ grants: ['*://ui.mieweb.org/*'] });
  const controller = createController(mock.api);
  await assert.rejects(controller.setSettings({ mode: 'invalid', domains: [] }));
  const saved = controller.setSettings({ mode: 'allowlist', domains: ['ui.mieweb.org'] });
  const toggled = controller.toggleTab(1);
  await Promise.all([saved, toggled]);
  const state = await controller.getState(1);
  assert.equal(state.settings.mode, 'allowlist');
  assert.equal(state.tab.enabled, false);
});
