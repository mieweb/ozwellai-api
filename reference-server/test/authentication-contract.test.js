import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';

const temp = mkdtempSync(path.join(tmpdir(), 'ozwell-auth-contract-'));
process.env.DB_PATH = path.join(temp, 'auth.db');
process.env.PUBLIC_BASE_URL = 'https://api.example.test';
process.env.WIDGET_SIGNUP_POLICY = 'open';
process.env.MODEL_DISCOVERY_REFRESH_MS = '0';
process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ desktop: { name: 'Desktop', redirect_uris: ['http://127.0.0.1/oauth/callback'] } });
const spec = await import('../dist/spec/index.js');
const { default: keyModule } = await import('../dist/reference-server/src/routes/api-key-identity.js');
const { default: desktopModule } = await import('../dist/reference-server/src/routes/desktop-auth.js');
const app = Fastify();
await app.register(swagger, { openapi: { info: { title: 'Contract test', version: '1' }, components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } } } });
await app.register(keyModule.default ?? keyModule);
await app.register(desktopModule.default ?? desktopModule);
await app.ready();
after(async () => { await app.close(); rmSync(temp, { recursive: true, force: true }); });

test('canonical authentication schemas describe both desktop token outcomes and bounded requests', () => {
  assert.ok(spec.ApiKeyIdentityRequestSchema, 'API-key identity must have a canonical /spec request');
  assert.ok(spec.DesktopTokenResponseSchema, 'desktop exchange must have a canonical /spec response');
  assert.deepEqual(spec.ApiKeyIdentityRequestSchema.parse({ email: ' owner@example.test ' }), { email: ' owner@example.test ' });
  assert.equal(spec.ApiKeyIdentityRequestSchema.safeParse({ email: 'a'.repeat(255) }).success, false);
  assert.equal(spec.DesktopTokenResponseSchema.safeParse({ session_token: 'sess_existing', email: 'owner@example.test' }).success, true);
  assert.equal(spec.DesktopTokenResponseSchema.safeParse({ attestation_required: true, login_id: 'login', account: { email: 'owner@example.test', user_id: 'owner' } }).success, true);
  assert.equal(spec.DesktopTokenResponseSchema.safeParse({ attestation_required: false, login_id: 'login', account: { email: 'owner@example.test', user_id: 'owner' } }).success, false);
  assert.equal(spec.DesktopRequestChallengeRequestSchema.safeParse({ method: 'GET', path: '/v1/agents', body_hash: '0'.repeat(64) }).success, true);
  assert.equal(spec.DesktopRequestChallengeRequestSchema.safeParse({ method: 'GET', path: '/v1/agents', body_hash: 'A'.repeat(64) }).success, false);
  assert.equal(spec.DesktopAuthorizeQuerySchema.safeParse({ response_type: 'code', client_id: 'desktop', redirect_uri: 'http://127.0.0.1/oauth/callback', state: 's'.repeat(31), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256' }).success, false);
});

test('every authentication endpoint publishes canonical request, success and rejection contracts', () => {
  const document = app.swagger();
  const endpoints = [
    ['/auth/api-key/identity', 'post', 'ApiKeyIdentityRequest'],
    ['/auth/desktop/authorize', 'get', 'DesktopAuthorizeQuery'],
    ['/auth/desktop/complete', 'post', 'DesktopCompleteRequest'],
    ['/auth/desktop/token', 'post', 'DesktopTokenRequest'],
    ['/auth/desktop/attestation/challenge', 'post', 'DesktopAttestationChallengeRequest'],
    ['/auth/desktop/attestation/verify', 'post', 'DesktopAttestationVerifyRequest'],
    ['/auth/desktop/challenge', 'post', 'DesktopRequestChallengeRequest'],
  ];
  for (const [url, method, schema] of endpoints) {
    const operation = document.paths[url][method];
    const request = method === 'get' ? operation.parameters : operation.requestBody;
    assert.ok(request, `${url} must publish its request`);
    assert.ok(operation.responses['200'], `${url} must publish its success`);
    assert.ok(operation.responses['400'], `${url} must publish validation errors`);
    assert.ok(operation.responses['401'], `${url} must publish authorization-hook errors`);
    if (method !== 'get') assert.match(JSON.stringify(request), new RegExp(schema), `${url} must consume its canonical schema`);
  }
  const page = document.paths['/auth/desktop/authorize'].get.responses['200'].content['text/html'].schema;
  const resolvedPage = page.$ref ? page.$ref.slice(2).split('/').reduce((value, key) => value[key], document) : page;
  assert.equal(resolvedPage.type, 'string');
  assert.doesNotMatch(JSON.stringify(document), /"_def"/);
});

test('canonical response serializers preserve validation, OAuth and API-key errors without changing HTML', async () => {
  const validation = await app.inject({ method: 'POST', url: '/auth/desktop/token', payload: {} });
  assert.equal(validation.statusCode, 400, validation.body);
  assert.equal(validation.json().statusCode, 400);
  assert.equal(validation.json().error, 'Bad Request');
  assert.equal(validation.json().code, 'FST_ERR_VALIDATION');
  assert.match(validation.json().message, /grant_type/);
  assert.deepEqual(Object.keys(validation.json()).sort(), ['code', 'error', 'message', 'statusCode'], 'internal validation details must not leak');
  const oauth = await app.inject({ method: 'POST', url: '/auth/desktop/token', payload: { grant_type: 'unsupported', client_id: 'desktop', redirect_uri: 'http://127.0.0.1/oauth/callback', code: 'missing', code_verifier: 'v'.repeat(43) } });
  assert.equal(oauth.statusCode, 400, oauth.body);
  assert.equal(oauth.json().error, 'invalid_grant');
  assert.equal(typeof oauth.json().error_description, 'string');
  const key = await app.inject({ method: 'POST', url: '/auth/api-key/identity', payload: { email: '' } });
  assert.equal(key.statusCode, 401, key.body);
  assert.equal(key.json().error.code, 'invalid_key_identity');
  assert.equal(key.json().error.param, null);
  const page = await app.inject({ url: '/auth/desktop/authorize?' + new URLSearchParams({ response_type: 'code', client_id: 'desktop', redirect_uri: 'http://127.0.0.1:45123/oauth/callback', state: 's'.repeat(43), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256' }) });
  assert.equal(page.statusCode, 200, page.body);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.body, /^<!doctype html>/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('full-server validation and bound-session authorization-hook envelopes survive canonical serialization', async () => {
  const { default: serverModule } = await import('../dist/reference-server/src/server.js');
  const { createSessionForIdentity, createAttestedDesktopSession, destroySession } = await import('../dist/reference-server/src/storage/sessions.js');
  const previousDirectory = process.cwd();
  let server;
  try {
    process.chdir(fileURLToPath(new URL('..', import.meta.url)));
    server = await (serverModule.default ?? serverModule)();
    await server.ready();
  } finally { process.chdir(previousDirectory); }
  try {
    for (const url of ['/auth/api-key/identity', '/auth/desktop/complete', '/auth/desktop/token', '/auth/desktop/attestation/challenge', '/auth/desktop/attestation/verify', '/auth/desktop/challenge']) {
      const response = await server.inject({ method: 'POST', url, payload: {} });
      assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
      // buildServer installs its root error handler after awaiting these
      // encapsulated routes, which retain Fastify's existing default handler.
      assert.equal(response.json().code, 'FST_ERR_VALIDATION');
      assert.deepEqual(Object.keys(response.json()).sort(), ['code', 'error', 'message', 'statusCode']);
    }
    // Also exercise the server's custom error envelope when inherited at route
    // registration time, rather than merely safeParse-testing that union arm.
    const inherited = Fastify();
    inherited.setErrorHandler(server.errorHandler);
    await inherited.register(keyModule.default ?? keyModule);
    await inherited.register(desktopModule.default ?? desktopModule);
    try {
      for (const url of ['/auth/api-key/identity', '/auth/desktop/token']) {
        const response = await inherited.inject({ method: 'POST', url, payload: {} });
        assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
        assert.equal(spec.ErrorSchema.safeParse(response.json()).success, true, response.body);
        assert.equal(response.json().error.type, 'invalid_request_error');
        assert.equal(typeof response.json().error.param, 'string');
        assert.equal(response.json().error.code, null);
      }
    } finally { await inherited.close(); }
    // A real session with an invalid attestation binding reaches the installed
    // shared hook. No verifier, enrollment or application-proof bypass is used.
    const source = createSessionForIdentity({ email: 'contract@example.test', externalUserId: 'contract:bound' });
    const token = createAttestedDesktopSession(source, { clientId: 'desktop', keyId: 'synthetic-missing-key', registrationHash: 'synthetic-missing-policy' });
    assert.ok(token);
    try {
      for (const url of ['/auth/api-key/identity', '/auth/desktop/complete', '/auth/desktop/token', '/auth/desktop/attestation/challenge', '/auth/desktop/attestation/verify', '/auth/desktop/challenge']) {
        const response = await server.inject({ method: 'POST', url, payload: {}, headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 401, `${url}: ${response.body}`);
        assert.deepEqual(response.json(), { error: { message: 'A valid Ozwell desktop application proof is required.', type: 'authentication_error', code: 'invalid_desktop_proof' } });
      }
      const page = await server.inject({ url: '/auth/desktop/authorize', headers: { authorization: `Bearer ${token}` } });
      assert.equal(page.statusCode, 401, page.body);
      assert.equal(page.json().error.code, 'invalid_desktop_proof');
      assert.equal(page.headers['cache-control'], 'no-store');
    } finally { destroySession(token); }
  } finally { await server.close(); }
});
