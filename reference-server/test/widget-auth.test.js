import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import Fastify from 'fastify';
import { generateKeyPair, exportPKCS8, exportJWK, createLocalJWKSet, SignJWT, jwtVerify } from 'jose';
import oidcModule from '../dist/reference-server/src/util/oidc.js';

// Store unit tests import the compiled module (npm pretest runs the build)
const storeDirectory = mkdtempSync(path.join(tmpdir(), 'ozwell-widget-auth-store-'));
process.env.DB_PATH = path.join(storeDirectory, 'auth.db');
const sessions = await import('../dist/reference-server/src/storage/sessions.js');
const { agentStore } = await import('../dist/reference-server/src/storage/agents.js');
const { default: appleRouteModule } = await import('../dist/reference-server/src/routes/oidc-apple.js');

// Keep MOCK_KEY in sync with MOCK_AGENT_KEY in src/storage/agents.ts.
const MOCK_KEY = 'agnt_key-mock-test';
const PORT = 3347;
const BASE = `http://localhost:${PORT}`;

let server;
let tmp;

async function waitForReady(base = BASE, maxMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            if ((await fetch(`${base}/health`)).status === 200) return;
        } catch { /* not ready */ }
        await delay(200);
    }
    throw new Error('server never became ready');
}

async function postJson(path, body) {
    return fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

/** Run the full OTP flow and return the minted session token. */
async function signIn(email) {
    const requested = await postJson('/auth/otp/request', { email });
    assert.equal(requested.status, 200);
    const { challenge_id, dev_code } = await requested.json();
    const verified = await postJson('/auth/otp/verify', { challenge_id, code: dev_code });
    assert.equal(verified.status, 200);
    return (await verified.json()).session_token;
}

/** Spawn a server on its own port with its own database. */
function startServer(port, dbPath, extraEnv = {}) {
    return spawn(process.execPath, ['dist/reference-server/src/server.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: {
            ...process.env,
            PORT: String(port),
            DB_PATH: dbPath,
            NODE_ENV: 'development',
            ALLOW_MOCK: 'true',
            AUTH_DEV_ECHO_OTP: '1',
            WIDGET_SIGNUP_POLICY: 'open',
            // Present-but-empty so dotenv leaves them alone: these assert the
            // unconfigured path, which a developer's own .env would otherwise fill in.
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
            APPLE_CLIENT_ID: '',
            SMTP_URL: '',
            ...extraEnv,
        },
    });
}

function stopServer(child) {
    try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else process.kill(-child.pid, 'SIGKILL');
    } catch { /* already gone */ }
}

before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-widget-auth-test-'));
    server = startServer(PORT, path.join(tmp, 'ozwell.db'));
    await waitForReady();
});

after(() => {
    stopServer(server);
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    rmSync(storeDirectory, { recursive: true, force: true });
});

// --- session store units ---

test('OTP delivery cap applies across recipients and expires after fifteen minutes', (context) => {
    let now = Date.now();
    context.mock.method(Date, 'now', () => now);
    try {
        assert.equal(sessions.allowOtpRequest('repeat@limit.test'), true);
        assert.equal(sessions.allowOtpRequest('repeat@limit.test'), true);
        assert.equal(sessions.allowOtpRequest('repeat@limit.test'), true);
        assert.equal(sessions.allowOtpRequest('repeat@limit.test'), false);
        for (let index = 0; index < 97; index++) {
            assert.equal(sessions.allowOtpRequest(`recipient-${index}@limit.test`), true);
        }
        assert.equal(sessions.allowOtpRequest('overflow@limit.test'), false);
        now += 15 * 60 * 1000;
        assert.equal(sessions.allowOtpRequest('overflow@limit.test'), true);
        assert.equal(sessions.allowOtpRequest('repeat@limit.test'), true);
    } finally {
        sessions.sweepExpiredSessionState(now + 15 * 60 * 1000);
    }
});

