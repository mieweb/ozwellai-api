import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { desktopAuthorizations, DesktopAuthError, DESKTOP_FLOW_COOKIE } from '../storage/desktop-auth';
import { validateSession, allowOidcStart } from '../storage/sessions';
import { agentStore } from '../storage/agents';
import { extractToken } from '../util';
import { publicOrigin } from '../util/oidc';

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
  reply.header('Referrer-Policy', 'no-referrer');
}
function cookieHeader(value: string, maxAge = 600): string {
  return `${DESKTOP_FLOW_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/auth/desktop; Max-Age=${maxAge}${publicOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
function flowCookie(header?: string): string {
  const value = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${DESKTOP_FLOW_COOKIE}=`))?.slice(DESKTOP_FLOW_COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function errorReply(reply: FastifyReply, error: unknown) {
  const known = error instanceof DesktopAuthError;
  return reply.code(known && error.code === 'temporarily_unavailable' ? 429 : 400).send({ error: known ? error.code : 'invalid_request', error_description: known ? error.message : 'Invalid desktop authorization request.' });
}
function text(value: unknown): string { return typeof value === 'string' && value.length <= 2048 ? value : ''; }
function activeSession(token: string) {
  const session = validateSession(token);
  return session && agentStore.validateKey(session.parentKey) && agentStore.getManagerUserById(session.userId)?.status === 'active' ? session : null;
}

export default async function desktopAuthRoute(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (_request, reply) => { noStore(reply); });
  fastify.get('/auth/desktop/authorize', {
    schema: {
      tags: ['Auth'], summary: 'Authorize a registered desktop public client using hosted sign-in',
      querystring: {
        type: 'object', required: ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method'],
        properties: {
          response_type: { type: 'string', enum: ['code'] }, client_id: { type: 'string', maxLength: 100 },
          redirect_uri: { type: 'string', maxLength: 2048 }, state: { type: 'string', minLength: 32, maxLength: 256 },
          code_challenge: { type: 'string', minLength: 43, maxLength: 43 }, code_challenge_method: { type: 'string', enum: ['S256'] },
        },
      },
    },
  }, async (request, reply) => {
    reply.header('X-Frame-Options', 'DENY');
    try {
      if (!allowOidcStart(request.ip)) throw new DesktopAuthError('temporarily_unavailable');
      const query = request.query as Record<string, unknown>;
      const flow = desktopAuthorizations.begin({
        clientId: text(query.client_id), redirectUri: text(query.redirect_uri), state: text(query.state), challenge: text(query.code_challenge),
      }, query.code_challenge_method, query.response_type);
      const nonce = randomBytes(18).toString('base64');
      reply.header('Set-Cookie', cookieHeader(flow.cookie));
      reply.header('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
      const config = JSON.stringify({ flowId: flow.flowId, clientName: flow.clientName }).replace(/[<>&\u2028\u2029]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Ozwell Desktop</title></head><body><div id="ozwell-desktop-login"></div><script id="ozwell-desktop-config" type="application/json" nonce="${nonce}">${config}</script><script src="/auth/desktop/login.js" nonce="${nonce}" defer></script></body></html>`);
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post('/auth/desktop/complete', {
    bodyLimit: 8192,
    schema: {
      tags: ['Auth'], summary: 'Finish a browser-bound desktop authorization',
      body: { type: 'object', required: ['flow_id'], properties: { flow_id: { type: 'string', maxLength: 100 } } },
      response: { 200: { type: 'object', required: ['redirect_uri'], properties: { redirect_uri: { type: 'string' } } } },
    },
  }, async (request, reply) => {
    // Cookie proves this browser opened authorize; Origin and bearer prevent cross-site completion.
    if (request.headers.origin !== publicOrigin() || (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) return reply.code(403).send({ error: 'invalid_request', error_description: 'This sign-in must finish on the Ozwell sign-in page.' });
    const token = extractToken(request.headers.authorization);
    if (!activeSession(token)) return reply.code(401).send({ error: 'invalid_token', error_description: 'Sign in to Ozwell again.' });
    try {
      const body = request.body as { flow_id: string };
      const redirectUri = desktopAuthorizations.complete(body.flow_id, flowCookie(request.headers.cookie), token);
      reply.header('Set-Cookie', cookieHeader('', 0));
      return { redirect_uri: redirectUri };
    } catch (error) { return errorReply(reply, error); }
  });

  fastify.post('/auth/desktop/token', {
    bodyLimit: 8192,
    schema: {
      tags: ['Auth'], summary: 'Exchange a desktop authorization code with its S256 PKCE verifier',
      body: { type: 'object', required: ['grant_type', 'client_id', 'redirect_uri', 'code', 'code_verifier'], properties: {
        grant_type: { type: 'string' }, client_id: { type: 'string', maxLength: 100 }, redirect_uri: { type: 'string', maxLength: 2048 }, code: { type: 'string', maxLength: 100 }, code_verifier: { type: 'string', maxLength: 128 },
      } },
      response: { 200: { type: 'object', required: ['session_token', 'email'], properties: { session_token: { type: 'string' }, email: { type: 'string' } } } },
    },
  }, async (request, reply) => {
    // No browser cookies or shared client secret are used to authorize this exchange.
    try {
      const body = request.body as Record<string, unknown>;
      const token = desktopAuthorizations.redeem({ clientId: text(body.client_id), redirectUri: text(body.redirect_uri), code: text(body.code), verifier: text(body.code_verifier), grantType: body.grant_type });
      const session = activeSession(token);
      if (!session) throw new DesktopAuthError('invalid_grant');
      return { session_token: token, email: session.email };
    } catch (error) { return errorReply(reply, error); }
  });
}
