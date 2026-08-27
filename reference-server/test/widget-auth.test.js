import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Store unit tests import the compiled module (npm pretest runs the build)
const sessions = await import('../dist/reference-server/src/storage/sessions.js');

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
            // Present-but-empty so dotenv leaves them alone: these assert the
            // unconfigured path, which a developer's own .env would otherwise fill in.
            GOOGLE_CLIENT_ID: '',
            GOOGLE_CLIENT_SECRET: '',
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
});

// --- session store units ---

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
    assert.deepEqual(await res.json(), { google: false, email_otp: true, user_key: true });
});

test('Google start route is absent until credentials are configured', async () => {
    const res = await fetch(`${BASE}/auth/oidc/google/start`, { redirect: 'manual' });
    assert.equal(res.status, 404);
});