test('OTP challenge returns the verified email exactly once', () => {
    const { challengeId, code } = sessions.createOtpChallenge('user@example.test');
    assert.match(code, /^\d{6}$/);
    assert.equal(sessions.verifyOtp(challengeId, '000000'), null); // wrong code
    assert.equal(sessions.verifyOtp(challengeId, code), 'user@example.test');
    assert.equal(sessions.verifyOtp(challengeId, code), null); // single-use
});

test('abandoned sign-in state is swept once it expires', () => {
    // Nothing removes these on its own: an unverified code and an abandoned
    // Google flow are never revisited, and rate-limit keys are email addresses
    // an unauthenticated caller picks. Without the sweep the maps only grow.
    const { challengeId } = sessions.createOtpChallenge('abandoned@example.test');
    const flow = sessions.startOidcFlow();
    sessions.allowOtpRequest('sweep-me@example.test');

    assert.equal(sessions.sweepExpiredSessionState(), 0, 'nothing has expired yet');

    // A day on, every one of them is past its TTL.
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000 + 1;
    assert.equal(sessions.sweepExpiredSessionState(tomorrow), 3);

    assert.equal(sessions.verifyOtp(challengeId, '000000'), null, 'challenge is gone');
    assert.equal(sessions.consumeOidcFlow(flow.state), null, 'flow is gone');
    assert.equal(sessions.sweepExpiredSessionState(tomorrow), 0, 'sweep is idempotent');
});

test('OIDC flow state carries PKCE and nonce, and is single-use', () => {
    const flow = sessions.startOidcFlow();
    assert.match(flow.state, /^[0-9a-f]{32}$/);
    assert.ok(flow.codeVerifier.length >= 43);
    assert.ok(flow.codeChallenge && flow.codeChallenge !== flow.codeVerifier);
    assert.ok(flow.nonce);

    const consumed = sessions.consumeOidcFlow(flow.state);
    assert.equal(consumed.codeVerifier, flow.codeVerifier);
    assert.equal(consumed.nonce, flow.nonce);
    assert.equal(sessions.consumeOidcFlow(flow.state), null); // replay rejected
});

test('unknown session token is rejected', () => {
    assert.equal(sessions.validateSession('sess_bogus'), null);
});

test('OIDC state cannot cross providers', () => {
    const flow = sessions.startOidcFlow('apple');
    assert.equal(sessions.consumeOidcFlow(flow.state, 'google'), null);
    assert.equal(sessions.consumeOidcFlow(flow.state, 'apple'), null);
});

test('popup response escapes script content and targets only the API origin', () => {
    const html = oidcModule.popupResultPage({ email: '</script><script>bad()</script>' });
    assert.ok(!html.includes('</script><script>'));
    assert.ok(html.includes('\\u003c/script>'));
    assert.ok(!html.includes('postMessage(*'));
});

