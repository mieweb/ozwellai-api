const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { setTimeout } = require('node:timers/promises');

test('Reference Server - Health Check', async () => {
  // Start the server
  const server = spawn('npm', ['start'], {
    cwd: process.cwd(),
    stdio: 'pipe'
  });

  try {
    // Wait for server to start
    await setTimeout(3000);

    // Test health endpoint
    const response = await fetch('http://localhost:3000/health');
    assert.strictEqual(response.status, 200);
    
    const data = await response.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(data.timestamp); // Verify timestamp is present

  } finally {
    // Clean up
    server.kill('SIGTERM');
    await setTimeout(1000);
    if (!server.killed) {
      server.kill('SIGKILL');
    }
  }
});

test('Reference Server - OpenAPI Spec', async () => {
  // Start the server
  const server = spawn('npm', ['start'], {
    cwd: process.cwd(),
    stdio: 'pipe'
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
    // Clean up
    server.kill('SIGTERM');
    await setTimeout(1000);
    if (!server.killed) {
      server.kill('SIGKILL');
    }
  }
});
