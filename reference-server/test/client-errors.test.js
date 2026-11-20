import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

const { default: route } = await import('../dist/reference-server/src/routes/client-errors.js');

function buildApp() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  const app = Fastify({ logger: { level: 'info', stream } });
  app.register(route);
  return { app, lines };
}

test('widget client errors are logged without echoing back content', async () => {
  const { app, lines } = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/errors',
    payload: { kind: 'render', message: 'boom', stack: 'Error: boom\n at x', componentStack: ' at WidgetApp' },
  });
  assert.equal(response.statusCode, 204);
  const entry = lines.find((line) => line.msg === 'Widget client error');
  assert.ok(entry);
  assert.equal(entry.clientError.kind, 'render');
  assert.equal(entry.clientError.message, 'boom');
  await app.close();
});

test('widget client error reports are throttled per client', async () => {
  const { app, lines } = buildApp();
  for (let i = 0; i < 25; i += 1) {
    const response = await app.inject({ method: 'POST', url: '/v1/widget/errors', payload: { message: `e${i}` } });
    assert.equal(response.statusCode, 204);
  }
  assert.equal(lines.filter((line) => line.msg === 'Widget client error').length, 20);
  await app.close();
});

test('oversized reports are rejected', async () => {
  const { app } = buildApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/widget/errors',
    payload: { message: 'x'.repeat(20 * 1024) },
  });
  assert.equal(response.statusCode, 413);
  await app.close();
});

test('full server keeps 413 for oversized reports instead of turning it into a 500', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ozwell-client-errors-'));
  process.env.DB_PATH = path.join(directory, 'server.db');
  process.env.LOG_LEVEL = 'silent';
  const serverModule = await import('../dist/reference-server/src/server.js');
  const buildServer = serverModule.default.default ?? serverModule.default;
  const server = await buildServer();
  try {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/widget/errors',
      payload: { message: 'x'.repeat(20 * 1024) },
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().error.type, 'invalid_request_error');
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('credential query parameters are redacted from logged URLs', async () => {
  const { redactUrl } = await import('../dist/reference-server/src/util/log-redaction.js');
  assert.equal(
    redactUrl('/auth/oidc/google/callback?code=abc123&state=xyz&scope=email'),
    '/auth/oidc/google/callback?code=%5BREDACTED%5D&state=%5BREDACTED%5D&scope=email',
  );
  assert.equal(redactUrl('/v1/models?limit=5'), '/v1/models?limit=5');
  assert.equal(redactUrl('/health'), '/health');
});
