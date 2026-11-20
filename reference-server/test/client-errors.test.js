import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
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
