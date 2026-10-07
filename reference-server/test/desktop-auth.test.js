import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

const temp = mkdtempSync(path.join(tmpdir(), 'ozwell-desktop-auth-'));
process.env.DB_PATH = path.join(temp, 'auth.db');
process.env.PUBLIC_BASE_URL = 'https://api.example.test';
process.env.WIDGET_SIGNUP_POLICY = 'open';
process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ 'ozwell-desktop': { name: 'Ozwell Desktop', redirect_uris: ['http://127.0.0.1/oauth/callback', 'https://desktop.example.test/oauth/callback'] } });
const { DesktopAuthorizationStore, DesktopAuthError, desktopLoginAvailable } = await import('../dist/reference-server/src/storage/desktop-auth.js');
const { createSessionForIdentity, destroySession } = await import('../dist/reference-server/src/storage/sessions.js');
const { default: desktopModule } = await import('../dist/reference-server/src/routes/desktop-auth.js');
const { default: authModule } = await import('../dist/reference-server/src/routes/auth.js');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(32).toString('base64url');
const input = { clientId: 'ozwell-desktop', redirectUri: 'http://127.0.0.1:45123/oauth/callback', state, challenge };
const redeem = (code, overrides = {}) => ({ ...input, code, verifier, grantType: 'authorization_code', ...overrides });
const invalid = code => error => error instanceof DesktopAuthError && error.code === code;
let app;
before(async () => {
  app = Fastify({ logger: false });
  await app.register(desktopModule.default ?? desktopModule);
  await app.register(authModule.default ?? authModule);
  await app.ready();
});
after(async () => { await app.close(); rmSync(temp, { recursive: true, force: true }); });
function authorizeUrl(overrides = {}) {
  return '/auth/desktop/authorize?' + new URLSearchParams({ response_type: 'code', client_id: input.clientId, redirect_uri: input.redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256', ...overrides });
}
function extractFlow(response) {
  const config = JSON.parse(response.body.match(/id="ozwell-desktop-config"[^>]*>(.*?)<\/script>/s)[1]);
  return { config, cookie: response.headers['set-cookie'].split(';')[0] };
}
function complete(flow, token, headers = {}) {
  return app.inject({ method: 'POST', url: '/auth/desktop/complete', headers: { origin: 'https://api.example.test', cookie: flow.cookie, authorization: `Bearer ${token}`, ...headers }, payload: { flow_id: flow.config.flowId } });
}
function exchange(code, overrides = {}) {
  return app.inject({ method: 'POST', url: '/auth/desktop/token', payload: { grant_type: 'authorization_code', client_id: input.clientId, redirect_uri: input.redirectUri, code, code_verifier: verifier, ...overrides } });
}

test('registered public clients require exact redirect registration and S256', () => {
  const store = new DesktopAuthorizationStore();
  for (const redirectUri of ['http://localhost:45123/oauth/callback', 'http://[::1]:45123/oauth/callback', 'http://2130706433:45123/oauth/callback', 'http://127.0.0.1:45123/other', 'http://127.0.0.1:45123/oauth/callback?x=1', 'http://127.0.0.1:45123/oauth/callback#fragment', 'http://127.0.0.1:0/oauth/callback', 'http://127.0.0.1:65536/oauth/callback', 'https://desktop.example.test/oauth/callback/other', 'https://desktop.example.test.evil.test/oauth/callback']) assert.throws(() => store.begin({ ...input, redirectUri }, 'S256', 'code'), invalid('invalid_request'));
  for (const values of [{ clientId: 'unknown' }, { state: 'short' }, { challenge: 'wrong' }]) assert.throws(() => store.begin({ ...input, ...values }, 'S256', 'code'), invalid('invalid_request'));
  assert.throws(() => store.begin(input, 'plain', 'code'), invalid('invalid_request'));
  assert.throws(() => store.begin(input, 'S256', 'token'), invalid('invalid_request'));
  assert.ok(store.begin({ ...input, redirectUri: 'https://desktop.example.test/oauth/callback' }, 'S256', 'code').flowId);
});

test('browser binding, one-time flow and code, redirect binding and verifier prevent replay', () => {
  const store = new DesktopAuthorizationStore();
  const flow = store.begin(input, 'S256', 'code');
  assert.throws(() => store.complete(flow.flowId, 'wrong-cookie', 'sess_test'), invalid('invalid_request'));
  const url = new URL(store.complete(flow.flowId, flow.cookie, 'sess_test'));
  assert.equal(url.searchParams.get('state'), state);
  assert.doesNotMatch(url.href, /sess_test/);
  assert.throws(() => store.complete(flow.flowId, flow.cookie, 'sess_test'), invalid('invalid_request'));
  const code = url.searchParams.get('code');
  for (const values of [{ clientId: 'other' }, { redirectUri: 'http://127.0.0.1:45124/oauth/callback' }, { verifier: randomBytes(32).toString('base64url') }]) assert.throws(() => store.redeem(redeem(code, values)), invalid('invalid_grant'));
  assert.equal(store.redeem(redeem(code)), 'sess_test');
  assert.throws(() => store.redeem(redeem(code)), invalid('invalid_grant'));
});

test('flows expire at ten minutes and codes expire at sixty seconds', () => {
  let now = 1000;
  const store = new DesktopAuthorizationStore(() => now);
  const expired = store.begin(input, 'S256', 'code');
  now += 600_000;
  assert.throws(() => store.complete(expired.flowId, expired.cookie, 'sess_test'), invalid('invalid_request'));
  const flow = store.begin(input, 'S256', 'code');
  const code = new URL(store.complete(flow.flowId, flow.cookie, 'sess_test')).searchParams.get('code');
  now += 60_000;
  assert.throws(() => store.redeem(redeem(code)), invalid('invalid_grant'));
});

test('removing registration invalidates pending codes; discovery supports custom clients and fails closed', async () => {
  const store = new DesktopAuthorizationStore();
  const flow = store.begin(input, 'S256', 'code');
  const code = new URL(store.complete(flow.flowId, flow.cookie, 'sess_test')).searchParams.get('code');
  const original = process.env.OZWELL_DESKTOP_CLIENTS;
  try {
    process.env.OZWELL_DESKTOP_CLIENTS = '{}';
    assert.equal(desktopLoginAvailable(), false);
    assert.throws(() => store.redeem(redeem(code)), invalid('invalid_grant'));
    process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ custom: { name: 'Custom app', redirect_uris: ['https://app.example.test/callback'] } });
    assert.equal((await app.inject({ url: '/auth/methods' })).json().desktop_login, true);
    process.env.OZWELL_DESKTOP_CLIENTS = 'invalid json';
    assert.equal((await app.inject({ url: '/auth/methods' })).json().desktop_login, false);
  } finally { process.env.OZWELL_DESKTOP_CLIENTS = original; }
});

