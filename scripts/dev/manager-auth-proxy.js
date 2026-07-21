#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';

const listenPort = Number(process.env.LOCAL_AUTH_PROXY_PORT || 3100);
const target = new URL(process.env.LOCAL_AUTH_PROXY_TARGET || 'http://localhost:3000');

const localUser = process.env.LOCAL_AUTH_X_USER || process.env.LOCAL_AUTH_X_USER_ID || 'local-dev-user-1';
const localUsername = process.env.LOCAL_AUTH_X_USERNAME || 'exampleuser';

const injectedHeaders = {
  'x-user': localUser,
  'x-user-id': localUser,
  'x-preferred-username': localUsername,
  'x-username': localUsername,
  'x-user-first-name': process.env.LOCAL_AUTH_X_USER_FIRST_NAME || 'Example',
  'x-user-last-name': process.env.LOCAL_AUTH_X_USER_LAST_NAME || 'User',
  'x-email': process.env.LOCAL_AUTH_X_EMAIL || 'example-user@example.test',
  'x-groups': process.env.LOCAL_AUTH_X_GROUPS || 'ldapusers',
};

const server = http.createServer((clientReq, clientRes) => {
  const headers = {
    ...clientReq.headers,
    ...injectedHeaders,
    host: target.host,
  };

  const proxyReq = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 80,
    method: clientReq.method,
    path: clientReq.url,
    headers,
  }, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (error) => {
    clientRes.writeHead(502, { 'content-type': 'application/json' });
    clientRes.end(JSON.stringify({
      error: {
        message: `Local auth proxy failed to reach ${target.origin}: ${error.message}`,
        type: 'proxy_error',
      },
    }));
  });

  clientReq.pipe(proxyReq);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`[manager-auth-proxy] http://localhost:${listenPort} -> ${target.origin}`);
  console.log(`[manager-auth-proxy] injecting x-user=${injectedHeaders['x-user']} x-user-id=${injectedHeaders['x-user-id']} x-preferred-username=${injectedHeaders['x-preferred-username']} x-username=${injectedHeaders['x-username']} x-email=${injectedHeaders['x-email']}`);
});
