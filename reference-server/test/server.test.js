import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

test('Reference Server - Health Check', async () => {
  // Start the server in a new process group
  const server = spawn('npm', ['start'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true
  });

  try {
    // Wait for server to start
    await setTimeout(3000);

    // Test health endpoint
    const response = await fetch('http://localhost:3000/health');
    assert.strictEqual(response.status, 200);

    const data = await response.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.timestamp, 'should have a timestamp');

  } finally {
    // Kill entire process group (negative PID kills process group)
    try {
      process.kill(-server.pid, 'SIGTERM');
      await setTimeout(1000);
      // Force kill if still running
      process.kill(-server.pid, 'SIGKILL');
    } catch (err) {
      // Process already dead, ignore error
    }
  }
});

test('Reference Server - OpenAPI Spec', async () => {
  // Start the server in a new process group
  const server = spawn('npm', ['start'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true
  });

  try {
    // Wait for server to start
    await setTimeout(3000);

    // Test OpenAPI endpoint
    const response = await fetch('http://localhost:3000/openapi.json');
    assert.strictEqual(response.status, 200);

    const spec = await response.json();
    assert.ok(spec.openapi);
    assert.ok(spec.info);
    assert.ok(spec.paths);

  } finally {
    // Kill entire process group (negative PID kills process group)
    try {
      process.kill(-server.pid, 'SIGTERM');
      await setTimeout(1000);
      // Force kill if still running
      process.kill(-server.pid, 'SIGKILL');
    } catch (err) {
      // Process already dead, ignore error
    }
  }
});
