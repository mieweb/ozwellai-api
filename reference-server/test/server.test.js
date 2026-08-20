import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:http';

const TEST_COMMIT = '0123456789abcdef0123456789abcdef01234567';

// Ask the OS for an unused port instead of hardcoding one. Port 3000 is the
// server's own default, so a dev server left running answered these requests
// and the assertions below read that process's state instead of the test's.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Poll until the server answers /health, instead of a fixed sleep — a fixed
// delay is flaky on slow hosts (Windows CI, constrained containers).
async function waitForReady(base, maxMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.status === 200) return;
    } catch { /* not ready yet */ }
    await setTimeout(200);
  }
  throw new Error('server never became ready');
}

function stop(server) {
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F']); else process.kill(-server.pid, 'SIGKILL'); } catch { /* already dead */ }
}

async function startServer(envOverrides = {}) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'ozwell-server-test-'));
  const dbPath = path.join(tmp, 'ozwell.db');
  const port = await freePort();
  const server = spawn(process.execPath, ['dist/reference-server/src/server.js'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DB_PATH: dbPath,
      NODE_ENV: 'development',
      GIT_COMMIT: TEST_COMMIT,
      ...envOverrides,
    }
  });
  return { server, tmp, base: `http://127.0.0.1:${port}` };
}

function cleanup(server, tmp) {
  stop(server);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

test('Reference Server - Health Check', async () => {
  // Start the server in a new process group
  // Spawn the prebuilt server with node directly (not `npm start`): npm is
  // npm.cmd on Windows and `spawn('npm')` fails with ENOENT without a shell.
  const { server, tmp, base } = await startServer();

  try {
    await waitForReady(base);

    // Test health endpoint
    const response = await fetch(`${base}/health`);
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
  const { server, tmp, base } = await startServer({
    NODE_ENV: 'production',
    GIT_COMMIT: '',
    APP_REVISION: '',
    SOURCE_VERSION: '',
    GITHUB_SHA: '',
  });

  try {
    await waitForReady(base);

    const response = await fetch(`${base}/health`);
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
  const { server, tmp, base } = await startServer();

  try {
    await waitForReady(base);

    // Test OpenAPI endpoint
    const response = await fetch(`${base}/openapi.json`);
    assert.strictEqual(response.status, 200);

    const spec = await response.json();
    assert.ok(spec.openapi);
    assert.ok(spec.info);
    assert.ok(spec.paths);

  } finally {
    cleanup(server, tmp);
  }
});
