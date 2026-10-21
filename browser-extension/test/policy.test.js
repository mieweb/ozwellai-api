import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, isEnabled, normalizeDomain, normalizeSettings, pageInfo, patternsForSettings } from '../policy.js';

test('defaults require an explicit action and only regular web pages are supported', () => {
  assert.equal(DEFAULT_SETTINGS.mode, 'manual');
  for (const url of ['chrome://extensions', 'about:blank', 'file:///private/test.html', 'data:text/html,test', 'not a URL']) {
    assert.equal(pageInfo(url).supported, false);
    assert.equal(isEnabled({ mode: 'always', domains: [] }, url, true), false);
  }
  assert.deepEqual(pageInfo('https://Example.COM/path?q=1'), {
    url: 'https://example.com/path?q=1', hostname: 'example.com', supported: true,
  });
});

test('domain input becomes normalized exact hostnames with no credentials or wildcard', () => {
  assert.equal(normalizeDomain('  HTTPS://EXAMPLE.COM:8443/path?q=1  '), 'example.com');
  assert.equal(normalizeDomain('localhost:3000'), 'localhost');
  assert.equal(normalizeDomain('bücher.example'), 'xn--bcher-kva.example');
  for (const input of ['', '*.example.com', 'has space.example', 'example.com.', 'https://user:password@example.com', 'ftp://example.com']) {
    assert.throws(() => normalizeDomain(input), undefined, input);
  }
  assert.deepEqual(normalizeSettings({ mode: 'allowlist', domains: ['EXAMPLE.com', 'https://example.com/path', 'b.example'] }), {
    mode: 'allowlist', domains: ['b.example', 'example.com'],
  });
  assert.throws(() => normalizeSettings({ mode: 'unknown', domains: [] }));
  assert.throws(() => normalizeSettings({ mode: 'always' }));
});

test('allowlist uses exact hostnames, without subdomain or suffix spoofing', () => {
  const settings = { mode: 'allowlist', domains: ['example.com'] };
  assert.equal(isEnabled(settings, 'https://example.com/a'), true);
  for (const url of ['https://sub.example.com', 'https://example.com.evil.test', 'https://evil-example.com', 'https://evil.test/?next=example.com']) {
    assert.equal(isEnabled(settings, url), false, url);
  }
  assert.deepEqual(patternsForSettings(settings), ['*://example.com/*']);
});

test('policy supports manual, allowlist, always, off, and temporary page overrides', () => {
  const url = 'https://example.com';
  assert.equal(isEnabled({ mode: 'manual', domains: [] }, url), false);
  assert.equal(isEnabled({ mode: 'manual', domains: [] }, url, true), true);
  assert.equal(isEnabled({ mode: 'always', domains: [] }, url), true);
  assert.equal(isEnabled({ mode: 'always', domains: [] }, url, false), false);
  assert.equal(isEnabled({ mode: 'off', domains: ['example.com'] }, url, true), false);
  assert.deepEqual(patternsForSettings({ mode: 'always', domains: [] }), ['http://*/*', 'https://*/*']);
  for (const mode of ['manual', 'off']) assert.deepEqual(patternsForSettings({ mode, domains: ['example.com'] }), []);
});