test('Apple signs short-lived client secrets and validates form-post identities', async (context) => {
    const names = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'PUBLIC_BASE_URL', 'WIDGET_SIGNUP_POLICY'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const clientKeys = await generateKeyPair('ES256', { extractable: true });
    const signingKeys = await generateKeyPair('RS256');
    Object.assign(process.env, {
        APPLE_CLIENT_ID: 'test.service', APPLE_TEAM_ID: 'test-team', APPLE_KEY_ID: 'test-key',
        APPLE_PRIVATE_KEY: await exportPKCS8(clientKeys.privateKey),
        PUBLIC_BASE_URL: 'https://widget.example', WIDGET_SIGNUP_POLICY: 'open',
    });
    const app = Fastify();
    try {
        const secret = await appleRouteModule.appleClientSecret();
        const { payload, protectedHeader } = await jwtVerify(secret, clientKeys.publicKey, {
            issuer: 'test-team', audience: 'https://appleid.apple.com', subject: 'test.service',
        });
        assert.equal(protectedHeader.kid, 'test-key');
        assert.equal(payload.exp - payload.iat, 300);
        await app.register(appleRouteModule.default, {
            jwks: createLocalJWKSet({ keys: [{ ...await exportJWK(signingKeys.publicKey), kid: 'apple-test', alg: 'RS256' }] }),
        });
        let token;
        const fetchMock = context.mock.method(globalThis, 'fetch', async (url, request) => {
            assert.equal(url, 'https://appleid.apple.com/auth/token');
            assert.equal(request.body.get('redirect_uri'), 'https://widget.example/auth/oidc/apple/callback');
            return new Response(JSON.stringify({ id_token: token }), { status: 200 });
        });
        for (const scenario of ['valid', 'repeat-login', 'wrong-nonce', 'unverified', 'wrong-audience', 'expired', 'denied-policy']) {
            const start = await app.inject('/auth/oidc/apple/start');
            const location = new URL(start.headers.location);
            assert.equal(location.searchParams.get('response_mode'), 'form_post');
            const state = location.searchParams.get('state');
            token = await new SignJWT({
                nonce: scenario === 'wrong-nonce' ? 'wrong' : location.searchParams.get('nonce'),
                email: 'apple-auth@example.test', email_verified: scenario === 'unverified' ? 'false' : 'true',
            }).setProtectedHeader({ alg: 'RS256', kid: 'apple-test' })
                .setIssuer('https://appleid.apple.com').setSubject('apple-user')
                .setAudience(scenario === 'wrong-audience' ? 'other' : 'test.service')
                .setIssuedAt().setExpirationTime(scenario === 'expired' ? '0s' : '5m').sign(signingKeys.privateKey);
            process.env.WIDGET_SIGNUP_POLICY = scenario === 'denied-policy' ? 'allowlist' : 'open';
            const response = await app.inject({ method: 'POST', url: '/auth/oidc/apple/callback',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                payload: new URLSearchParams({ state, code: 'test-code' }).toString(),
            });
            assert.equal(response.headers['cache-control'], 'no-store');
            assert.equal(response.body.includes('session_token'), ['valid', 'repeat-login'].includes(scenario), scenario);
            const replay = await app.inject({ method: 'POST', url: '/auth/oidc/apple/callback',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                payload: new URLSearchParams({ state, code: 'test-code' }).toString(),
            });
            assert.match(replay.body, /invalid_or_expired_state/);
        }
        assert.equal(fetchMock.mock.callCount(), 7);
    } finally {
        await app.close();
        for (const name of names) {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        }
    }
});

test('widget signup defaults to existing accounts and rejects unapproved domains', () => {
    const previousPolicy = process.env.WIDGET_SIGNUP_POLICY;
    const previousDomains = process.env.WIDGET_SIGNUP_DOMAINS;
    const identity = { email: 'new-user@unapproved.test', externalUserId: 'email:new-user@unapproved.test' };
    try {
        delete process.env.WIDGET_SIGNUP_POLICY;
        assert.throws(() => sessions.createSessionForIdentity(identity), { statusCode: 403 });
        assert.equal(agentStore.getManagerUserByEmail(identity.email), null);
        process.env.WIDGET_SIGNUP_POLICY = 'allowlist';
        process.env.WIDGET_SIGNUP_DOMAINS = 'approved.test';
        assert.throws(() => sessions.createSessionForIdentity(identity), { statusCode: 403 });
        assert.throws(() => sessions.createSessionForIdentity({ ...identity, email: 'user@sub.approved.test' }), { statusCode: 403 });
        const approved = { email: 'user@approved.test', externalUserId: 'email:user@approved.test' };
        const token = sessions.createSessionForIdentity(approved);
        const first = sessions.validateSession(token);
        assert.equal(first.email, approved.email);
        delete process.env.WIDGET_SIGNUP_POLICY;
        const repeated = sessions.createSessionForIdentity(approved);
        assert.equal(sessions.validateSession(repeated).parentKey, first.parentKey);
        sessions.destroySession(token);
        sessions.destroySession(repeated);
        process.env.WIDGET_SIGNUP_POLICY = 'invalid';
        assert.throws(() => sessions.createSessionForIdentity(identity), { statusCode: 403 });
    } finally {
        if (previousPolicy === undefined) delete process.env.WIDGET_SIGNUP_POLICY;
        else process.env.WIDGET_SIGNUP_POLICY = previousPolicy;
        if (previousDomains === undefined) delete process.env.WIDGET_SIGNUP_DOMAINS;
        else process.env.WIDGET_SIGNUP_DOMAINS = previousDomains;
    }
});

