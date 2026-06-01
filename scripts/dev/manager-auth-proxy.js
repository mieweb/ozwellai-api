#!/usr/bin/env node

import http from 'node:http';
import { URL } from 'node:url';

const listenPort = Number(process.env.LOCAL_AUTH_PROXY_PORT || 3100);
const target = new URL(process.env.LOCAL_AUTH_PROXY_TARGET || 'http://localhost:3000');

const injectedHeaders = {
  'x-user-id': process.env.LOCAL_AUTH_X_USER_ID || '2009',
  'x-username': process.env.LOCAL_AUTH_X_USERNAME || 'adamerla',
  'x-user-first-name': process.env.LOCAL_AUTH_X_USER_FIRST_NAME || 'A',
  'x-user-last-name': process.env.LOCAL_AUTH_X_USER_LAST_NAME || 'Damerla',
  'x-email': process.env.LOCAL_AUTH_X_EMAIL || 'adamerla128@gmail.com',
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
  console.log(`[manager-auth-proxy] injecting x-user-id=${injectedHeaders['x-user-id']} x-username=${injectedHeaders['x-username']} x-email=${injectedHeaders['x-email']}`);
});
