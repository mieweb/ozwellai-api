import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

const directory = mkdtempSync(path.join(tmpdir(), 'ozwell-attested-session-'));
process.env.DB_PATH = path.join(directory, 'auth.db');
process.env.WIDGET_SIGNUP_POLICY = 'open';
process.env.PUBLIC_BASE_URL = 'https://api.example.test';
const { getDatabase, agentStore } = await import('../dist/reference-server/src/storage/agents.js');
const { createSessionForIdentity, validateSession, destroySession } = await import('../dist/reference-server/src/storage/sessions.js');
const { DesktopAttestationService, DesktopAttestedKeyStore, desktopBodyHash } = await import('../dist/reference-server/src/storage/desktop-attestation.js');
const { desktopLoginAvailable, desktopRegistrationHash } = await import('../dist/reference-server/src/storage/desktop-auth.js');
const { installDesktopSessionAuthorization } = await import('../dist/reference-server/src/util/desktop-session-auth.js');
const { default: desktopModule } = await import('../dist/reference-server/src/routes/desktop-auth.js');
const { default: authModule } = await import('../dist/reference-server/src/routes/auth.js');
const db = getDatabase();
const keys = new DesktopAttestedKeyStore(db);
const policy = { team_id: 'AB12345678', signing_identifier: 'com.example.ozwell', bundle_versions: ['1'] };
function registration(versions = ['1']) {
  process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ strict: { name: 'Official Ozwell', redirect_uris: ['http://127.0.0.1/oauth/callback'], apple_app_attest: { ...policy, bundle_versions: versions } }, plain: { name: 'Public client', redirect_uris: ['http://127.0.0.1/oauth/callback'] } });
}
registration();
let nextUser = 0;
function source(email = `owner-${++nextUser}@example.test`) { return createSessionForIdentity({ email, externalUserId: `fixture:${email}` }); }
function keyPair() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { ...pair, id: randomBytes(32).toString('base64'), counter: 0 };
}
function makeVerifier(pair, gate = async () => {}) {
  // A test-only signed fixture stands in for Apple's trust chain. Production has no injectable route/environment bypass.
  const read = async (input, assertion) => {
    await gate();
    const value = JSON.parse((assertion ? input.assertion : input.attestation).toString());
    assert.equal(input.keyId, pair.id);
    assert.equal(value.challenge, input.challenge.toString('base64url'));
    const message = JSON.stringify({ challenge: value.challenge, counter: value.counter, version: value.version });
    assert.ok(verify('sha256', Buffer.from(message), pair.publicKey, Buffer.from(value.signature, 'base64')));
    assert.ok(input.bundleVersions.includes(value.version));
    return value;
  };
  return {
    async attestation(input) { const value = await read(input, false); return { publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), receipt: 'c3ludGhldGljLXJlY2VpcHQ=', counter: 0, teamId: input.teamId, signingIdentifier: input.signingIdentifier, bundleVersion: value.version }; },
    async assertion(input) { const value = await read(input, true); assert.ok(value.counter > input.previousCounter); return { counter: value.counter, bundleVersion: value.version }; },
  };
}
function proof(pair, challenge, { counter = ++pair.counter, version = '1' } = {}) {
  const value = { challenge, counter, version };
  const signature = sign('sha256', Buffer.from(JSON.stringify(value)), pair.privateKey).toString('base64');
  return Buffer.from(JSON.stringify({ ...value, signature })).toString('base64');
}
const apps = [];
after(async () => { await Promise.all(apps.map(app => app.close())); db.close(); rmSync(directory, { recursive: true, force: true }); });
async function fixture({ pair = keyPair(), gate, now = () => Date.now() } = {}) {
  registration();
  const service = new DesktopAttestationService(keys, makeVerifier(pair, gate), now);
  const app = Fastify({ logger: false });
  installDesktopSessionAuthorization(app, service);
  await app.register(desktopModule.default ?? desktopModule, { attestationService: service });
  await app.register(authModule.default ?? authModule);
  for (const url of ['/v1/models/effective', '/v1/agents']) app.get(url, async request => ({ authorization: request.headers.authorization }));
  app.post('/v1/chat/completions', async request => ({ authorization: request.headers.authorization, body: request.body }));
  await app.ready(); apps.push(app);
  const post = (url, payload, token) => app.inject({ method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  async function enroll(token = source()) {
    const started = service.beginLogin(token, 'strict');
    const challenge = await post('/auth/desktop/attestation/challenge', { login_id: started.login_id, key_id: pair.id });
    assert.equal(challenge.statusCode, 200); assert.equal(challenge.json().proof_kind, 'attestation');
    const issued = await post('/auth/desktop/attestation/verify', { login_id: started.login_id, key_id: pair.id, proof: proof(pair, challenge.json().challenge, { counter: 0 }) });
    assert.equal(issued.statusCode, 200);
    return issued.json().session_token;
  }
  async function headers(token, method, url, body, options) {
    const result = await post('/auth/desktop/challenge', { method, path: url, body_hash: desktopBodyHash(body) }, token);
    assert.equal(result.statusCode, 200);
    return { authorization: `Bearer ${token}`, 'x-ozwell-attestation-key': pair.id, 'x-ozwell-attestation-challenge': result.json().challenge_id, 'x-ozwell-attestation-proof': proof(pair, result.json().challenge, options) };
  }
  return { app, service, pair, post, enroll, headers };
}

test('strict PKCE grant never releases its browser bearer and failed policy parsing never downgrades it', async () => {
  const { app, post, enroll } = await fixture();
  const token = source();
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: 'strict', redirect_uri: 'http://127.0.0.1:45555/oauth/callback', state: randomBytes(32).toString('base64url'), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
  const page = await app.inject({ url: `/auth/desktop/authorize?${params}` });
  const config = JSON.parse(page.body.match(/id="ozwell-desktop-config"[^>]*>(.*?)<\/script>/s)[1]);
  const complete = await app.inject({ method: 'POST', url: '/auth/desktop/complete', headers: { origin: process.env.PUBLIC_BASE_URL, cookie: page.headers['set-cookie'].split(';')[0], authorization: `Bearer ${token}` }, payload: { flow_id: config.flowId } });
  const code = new URL(complete.json().redirect_uri).searchParams.get('code');
  const exchange = await post('/auth/desktop/token', { grant_type: 'authorization_code', client_id: 'strict', redirect_uri: 'http://127.0.0.1:45555/oauth/callback', code, code_verifier: verifier });
  assert.equal(exchange.statusCode, 200);
  assert.deepEqual(Object.keys(exchange.json()).sort(), ['account', 'attestation_required', 'login_id']);
  assert.doesNotMatch(exchange.body, /sess_|ozw_/);
  assert.equal(exchange.json().attestation_required, true);
  const bound = await enroll(token);
  assert.equal(validateSession(token), null);
  assert.equal(validateSession(bound).desktopAttestation.clientId, 'strict');
  process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify({ strict: { name: 'Bad policy', redirect_uris: ['http://127.0.0.1/oauth/callback'], apple_app_attest: { ...policy, bundle_versions: [] } } });
  assert.equal(desktopLoginAvailable(), false);
});

test('bound sessions require proofs for session, logout, catalog and chat; authority rewrites only after proof', async () => {
  const fx = await fixture(); const sourceToken = source(); const parent = validateSession(sourceToken).parentKey; const token = await fx.enroll(sourceToken);
  for (const [method, url] of [['GET', '/auth/session'], ['POST', '/auth/logout'], ['GET', '/v1/models/effective'], ['GET', '/v1/agents'], ['POST', '/v1/chat/completions']]) {
    assert.equal((await fx.app.inject({ method, url, ...(method === 'POST' ? { payload: {} } : {}), headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
  }
  const read = await fx.app.inject({ url: '/auth/session', headers: await fx.headers(token, 'GET', '/auth/session') }); assert.equal(read.statusCode, 200);
  const catalog = await fx.app.inject({ url: '/v1/models/effective', headers: await fx.headers(token, 'GET', '/v1/models/effective') }); assert.equal(catalog.json().authorization, `Bearer ${parent}`);
  const body = { model: 'fixture', messages: [{ role: 'user', content: 'synthetic only' }] };
  const chat = await fx.app.inject({ method: 'POST', url: '/v1/chat/completions', payload: body, headers: await fx.headers(token, 'POST', '/v1/chat/completions', body) });
  assert.equal(chat.statusCode, 200); assert.deepEqual(chat.json(), { authorization: `Bearer ${parent}`, body });
  const loggedOut = await fx.app.inject({ method: 'POST', url: '/auth/logout', payload: {}, headers: await fx.headers(token, 'POST', '/auth/logout', {}) });
  assert.equal(loggedOut.statusCode, 200); assert.equal(validateSession(token), null);
});

test('request proofs bind exact body, query, method, key and session, expire and cannot replay', async () => {
  let now = Date.now(); const fx = await fixture({ now: () => now }); const token = await fx.enroll();
  const body = { value: 1 };
  const changed = await fx.headers(token, 'POST', '/v1/chat/completions?mode=a', body);
  assert.equal((await fx.app.inject({ method: 'POST', url: '/v1/chat/completions?mode=a', payload: { value: 2 }, headers: changed })).statusCode, 401);
  assert.equal((await fx.app.inject({ method: 'POST', url: '/v1/chat/completions?mode=a', payload: body, headers: changed })).statusCode, 401);
  const query = await fx.headers(token, 'GET', '/v1/agents?a=1');
  assert.equal((await fx.app.inject({ url: '/v1/agents?a=2', headers: query })).statusCode, 401);
  const wrongKey = await fx.headers(token, 'GET', '/auth/session');
  assert.equal((await fx.app.inject({ url: '/auth/session', headers: { ...wrongKey, 'x-ozwell-attestation-key': randomBytes(32).toString('base64') } })).statusCode, 401);
  const timed = await fx.headers(token, 'GET', '/auth/session'); now += 60_000;
  assert.equal((await fx.app.inject({ url: '/auth/session', headers: timed })).statusCode, 401);
  const valid = await fx.headers(token, 'GET', '/auth/session');
  assert.equal((await fx.app.inject({ url: '/auth/session', headers: valid })).statusCode, 200);
  assert.equal((await fx.app.inject({ url: '/auth/session', headers: valid })).statusCode, 401);
  assert.equal((await fx.post('/auth/desktop/challenge', { method: 'GET', path: '/v1/keys', body_hash: desktopBodyHash(undefined) }, token)).statusCode, 400);
  assert.equal((await fx.app.inject({ url: '/auth/methods', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
});

test('login challenges expire, consume failures, cap attempts and reject keys owned by another account or client', async () => {
  let now = Date.now(); const fx = await fixture({ now: () => now }); const token = await fx.enroll();
  const existing = validateSession(token); const next = source(existing.email);
  const grant = fx.service.beginLogin(next, 'strict');
  const first = fx.service.loginChallenge(grant.login_id, fx.pair.id); assert.equal(first.proof_kind, 'assertion');
  await assert.rejects(fx.service.verifyLogin(grant.login_id, fx.pair.id, Buffer.from('bad').toString('base64')));
  await assert.rejects(fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, first.challenge)));
  for (let i = 1; i < 5; i++) fx.service.loginChallenge(grant.login_id, fx.pair.id);
  assert.throws(() => fx.service.loginChallenge(grant.login_id, fx.pair.id));
  const foreign = fx.service.beginLogin(source(), 'strict'); assert.throws(() => fx.service.loginChallenge(foreign.login_id, fx.pair.id));
  const expired = fx.service.beginLogin(source(), 'strict'); now += 300_000; assert.throws(() => fx.service.loginChallenge(expired.login_id, randomBytes(32).toString('base64')));
  assert.throws(() => fx.service.beginLogin(existing.parentKey, 'strict'));
});

test('persistent keys use assertions on later logins and atomic counters reject concurrent replay', async () => {
  const fx = await fixture(); const token = await fx.enroll(); const owner = validateSession(token);
  const service = new DesktopAttestationService(new DesktopAttestedKeyStore(db), makeVerifier(fx.pair));
  const sourceToken = source(owner.email); const grant = service.beginLogin(sourceToken, 'strict');
  const challenge = service.loginChallenge(grant.login_id, fx.pair.id); assert.equal(challenge.proof_kind, 'assertion');
  const issued = await service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, challenge.challenge));
  assert.notEqual(issued.session_token, sourceToken); assert.equal(validateSession(sourceToken), null);
  const one = service.requestChallenge(issued.session_token, 'GET', '/auth/session', desktopBodyHash(undefined));
  const two = service.requestChallenge(issued.session_token, 'GET', '/auth/session', desktopBodyHash(undefined));
  const counter = ++fx.pair.counter;
  const results = await Promise.allSettled([one, two].map(item => service.verifyRequest(issued.session_token, 'GET', '/auth/session', undefined, item.challenge_id, fx.pair.id, proof(fx.pair, item.challenge, { counter }))));
  assert.deepEqual(results.map(item => item.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(keys.get(fx.pair.id).sign_count, counter);
});

test('revocation and registration changes invalidate bound sessions and pending login grants', async () => {
  const fx = await fixture(); const sourceToken = source(); const token = await fx.enroll(sourceToken); const owner = validateSession(token);
  const pending = fx.service.beginLogin(source(owner.email), 'strict');
  registration(['2']);
  assert.throws(() => fx.service.boundSession(token)); assert.throws(() => fx.service.loginChallenge(pending.login_id, fx.pair.id));
  registration(); keys.revoke(fx.pair.id); assert.throws(() => fx.service.boundSession(token));
  const parentFx = await fixture(); const parentToken = await parentFx.enroll(); const parentOwner = validateSession(parentToken);
  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE key = ?").run(parentOwner.parentKey);
  assert.throws(() => parentFx.service.boundSession(parentToken));
  const disabledFx = await fixture(); const disabledToken = await disabledFx.enroll(); const disabledOwner = validateSession(disabledToken);
  db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(disabledOwner.userId);
  assert.throws(() => disabledFx.service.boundSession(disabledToken));
});

test('a source revoked while enrollment verification is pending cannot issue a desktop session', async () => {
  let release; let entered;
  const ready = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; });
  const fx = await fixture({ gate: async () => { entered(); await wait; } });
  const token = source(); const grant = fx.service.beginLogin(token, 'strict'); const challenge = fx.service.loginChallenge(grant.login_id, fx.pair.id);
  const pending = fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, challenge.challenge, { counter: 0 }));
  await ready; destroySession(token); release(); await assert.rejects(pending); assert.equal(keys.get(fx.pair.id), undefined);
});

test('updated signed builds can reuse enrolled keys after a fresh login; old registration sessions fail', async () => {
  const fx = await fixture(); const token = await fx.enroll(); const owner = validateSession(token); const oldHash = desktopRegistrationHash('strict');
  registration(['2']); assert.notEqual(desktopRegistrationHash('strict'), oldHash); assert.throws(() => fx.service.boundSession(token));
  const sourceToken = source(owner.email); const grant = fx.service.beginLogin(sourceToken, 'strict'); const challenge = fx.service.loginChallenge(grant.login_id, fx.pair.id);
  assert.equal(challenge.proof_kind, 'assertion');
  const issued = await fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, challenge.challenge, { version: '2' }));
  assert.equal(keys.get(fx.pair.id).bundle_version, '2'); assert.ok(fx.service.boundSession(issued.session_token));
});

test('ordinary sessions and personal keys retain existing access rather than being silently promoted', async () => {
  const fx = await fixture(); const token = source(); const owner = validateSession(token);
  assert.equal((await fx.app.inject({ url: '/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
  const catalog = await fx.app.inject({ url: '/v1/models/effective', headers: { authorization: `Bearer ${token}` } }); assert.equal(catalog.json().authorization, `Bearer ${owner.parentKey}`);
  const personal = await fx.app.inject({ url: '/v1/models/effective', headers: { authorization: `Bearer ${owner.parentKey}` } }); assert.equal(personal.json().authorization, `Bearer ${owner.parentKey}`);
  assert.equal((await fx.post('/auth/desktop/challenge', { method: 'GET', path: '/auth/session', body_hash: desktopBodyHash(undefined) }, token)).statusCode, 400);
});

test('authorization codes cannot downgrade after the registered client policy changes', async () => {
  const { DesktopAuthorizationStore } = await import('../dist/reference-server/src/storage/desktop-auth.js');
  registration(); const store = new DesktopAuthorizationStore(); const verifier = randomBytes(32).toString('base64url');
  const input = { clientId: 'strict', redirectUri: 'http://127.0.0.1:45555/oauth/callback', state: randomBytes(32).toString('base64url'), challenge: createHash('sha256').update(verifier).digest('base64url') };
  const flow = store.begin(input, 'S256', 'code'); const code = new URL(store.complete(flow.flowId, flow.cookie, source())).searchParams.get('code');
  const config = JSON.parse(process.env.OZWELL_DESKTOP_CLIENTS); delete config.strict.apple_app_attest; process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify(config);
  assert.throws(() => store.redeem({ ...input, code, verifier, grantType: 'authorization_code' }));
});

test('request challenge limits, token binding and forbidden methods fail without broadening session access', async () => {
  const fx = await fixture(); const token = await fx.enroll(); const user = validateSession(token);
  const sourceToken = source(user.email); const grant = fx.service.beginLogin(sourceToken, 'strict'); const loginChallenge = fx.service.loginChallenge(grant.login_id, fx.pair.id);
  const other = await fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, loginChallenge.challenge));
  const challenge = fx.service.requestChallenge(token, 'GET', '/auth/session', desktopBodyHash(undefined));
  await assert.rejects(fx.service.verifyRequest(other.session_token, 'GET', '/auth/session', undefined, challenge.challenge_id, fx.pair.id, proof(fx.pair, challenge.challenge)));
  await assert.rejects(fx.service.verifyRequest(token, 'POST', '/auth/session', undefined, challenge.challenge_id, fx.pair.id, proof(fx.pair, challenge.challenge)));
  for (let i = 0; i < 8; i++) fx.service.requestChallenge(token, 'GET', '/auth/session', desktopBodyHash(undefined));
  assert.throws(() => fx.service.requestChallenge(token, 'GET', '/auth/session', desktopBodyHash(undefined)), error => error.code === 'temporarily_unavailable');
  const config = JSON.parse(process.env.OZWELL_DESKTOP_CLIENTS); config.other = { ...config.strict }; process.env.OZWELL_DESKTOP_CLIENTS = JSON.stringify(config);
  const otherClient = fx.service.beginLogin(source(user.email), 'other'); assert.throws(() => fx.service.loginChallenge(otherClient.login_id, fx.pair.id));
});

test('canonical key identifiers, challenge expiry and rejected builds never persist an enrollment', async () => {
  let now = Date.now(); const fx = await fixture({ now: () => now }); const grant = fx.service.beginLogin(source(), 'strict');
  assert.throws(() => fx.service.loginChallenge(grant.login_id, fx.pair.id.replace(/=$/, '')));
  const expired = fx.service.loginChallenge(grant.login_id, fx.pair.id); now += 60_000;
  await assert.rejects(fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, expired.challenge, { counter: 0 })));
  const denied = fx.service.loginChallenge(grant.login_id, fx.pair.id);
  await assert.rejects(fx.service.verifyLogin(grant.login_id, fx.pair.id, proof(fx.pair, denied.challenge, { version: 'unapproved', counter: 0 })));
  assert.equal(keys.get(fx.pair.id), undefined);
});