test('OTP challenge locks out after too many wrong attempts', () => {
    const { challengeId, code } = sessions.createOtpChallenge('bruteforce@example.test');
    for (let i = 0; i < 5; i++) {
        assert.equal(sessions.verifyOtp(challengeId, '000000'), null);
    }
    // 6th attempt exceeds MAX_OTP_ATTEMPTS: even the correct code is rejected
    assert.equal(sessions.verifyOtp(challengeId, code), null);
});

// --- auth routes ---

test('email OTP flow issues and revokes a session', async () => {
    const requested = await postJson('/auth/otp/request', { email: 'widget-user@example.test' });
    assert.equal(requested.status, 200);
    const { challenge_id, dev_code } = await requested.json();
    assert.ok(challenge_id);
    assert.match(dev_code, /^\d{6}$/);

    const bad = await postJson('/auth/otp/verify', { challenge_id, code: '000000' });
    assert.equal(bad.status, 401);

    const ok = await postJson('/auth/otp/verify', { challenge_id, code: dev_code });
    assert.equal(ok.status, 200);
    const { session_token, email } = await ok.json();
    assert.ok(session_token.startsWith('sess_'));
    assert.equal(email, 'widget-user@example.test');

    const who = await fetch(`${BASE}/auth/session`, { headers: { Authorization: `Bearer ${session_token}` } });
    assert.equal(who.status, 200);
    const identity = await who.json();
    assert.equal(identity.email, 'widget-user@example.test');
    assert.ok(identity.user_id, 'session is bound to a provisioned user');

    const out = await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session_token}` },
    });
    assert.equal(out.status, 200);

    const whoAfter = await fetch(`${BASE}/auth/session`, { headers: { Authorization: `Bearer ${session_token}` } });
    assert.equal(whoAfter.status, 401);
});

test('OTP request rejects a malformed email', async () => {
    const res = await postJson('/auth/otp/request', { email: 'not-an-email' });
    assert.equal(res.status, 400);
});

test('OTP requests for one address are rate limited', async () => {
    // Sending a code mails an address the caller chose, so an uncapped
    // endpoint would let anyone flood any inbox from our relay.
    const email = 'flooded@example.test';
    for (let i = 0; i < 3; i++) {
        const allowed = await postJson('/auth/otp/request', { email });
        assert.equal(allowed.status, 200, `request ${i + 1} should be allowed`);
    }

    const blocked = await postJson('/auth/otp/request', { email });
    assert.equal(blocked.status, 429);

    // Another address is unaffected — the cap is per recipient, not global.
    const other = await postJson('/auth/otp/request', { email: 'not-flooded@example.test' });
    assert.equal(other.status, 200);
});

test('a server that can send mail never echoes the code, and says so when delivery fails', async () => {
    // Unroutable on purpose: the real relay only answers inside the Phoenix DC,
    // so this asserts the failure path without depending on a mail server.
    const mailPort = 3348;
    const mailBase = `http://localhost:${mailPort}`;
    const mailTmp = mkdtempSync(path.join(tmpdir(), 'ozwell-widget-auth-mail-'));
    const mailServer = startServer(mailPort, path.join(mailTmp, 'ozwell.db'), {
        SMTP_URL: 'smtp://127.0.0.1:1',
    });

    try {
        await waitForReady(mailBase);
        const res = await fetch(`${mailBase}/auth/otp/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'mailed@example.test' }),
        });

        assert.equal(res.status, 502, 'delivery failure is reported, not swallowed');
        const body = await res.json();
        assert.equal(body.dev_code, undefined, 'AUTH_DEV_ECHO_OTP must not bypass a real sender');
    } finally {
        stopServer(mailServer);
        try { rmSync(mailTmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

test('production disables email login without SMTP even when dev echo is enabled', async () => {
    const port = 3349;
    const child = startServer(port, path.join(tmp, 'production.db'), { NODE_ENV: 'production' });
    try {
        await waitForReady(`http://localhost:${port}`);
        const methods = await (await fetch(`http://localhost:${port}/auth/methods`)).json();
        assert.equal(methods.email_otp, false);
        const response = await fetch(`http://localhost:${port}/auth/otp/request`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'user@example.test' }),
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).dev_code, undefined);
    } finally { stopServer(child); }
});

