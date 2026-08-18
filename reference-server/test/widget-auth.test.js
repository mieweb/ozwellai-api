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

async function waitForReady(maxMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try {
            if ((await fetch(`${BASE}/health`)).status === 200) return;
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

before(async () => {
    tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-widget-auth-test-'));
    const dbPath = path.join(tmp, 'ozwell.db');
    server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
        cwd: process.cwd(),
        stdio: 'pipe',
        detached: true,
        env: {
            ...process.env,
            PORT: String(PORT),
            DB_PATH: dbPath,
            NODE_ENV: 'development',
            ALLOW_MOCK: '',
            AUTH_DEV_ECHO_OTP: '1',
            // Sessions map onto the auto-seeded mock agent key
            WIDGET_SESSION_KEY: MOCK_KEY,
        },
    });
    await waitForReady();
});

after(() => {
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* ignore */ }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

// --- session store units ---

test('OTP challenge verifies once and mints a session', () => {
    const { challengeId, code } = sessions.createOtpChallenge('user@example.test');
    assert.match(code, /^\d{6}$/);
    assert.equal(sessions.verifyOtp(challengeId, '000000'), null); // wrong code
    const token = sessions.verifyOtp(challengeId, code);
    assert.ok(token.startsWith('sess_'));
    assert.equal(sessions.verifyOtp(challengeId, code), null); // single-use
    assert.deepEqual(sessions.validateSession(token), { email: 'user@example.test' });
    sessions.destroySession(token);
    assert.equal(sessions.validateSession(token), null);
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
    assert.deepEqual(await who.json(), { email: 'widget-user@example.test' });

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
    const body = await authed.json();
    assert.match(body.choices[0].message.content, /Hello/);

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
