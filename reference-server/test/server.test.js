import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
const TEST_COMMIT = '0123456789abcdef0123456789abcdef01234567';

// Poll until the server answers /health, instead of a fixed sleep — a fixed
// delay is flaky on slow hosts (Windows CI, constrained containers).
async function waitForReady(maxMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.status === 200) return;
    } catch { /* not ready yet */ }
    await setTimeout(200);
  }
  throw new Error('server never became ready');
}

function stop(server) {
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* already dead */ }
}

function startServer(envOverrides = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-server-test-'));
  const dbPath = path.join(tmp, 'ozwell.db');
  const server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      DB_PATH: dbPath,
      NODE_ENV: 'development',
      GIT_COMMIT: TEST_COMMIT,
      ...envOverrides,
    }
  });
  return { server, tmp };
}

function cleanup(server, tmp) {
  stop(server);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

test('Reference Server - Health Check', async () => {
  // Start the server in a new process group
  // Spawn the prebuilt server with node directly (not `npm start`): npm is
  // npm.cmd on Windows and `spawn('npm')` fails with ENOENT without a shell.
  const { server, tmp } = startServer();

  try {
    await waitForReady();

    // Test health endpoint
    const response = await fetch(`${BASE}/health`);
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.timestamp, 'should have a timestamp');
    assert.strictEqual(typeof data.commit, 'string');
    assert.strictEqual(data.commit, TEST_COMMIT);

  } finally {
    cleanup(server, tmp);
  }
});

test('Reference Server - Health Check uses unknown commit in production without revision metadata', async () => {
  const { server, tmp } = startServer({
    NODE_ENV: 'production',
    GIT_COMMIT: '',
    APP_REVISION: '',
    SOURCE_VERSION: '',
    GITHUB_SHA: '',
  });

  try {
    await waitForReady();

    const response = await fetch(`${BASE}/health`);
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.commit, 'unknown');

  } finally {
    cleanup(server, tmp);
  }
});

test('Reference Server - OpenAPI Spec', async () => {
  // Start the server in a new process group
  // Spawn the prebuilt server with node directly (not `npm start`): npm is
  // npm.cmd on Windows and `spawn('npm')` fails with ENOENT without a shell.
  const { server, tmp } = startServer();

  try {
    await waitForReady();

    // Test OpenAPI endpoint
    const response = await fetch(`${BASE}/openapi.json`);
    assert.strictEqual(response.status, 200);

    const spec = await response.json();
    assert.ok(spec.openapi);
    assert.ok(spec.info);
    assert.ok(spec.paths);

  } finally {
    cleanup(server, tmp);
  }
});
