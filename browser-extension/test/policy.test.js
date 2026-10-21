import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, isEnabled, normalizeDomain, normalizeSettings, pageInfo, patternsForSettings } from '../policy.js';

test('defaults require an explicit action and only regular web pages are supported', () => {
  assert.equal(DEFAULT_SETTINGS.mode, 'manual');
  assert.equal(DEFAULT_SETTINGS.resumeMode, 'manual');
  for (const url of ['chrome://extensions', 'about:blank', 'file:///private/test.html', 'data:text/html,test', 'not a URL']) {
    assert.equal(pageInfo(url).supported, false);
    assert.equal(isEnabled({ mode: 'always', domains: [] }, url, true), false);
  }
  assert.deepEqual(pageInfo('https://Ui.MIEWEB.ORG/path?q=1'), {
    url: 'https://ui.mieweb.org/path?q=1', hostname: 'ui.mieweb.org', supported: true,
  });
});

test('domain input becomes normalized exact hostnames with no credentials or wildcard', () => {
  assert.equal(normalizeDomain('  HTTPS://UI.MIEWEB.ORG:8443/path?q=1  '), 'ui.mieweb.org');
  assert.equal(normalizeDomain('localhost:3000'), 'localhost');
  assert.equal(normalizeDomain('bücher.example'), 'xn--bcher-kva.example');
  for (const input of ['', '*.ui.mieweb.org', 'has space.example', 'ui.mieweb.org.', 'https://user:password@ui.mieweb.org', 'ftp://ui.mieweb.org']) {
    assert.throws(() => normalizeDomain(input), undefined, input);
  }
  assert.deepEqual(normalizeSettings({ mode: 'allowlist', domains: ['UI.mieweb.org', 'https://ui.mieweb.org/path', 'b.example'] }), {
    mode: 'allowlist', domains: ['b.example', 'ui.mieweb.org'], resumeMode: 'allowlist',
  });
  assert.throws(() => normalizeSettings({ mode: 'unknown', domains: [] }));
  assert.throws(() => normalizeSettings({ mode: 'always' }));
});

test('settings without a saved resume mode migrate from the active mode or default to manual while off', () => {
  for (const mode of ['manual', 'allowlist', 'always']) {
    assert.deepEqual(normalizeSettings({ mode, domains: ['ui.mieweb.org'] }), {
      mode, domains: ['ui.mieweb.org'], resumeMode: mode,
    });
  }
  assert.deepEqual(normalizeSettings({ mode: 'off', domains: ['ui.mieweb.org'] }), {
    mode: 'off', domains: ['ui.mieweb.org'], resumeMode: 'manual',
  });
  assert.deepEqual(normalizeSettings({ mode: 'off', domains: [], resumeMode: 'allowlist' }), {
    mode: 'off', domains: [], resumeMode: 'allowlist',
  });
  assert.equal(normalizeSettings({ mode: 'always', domains: [], resumeMode: 'manual' }).resumeMode, 'always');
});

test('explicit invalid resume modes are rejected rather than silently enabling a different policy', () => {
  for (const resumeMode of ['off', 'unknown', '', null, 1]) {
    assert.throws(() => normalizeSettings({ mode: 'off', domains: [], resumeMode }), /resume/);
    assert.throws(() => normalizeSettings({ mode: 'manual', domains: [], resumeMode }), /resume/);
  }
});

test('allowlist uses exact hostnames, without subdomain or suffix spoofing', () => {
  const settings = { mode: 'allowlist', domains: ['ui.mieweb.org'] };
  assert.equal(isEnabled(settings, 'https://ui.mieweb.org/a'), true);
  for (const url of ['https://app.ui.mieweb.org', 'https://ui.mieweb.org.evil.test', 'https://evil-ui.mieweb.org', 'https://evil.test/?next=ui.mieweb.org']) {
    assert.equal(isEnabled(settings, url), false, url);
  }
  assert.deepEqual(patternsForSettings(settings), ['*://ui.mieweb.org/*']);
});

test('policy supports manual, allowlist, always, off, and temporary page overrides', () => {
  const url = 'https://ui.mieweb.org';
  assert.equal(isEnabled({ mode: 'manual', domains: [] }, url), false);
  assert.equal(isEnabled({ mode: 'manual', domains: [] }, url, true), true);
  assert.equal(isEnabled({ mode: 'always', domains: [] }, url), true);
  assert.equal(isEnabled({ mode: 'always', domains: [] }, url, false), false);
  assert.equal(isEnabled({ mode: 'off', domains: ['ui.mieweb.org'] }, url, true), false);
  assert.deepEqual(patternsForSettings({ mode: 'always', domains: [] }), ['http://*/*', 'https://*/*']);
  for (const mode of ['manual', 'off']) assert.deepEqual(patternsForSettings({ mode, domains: ['ui.mieweb.org'] }), []);
});