test('SMTP delivery sends a usable code without exposing it in the API or logs', async () => {
    let message = '';
    const smtp = net.createServer(socket => {
        let buffer = '';
        let inData = false;
        socket.write('220 test SMTP ready\r\n');
        socket.on('data', chunk => {
            buffer += chunk.toString();
            let boundary;
            while ((boundary = buffer.indexOf('\r\n')) !== -1) {
                const line = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                if (inData) {
                    if (line === '.') { inData = false; socket.write('250 accepted\r\n'); }
                    else message += `${line}\n`;
                } else if (line.startsWith('DATA')) {
                    inData = true; socket.write('354 send data\r\n');
                } else if (line.startsWith('QUIT')) socket.end('221 goodbye\r\n');
                else socket.write('250 OK\r\n');
            }
        });
        socket.on('error', () => {});
    });
    await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
    const port = 3350;
    const base = `http://localhost:${port}`;
    const child = startServer(port, path.join(tmp, 'smtp.db'), {
        SMTP_URL: `smtp://127.0.0.1:${smtp.address().port}`, NODE_ENV: 'production',
    });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk.toString(); });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });
    try {
        await waitForReady(base);
        const requested = await fetch(`${base}/auth/otp/request`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'delivered@example.test' }),
        });
        assert.equal(requested.status, 200);
        const body = await requested.json();
        assert.equal(body.dev_code, undefined);
        const code = message.match(/Your Ozwell sign-in code is (\d{6})/)[1];
        assert.ok(!logs.includes(code));
        const verified = await fetch(`${base}/auth/otp/verify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ challenge_id: body.challenge_id, code }),
        });
        assert.equal(verified.status, 200);
    } finally {
        stopServer(child);
        await new Promise(resolve => smtp.close(resolve));
    }
});

// --- session-to-key rewrite hook ---

test('session token authorizes chat; bogus session token does not', async () => {
    const sessionToken = await signIn('sess-chat@example.test');

    const chat = await postJson('/v1/chat/completions', { messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(chat.status, 401, 'no credential at all is still rejected');

    const authed = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(authed.status, 200);

    const bogus = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sess_bogus' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(bogus.status, 401);
});

test('signed-out session no longer authorizes chat', async () => {
    const sessionToken = await signIn('sess-revoked@example.test');
    await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` } });

    const chat = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(chat.status, 401);
});

test('direct agent key still works unchanged', async () => {
    const chat = await fetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MOCK_KEY}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(chat.status, 200);
});

test('each signed-in email gets its own parent key', async () => {
    const first = await signIn('user-one@example.test');
    const second = await signIn('user-two@example.test');

    const [one, two] = await Promise.all([
        fetch(`${BASE}/auth/session`, { headers: { Authorization: `Bearer ${first}` } }).then(r => r.json()),
        fetch(`${BASE}/auth/session`, { headers: { Authorization: `Bearer ${second}` } }).then(r => r.json()),
    ]);
    assert.ok(one.user_id && two.user_id);
    assert.notEqual(one.user_id, two.user_id, 'separate users, not one shared identity');
});

test('sign-in methods report Google as unconfigured without credentials', async () => {
    const res = await fetch(`${BASE}/auth/methods`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { google: false, apple: false, email_otp: true, user_key: true });
});

test('Google start route is absent until credentials are configured', async () => {
    const res = await fetch(`${BASE}/auth/oidc/google/start`, { redirect: 'manual' });
    assert.equal(res.status, 404);
});