test('hosted page uses private cookie, restrictive CSP, inert client label and never redirects invalid input', async () => {
  const response = await app.inject({ url: authorizeUrl() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Lax; Path=\/auth\/desktop; Max-Age=600; Secure/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(response.headers['content-security-policy'], /connect-src 'self'/);
  const bad = await app.inject({ url: authorizeUrl({ redirect_uri: 'https://attacker.example/callback' }) });
  assert.equal(bad.statusCode, 400); assert.equal(bad.headers.location, undefined);
  const original = process.env.OZWELL_DESKTOP_CLIENTS;
  try {
    process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ 'ozwell-desktop': { name: '</script><script>alert(1)</script>', redirect_uris: ['http://127.0.0.1/oauth/callback'] } });
    const escaped = await app.inject({ url: authorizeUrl() });
    assert.doesNotMatch(escaped.body, /<script>alert/);
    assert.equal(extractFlow(escaped).config.clientName, '</script><script>alert(1)</script>');
  } finally { process.env.OZWELL_DESKTOP_CLIENTS = original; }
});

test('completion rejects cross-origin requests, missing cookie, and API keys instead of sessions', async () => {
  const flow = extractFlow(await app.inject({ url: authorizeUrl() }));
  const token = createSessionForIdentity({ email: 'browser-bound@example.test', externalUserId: 'desktop-test:bound' });
  assert.equal((await complete(flow, token, { origin: 'https://attacker.example' })).statusCode, 403);
  assert.equal((await complete(flow, token, { cookie: '' })).statusCode, 400);
  assert.equal((await complete(flow, 'ozw_not-a-session')).statusCode, 401);
  assert.equal((await complete(flow, token, { 'sec-fetch-site': 'cross-site' })).statusCode, 403);
});

test('hosted sign-in returns only code/state in callback and exchanges once for the existing Ozwell session', async () => {
  const flow = extractFlow(await app.inject({ url: authorizeUrl() }));
  const token = createSessionForIdentity({ email: 'desktop-user@example.test', externalUserId: 'desktop-test:success' });
  const completed = await complete(flow, token);
  assert.equal(completed.statusCode, 200); assert.doesNotMatch(completed.body, /sess_/);
  const callback = new URL(completed.json().redirect_uri);
  assert.equal(callback.origin, 'http://127.0.0.1:45123'); assert.equal(callback.searchParams.get('state'), state);
  const result = await exchange(callback.searchParams.get('code'));
  assert.equal(result.statusCode, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(result.json(), { session_token: token, email: 'desktop-user@example.test' });
  assert.equal((await exchange(callback.searchParams.get('code'))).statusCode, 400);
  assert.equal((await complete(flow, token)).statusCode, 400);
});

test('revoked sessions cannot be redeemed from previously issued codes', async () => {
  const flow = extractFlow(await app.inject({ url: authorizeUrl() }));
  const token = createSessionForIdentity({ email: 'revoked-desktop@example.test', externalUserId: 'desktop-test:revoked' });
  const completed = await complete(flow, token);
  const code = new URL(completed.json().redirect_uri).searchParams.get('code');
  destroySession(token);
  assert.equal((await exchange(code)).statusCode, 400);
});
